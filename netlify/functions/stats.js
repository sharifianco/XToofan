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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    // POST - Record a click
    if (event.httpMethod === 'POST') {
      const { tweet_id } = JSON.parse(event.body);

      const { error } = await supabase
        .from('click_stats')
        .insert([{ tweet_id }]);

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };
    }

    // GET - Get total click count
    if (event.httpMethod === 'GET') {
      const { count, error } = await supabase
        .from('click_stats')
        .select('*', { count: 'exact', head: true });

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ total_clicks: count }),
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
