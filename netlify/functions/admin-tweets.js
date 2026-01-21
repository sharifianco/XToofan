const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;

// Generate a short random code
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Build X intent URL for tweet
function buildIntentUrl(tweet) {
  const baseUrl = 'https://twitter.com/intent/tweet';
  const params = new URLSearchParams();
  params.set('text', tweet.text);

  if (tweet.comment_tweet_url) {
    const match = tweet.comment_tweet_url.match(/status\/(\d+)/);
    if (match) {
      params.set('in_reply_to', match[1]);
    }
  }

  return `${baseUrl}?${params.toString()}`;
}

// Create short link for a tweet
async function createShortLink(tweet) {
  // Generate unique short code
  let shortCode;
  let isUnique = false;
  let attempts = 0;

  while (!isUnique && attempts < 10) {
    shortCode = generateShortCode();
    const { data: check } = await supabase
      .from('deep_links')
      .select('id')
      .eq('short_code', shortCode)
      .single();

    if (!check) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    console.error('Failed to generate unique short code');
    return null;
  }

  const intentUrl = buildIntentUrl(tweet);

  // Save the deep link
  const { data, error } = await supabase
    .from('deep_links')
    .insert([{
      short_code: shortCode,
      tweet_id: tweet.id,
      tweet_text: tweet.text,
      intent_url: intentUrl,
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating short link:', error);
    return null;
  }

  return shortCode;
}

function verifyToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Verify admin token
  const decoded = verifyToken(event);
  if (!decoded || !decoded.isAdmin) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Admin access required' }),
    };
  }

  try {
    // GET - List all tweets
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('tweets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ tweets: data }),
      };
    }

    // POST - Create new tweet
    if (event.httpMethod === 'POST') {
      const { text, category, comment_tweet_url } = JSON.parse(event.body);

      if (!text || text.length > 280) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Tweet text is required and must be 280 characters or less' }),
        };
      }

      const { data, error } = await supabase
        .from('tweets')
        .insert([{ text, category, comment_tweet_url, active: true }])
        .select()
        .single();

      if (error) throw error;

      // Generate short link for the new tweet
      const shortCode = await createShortLink(data);
      if (shortCode) {
        // Update tweet with short_code
        await supabase
          .from('tweets')
          .update({ short_code: shortCode })
          .eq('id', data.id);
        data.short_code = shortCode;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, tweet: data }),
      };
    }

    // PUT - Update tweet
    if (event.httpMethod === 'PUT') {
      const { id, text, category, comment_tweet_url, active } = JSON.parse(event.body);

      const { data, error } = await supabase
        .from('tweets')
        .update({ text, category, comment_tweet_url, active })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, tweet: data }),
      };
    }

    // DELETE - Delete tweet
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);

      const { error } = await supabase
        .from('tweets')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };
    }

    // PATCH - Backfill short links for existing tweets
    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');

      // If action is 'backfill-links', generate links for tweets without short_code
      if (body.action === 'backfill-links') {
        // Get all tweets without short_code
        const { data: tweets, error: fetchError } = await supabase
          .from('tweets')
          .select('*')
          .is('short_code', null);

        if (fetchError) throw fetchError;

        let generated = 0;
        for (const tweet of tweets || []) {
          const shortCode = await createShortLink(tweet);
          if (shortCode) {
            await supabase
              .from('tweets')
              .update({ short_code: shortCode })
              .eq('id', tweet.id);
            generated++;
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: `Generated ${generated} short links for ${tweets?.length || 0} tweets without links`,
            generated,
            total: tweets?.length || 0,
          }),
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid action' }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Admin tweets error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Operation failed' }),
    };
  }
};
