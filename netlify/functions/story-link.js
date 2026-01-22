const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

// Build X intent URLs for tweet (iOS, Android, fallback)
function buildIntentUrl(text, replyUrl) {
  const encodedText = encodeURIComponent(text);

  // Handle reply if replyUrl exists
  let replyParam = '';
  if (replyUrl) {
    const match = replyUrl.match(/status\/(\d+)/);
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { text, reply_url, turnstile_token } = JSON.parse(event.body);

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

    // Validate text
    if (!text || text.length > 280) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'متن توییت الزامی است و باید حداکثر ۲۸۰ کاراکتر باشد' }),
      };
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
        body: JSON.stringify({ error: 'خطا در ساخت لینک. لطفا دوباره تلاش کنید.' }),
      };
    }

    // Build intent URL
    const intentUrl = buildIntentUrl(text, reply_url);

    // Save to deep_links table (without tweet_id since it's user-generated)
    const { data: linkData, error: linkError } = await supabase
      .from('deep_links')
      .insert([{
        short_code: shortCode,
        tweet_id: null,
        tweet_text: text,
        intent_url: intentUrl,
      }])
      .select()
      .single();

    if (linkError) {
      console.error('Error creating deep link:', linkError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'خطا در ساخت لینک' }),
      };
    }

    // Also save to suggestions for admin review
    await supabase
      .from('suggestions')
      .insert([{
        text,
        reply_url: reply_url || null,
        submitter_name: 'Story Link User',
        status: 'pending'
      }]);

    const shortUrl = `https://xtoofan.site/l/${shortCode}`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        short_code: shortCode,
        short_url: shortUrl,
      }),
    };
  } catch (error) {
    console.error('Story link error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'خطا در ساخت لینک' }),
    };
  }
};
