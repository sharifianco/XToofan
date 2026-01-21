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

  try {
    // POST - Submit new suggestion (public)
    if (event.httpMethod === 'POST') {
      const { text, reply_url, submitter_name } = JSON.parse(event.body);

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
        const { error: tweetError } = await supabase
          .from('tweets')
          .insert([{
            text: suggestion.text,
            comment_tweet_url: suggestion.reply_url,
            active: true
          }]);

        if (tweetError) throw tweetError;

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
