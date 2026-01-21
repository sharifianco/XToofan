const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Tweet generation personas
const personas = {
  advocate: {
    name: 'Human Rights Advocate',
    prompt: `Act as a global human rights advocate and social media strategist. Generate impactful tweets regarding the current situation in Iran.

Guidelines:
- Tone: Urgent, authoritative, and compassionate.
- Focus: Highlight the need for international intervention, the bravery of the people, and the gravity of the human rights violations.
- Structure: Keep each tweet under 240 characters. Use 1-2 relevant emojis.
- Mandatory Hashtags: Include #IranMassacre, #R2PforIran, and #IranRevolution2026 in every tweet.
- Call to Action: Encourage the international community or the UN to take notice.`
  },
  journalist: {
    name: 'Breaking News Journalist',
    prompt: `You are an independent journalist covering the 2026 events in Iran. Write concise, news-style tweets.

Guidelines:
- Tone: Objective but firm. Use 'active voice.'
- Content: Focus on the scale of the protests, the response of the authorities, and the resilience of the Iranian youth.
- Formatting: Use short sentences. Ensure the hashtags #IranMassacre, #R2PforIran, and #IranRevolution2026 are placed at the end of the text.
- Avoid: Overly poetic language; stick to the gravity of the situation.`
  },
  storyteller: {
    name: 'Emotional Storyteller',
    prompt: `Write tweets that capture the heartbeat of the Iranian revolution.

Guidelines:
- Tone: Poetic, defiant, and moving.
- Themes: Hope, sacrifice, the longing for freedom, and the memory of those lost.
- Technical Specs: Incorporate the hashtags #IranMassacre, #R2PforIran, and #IranRevolution2026 naturally within or at the end of the posts.
- Goal: To make the global audience feel the importance of the 'Responsibility to Protect' principle.`
  }
};

async function generateTweetsWithGemini(count, persona, topic) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is not set');
    throw new Error('GEMINI_API_KEY not configured. Please add it to Netlify environment variables.');
  }

  console.log('Generating tweets with Gemini:', { count, persona, hasTopic: !!topic });

  const selectedPersona = personas[persona] || personas.advocate;

  let prompt = `${selectedPersona.prompt}

Generate exactly ${count} unique tweets. Each tweet MUST be under 280 characters total.
${topic ? `Today's focus topic: ${topic}` : ''}

IMPORTANT: Return ONLY a valid JSON array of strings, no other text. Example format:
["Tweet 1 text here #IranMassacre #R2PforIran", "Tweet 2 text here #IranRevolution2026"]`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error('Gemini API error response:', error);
    throw new Error(`Gemini API error: ${error}`);
  }

  const data = await response.json();
  console.log('Gemini response received, candidates:', data.candidates?.length);

  // Extract text from Gemini response
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('No content in Gemini response');
  }

  // Parse the JSON array from the response
  // Try to find JSON array in the response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Could not parse tweets from Gemini response');
  }

  const tweets = JSON.parse(jsonMatch[0]);

  // Validate and filter tweets
  return tweets
    .filter(tweet => typeof tweet === 'string' && tweet.length > 0 && tweet.length <= 280)
    .slice(0, count);
}

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
  return `${baseUrl}?${params.toString()}`;
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
    console.error('Tweet data:', { id: tweet.id, text: tweet.text?.substring(0, 50) });
    return null;
  }

  return shortCode;
}

async function saveTweetsToDatabase(tweets, category) {
  const results = [];

  for (const text of tweets) {
    const { data, error } = await supabase
      .from('tweets')
      .insert([{
        text,
        category: category || 'AI Generated',
        active: true,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error saving tweet:', error);
    } else {
      // Generate short link for the new tweet
      const shortCode = await createShortLink(data);
      if (shortCode) {
        await supabase
          .from('tweets')
          .update({ short_code: shortCode })
          .eq('id', data.id);
        data.short_code = shortCode;
      }
      results.push(data);
    }
  }

  return results;
}

// Verify admin token
function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice(7);
  // Simple JWT verification - in production use proper JWT library
  try {
    const [, payload] = token.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    return decoded.exp > Date.now() / 1000;
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
    // Check for admin auth or scheduled trigger
    // Headers are lowercase in Netlify functions
    const isScheduled = event.headers['x-netlify-scheduled'] === 'true';
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const isAdmin = verifyToken(authHeader);

    console.log('Auth check:', { isScheduled, hasAuthHeader: !!authHeader, isAdmin });

    if (!isScheduled && !isAdmin) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized - Please login again' }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const {
      count = 10,
      persona = 'advocate',
      topic = '',
      category = 'AI Generated',
      autoSave = true,
    } = body;

    // Generate tweets
    const tweets = await generateTweetsWithGemini(
      Math.min(count, 20), // Max 20 tweets per request
      persona,
      topic
    );

    if (tweets.length === 0) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to generate tweets' }),
      };
    }

    // Save to database if autoSave is true
    let savedTweets = [];
    if (autoSave) {
      savedTweets = await saveTweetsToDatabase(tweets, category);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        generated: tweets.length,
        saved: savedTweets.length,
        tweets: autoSave ? savedTweets : tweets.map(text => ({ text })),
      }),
    };
  } catch (error) {
    console.error('Error generating tweets:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
