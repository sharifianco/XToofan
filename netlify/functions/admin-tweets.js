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

  // Save the deep link - store tweet_id as string to avoid foreign key issues
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
    console.error('Tweet data:', { id: tweet.id, text: tweet.text?.substring(0, 50) });
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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
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

      // If action is 'backfill-links', generate links for tweets without short_code AND update existing deep_links
      if (body.action === 'backfill-links') {
        let generated = 0;
        let updated = 0;
        const errors = [];

        // PART 1: Generate short links for tweets without short_code
        const { data: tweets, error: fetchError } = await supabase
          .from('tweets')
          .select('*')
          .or('short_code.is.null,short_code.eq.');

        if (fetchError) {
          console.error('Error fetching tweets:', fetchError);
          throw fetchError;
        }

        console.log(`Found ${tweets?.length || 0} tweets without short links`);

        for (const tweet of tweets || []) {
          try {
            const shortCode = await createShortLink(tweet);
            if (shortCode) {
              const { error: updateError } = await supabase
                .from('tweets')
                .update({ short_code: shortCode })
                .eq('id', tweet.id);

              if (updateError) {
                console.error(`Error updating tweet ${tweet.id}:`, updateError);
                errors.push({ tweet_id: tweet.id, error: updateError.message });
              } else {
                generated++;
              }
            }
          } catch (err) {
            console.error(`Error processing tweet ${tweet.id}:`, err);
            errors.push({ tweet_id: tweet.id, error: err.message });
          }
        }

        // PART 2: Update intent_url for existing deep_links (keep same short_code)
        const { data: existingLinks, error: linksError } = await supabase
          .from('deep_links')
          .select('*');

        if (linksError) {
          console.error('Error fetching deep_links:', linksError);
        } else {
          console.log(`Found ${existingLinks?.length || 0} existing deep_links to update`);

          for (const link of existingLinks || []) {
            try {
              // Get the tweet to rebuild the intent_url
              const { data: tweet } = await supabase
                .from('tweets')
                .select('*')
                .eq('id', link.tweet_id)
                .single();

              if (tweet) {
                const newIntentUrl = buildIntentUrl(tweet);

                const { error: updateLinkError } = await supabase
                  .from('deep_links')
                  .update({
                    intent_url: newIntentUrl,
                    tweet_text: tweet.text // Also update tweet_text in case it changed
                  })
                  .eq('id', link.id);

                if (updateLinkError) {
                  console.error(`Error updating deep_link ${link.id}:`, updateLinkError);
                  errors.push({ link_id: link.id, error: updateLinkError.message });
                } else {
                  updated++;
                }
              }
            } catch (err) {
              console.error(`Error updating deep_link ${link.id}:`, err);
              errors.push({ link_id: link.id, error: err.message });
            }
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: `Generated ${generated} new short links, updated ${updated} existing deep_links`,
            generated,
            updated,
            total_tweets: tweets?.length || 0,
            total_links: existingLinks?.length || 0,
            errors: errors.length > 0 ? errors : undefined,
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
