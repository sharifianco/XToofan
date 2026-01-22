const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Generate a short random code
function generateShortCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    // POST - Create a new short link
    if (event.httpMethod === 'POST') {
      const { tweet_id, tweet_text, intent_url } = JSON.parse(event.body);

      if (!intent_url) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'intent_url is required' }),
        };
      }

      // Check if link already exists for this tweet
      if (tweet_id) {
        const { data: existing } = await supabase
          .from('deep_links')
          .select('short_code')
          .eq('tweet_id', tweet_id)
          .single();

        if (existing) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              short_code: existing.short_code,
              short_url: `https://xtoofan.site/l/${existing.short_code}`,
            }),
          };
        }
      }

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
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to generate unique code' }),
        };
      }

      // Save the deep link
      const { data, error } = await supabase
        .from('deep_links')
        .insert([{
          short_code: shortCode,
          tweet_id: tweet_id || null,
          tweet_text: tweet_text || null,
          intent_url: intent_url,
        }])
        .select()
        .single();

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          short_code: data.short_code,
          short_url: `https://xtoofan.site/l/${data.short_code}`,
        }),
      };
    }

    // GET - Retrieve link data by short code
    if (event.httpMethod === 'GET') {
      const code = event.queryStringParameters?.code;

      if (!code) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'code parameter is required' }),
        };
      }

      const { data, error } = await supabase
        .from('deep_links')
        .select('*')
        .eq('short_code', code)
        .single();

      if (error || !data) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Link not found' }),
        };
      }

      // Increment click count
      await supabase
        .from('deep_links')
        .update({ clicks: (data.clicks || 0) + 1 })
        .eq('id', data.id);

      // Parse intent_url - could be JSON string (new format) or plain URL (old format)
      let deepLinks;
      try {
        const parsedIntent = JSON.parse(data.intent_url);
        // New format: { ios, android, fallback }
        deepLinks = {
          ios: parsedIntent.ios,
          android: parsedIntent.android,
          fallback: parsedIntent.fallback,
        };
      } catch {
        // Old format: plain URL string
        const intentUrl = data.intent_url;
        deepLinks = {
          ios: intentUrl.replace('twitter.com/intent/tweet', 'x.com/intent/post').replace('text=', 'text='),
          android: intentUrl.replace('twitter.com/intent/tweet', 'x.com/intent/post'),
          fallback: intentUrl.replace('twitter.com', 'x.com'),
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ...data,
          deep_links: deepLinks,
        }),
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
