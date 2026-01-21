const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { data, error } = await supabase
      .from('tweets')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Get click counts for all short codes
    const shortCodes = data.filter(t => t.short_code).map(t => t.short_code);
    let clickCounts = {};

    if (shortCodes.length > 0) {
      const { data: linkData, error: linkError } = await supabase
        .from('deep_links')
        .select('short_code, clicks')
        .in('short_code', shortCodes);

      if (!linkError && linkData) {
        linkData.forEach(link => {
          clickCounts[link.short_code] = link.clicks || 0;
        });
      }
    }

    // Add click count to each tweet
    const tweetsWithClicks = data.map(tweet => ({
      ...tweet,
      link_clicks: tweet.short_code ? (clickCounts[tweet.short_code] || 0) : 0
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ tweets: tweetsWithClicks }),
    };
  } catch (error) {
    console.error('Fetch tweets error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch tweets' }),
    };
  }
};
