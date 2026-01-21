const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;

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
