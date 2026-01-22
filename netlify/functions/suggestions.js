const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

// Generate a short random code
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Build X intent URLs for tweet (iOS, Android, fallback)
function buildIntentUrl(tweet) {
  const encodedText = encodeURIComponent(tweet.text);

  // Handle reply if comment_tweet_url exists
  let replyParam = '';
  if (tweet.comment_tweet_url) {
    const match = tweet.comment_tweet_url.match(/status\/(\d+)/);
    if (match) {
      replyParam = `&in_reply_to=${match[1]}`;
    }
  }

  return JSON.stringify({
    ios: `twitter://post?message=${encodedText}${replyParam}`,
    android: `twitter://post?message=${encodedText}${replyParam}`,
    fallback: `https://x.com/intent/post?text=${encodedText}${replyParam}`
  });
}

// Create short link for a tweet
async function createShortLink(tweet) {
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

  const { data, error } = await supabase
    .from('deep_links')
    .insert([{
      short_code: shortCode,
      tweet_id: String(tweet.id),
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

async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) {
    // Skip verification if no secret key configured
    return true;
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${TURNSTILE_SECRET}&response=${token}`
    });
    const data = await response.json();
    return data.success;
  } catch {
    return false;
  }
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

  try {
    // POST - Submit new suggestion (public)
    if (event.httpMethod === 'POST') {
      const { text, reply_url, submitter_name, turnstile_token } = JSON.parse(event.body);

      // Verify Turnstile token
      if (TURNSTILE_SECRET && turnstile_token) {
        const isValid = await verifyTurnstile(turnstile_token);
        if (!isValid) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'تایید امنیتی ناموفق بود. لطفا دوباره تلاش کنید.' }),
          };
        }
      }

      if (!text || text.length > 280) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Tweet text is required and must be 280 characters or less' }),
        };
      }

      const { data, error } = await supabase
        .from('suggestions')
        .insert([{
          text,
          reply_url: reply_url || null,
          submitter_name: submitter_name || null,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, suggestion: data }),
      };
    }

    // Admin-only routes below
    const decoded = verifyToken(event);
    if (!decoded || !decoded.isAdmin) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Admin access required' }),
      };
    }

    // GET - List all suggestions (admin only)
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('suggestions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ suggestions: data }),
      };
    }

    // PUT - Update suggestion status or publish (admin only)
    if (event.httpMethod === 'PUT') {
      const { id, status, publish } = JSON.parse(event.body);

      // If publishing, create a tweet from the suggestion
      if (publish) {
        // Get the suggestion first
        const { data: suggestion, error: fetchError } = await supabase
          .from('suggestions')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchError) throw fetchError;

        // Create the tweet
        const { data: newTweet, error: tweetError } = await supabase
          .from('tweets')
          .insert([{
            text: suggestion.text,
            comment_tweet_url: suggestion.reply_url,
            active: true
          }])
          .select()
          .single();

        if (tweetError) throw tweetError;

        // Generate short link for the new tweet
        if (newTweet) {
          const shortCode = await createShortLink(newTweet);
          if (shortCode) {
            await supabase
              .from('tweets')
              .update({ short_code: shortCode })
              .eq('id', newTweet.id);
          }
        }

        // Update suggestion status to published
        const { data, error } = await supabase
          .from('suggestions')
          .update({ status: 'published' })
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, suggestion: data }),
        };
      }

      // Just update status
      const { data, error } = await supabase
        .from('suggestions')
        .update({ status })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, suggestion: data }),
      };
    }

    // DELETE - Delete suggestion (admin only)
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);

      const { error } = await supabase
        .from('suggestions')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Suggestions error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Operation failed' }),
    };
  }
};
