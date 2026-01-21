const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET;

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { password } = JSON.parse(event.body);

    if (password === process.env.ADMIN_PASSWORD) {
      const token = jwt.sign({ isAdmin: true }, JWT_SECRET, { expiresIn: '24h' });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, token }),
      };
    } else {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid password' }),
      };
    }
  } catch (error) {
    console.error('Login error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Login failed' }),
    };
  }
};
