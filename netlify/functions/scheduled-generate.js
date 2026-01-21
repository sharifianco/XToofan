const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// This function runs daily at 8:00 AM UTC via Netlify Scheduled Functions
// Configure in netlify.toml

const personas = ['advocate', 'journalist', 'storyteller'];

async function generateTweetsWithGemini(count, persona) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const personaPrompts = {
    advocate: `Act as a global human rights advocate and social media strategist. Generate impactful tweets regarding the current situation in Iran.

Guidelines:
- Tone: Urgent, authoritative, and compassionate.
- Focus: Highlight the need for international intervention, the bravery of the people, and the gravity of the human rights violations.
- Structure: Keep each tweet under 240 characters. Use 1-2 relevant emojis.
- Mandatory Hashtags: Include #IranMassacre, #R2PforIran, and #IranRevolution2026 in every tweet.
- Call to Action: Encourage the international community or the UN to take notice.`,
    journalist: `You are an independent journalist covering the 2026 events in Iran. Write concise, news-style tweets.

Guidelines:
- Tone: Objective but firm. Use 'active voice.'
- Content: Focus on the scale of the protests, the response of the authorities, and the resilience of the Iranian youth.
- Formatting: Use short sentences. Ensure the hashtags #IranMassacre, #R2PforIran, and #IranRevolution2026 are placed at the end of the text.
- Avoid: Overly poetic language; stick to the gravity of the situation.`,
    storyteller: `Write tweets that capture the heartbeat of the Iranian revolution.

Guidelines:
- Tone: Poetic, defiant, and moving.
- Themes: Hope, sacrifice, the longing for freedom, and the memory of those lost.
- Technical Specs: Incorporate the hashtags #IranMassacre, #R2PforIran, and #IranRevolution2026 naturally within or at the end of the posts.
- Goal: To make the global audience feel the importance of the 'Responsibility to Protect' principle.`
  };

  const prompt = `${personaPrompts[persona]}

Generate exactly ${count} unique tweets. Each tweet MUST be under 280 characters total.

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
    throw new Error(`Gemini API error: ${error}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('No content in Gemini response');
  }

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Could not parse tweets from Gemini response');
  }

  const tweets = JSON.parse(jsonMatch[0]);
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
function buildIntentUrl(tweetText) {
  const baseUrl = 'https://twitter.com/intent/tweet';
  const params = new URLSearchParams();
  params.set('text', tweetText);
  return `${baseUrl}?${params.toString()}`;
}

// Create short link for a tweet
async function createShortLink(tweetData) {
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

  const intentUrl = buildIntentUrl(tweetData.text);

  const { data, error } = await supabase
    .from('deep_links')
    .insert([{
      short_code: shortCode,
      tweet_id: String(tweetData.id),
      tweet_text: tweetData.text,
      intent_url: intentUrl,
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating short link:', error);
    console.error('Tweet data:', { id: tweetData.id, text: tweetData.text?.substring(0, 50) });
    return null;
  }

  return shortCode;
}

exports.handler = async (event) => {
  console.log('Scheduled tweet generation started');

  try {
    // Generate 10 tweets total - mix of personas
    // 4 advocate + 3 journalist + 3 storyteller
    const allTweets = [];
    const today = new Date().toISOString().split('T')[0];

    // Generate from different personas for variety
    const generationPlan = [
      { persona: 'advocate', count: 4 },
      { persona: 'journalist', count: 3 },
      { persona: 'storyteller', count: 3 },
    ];

    for (const { persona, count } of generationPlan) {
      try {
        const tweets = await generateTweetsWithGemini(count, persona);
        allTweets.push(...tweets.map(text => ({
          text,
          category: `AI - ${persona.charAt(0).toUpperCase() + persona.slice(1)}`,
        })));
      } catch (err) {
        console.error(`Failed to generate ${persona} tweets:`, err.message);
      }
    }

    if (allTweets.length === 0) {
      console.error('No tweets generated');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to generate any tweets' }),
      };
    }

    // Save to database
    let savedCount = 0;
    for (const tweet of allTweets) {
      const { data, error } = await supabase
        .from('tweets')
        .insert([{
          text: tweet.text,
          category: tweet.category,
          active: true,
        }])
        .select()
        .single();

      if (!error && data) {
        // Generate short link for the new tweet
        const shortCode = await createShortLink(data);
        if (shortCode) {
          await supabase
            .from('tweets')
            .update({ short_code: shortCode })
            .eq('id', data.id);
        }
        savedCount++;
      } else {
        console.error('Error saving tweet:', error);
      }
    }

    console.log(`Scheduled generation complete: ${savedCount}/${allTweets.length} tweets saved`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        generated: allTweets.length,
        saved: savedCount,
        date: today,
      }),
    };
  } catch (error) {
    console.error('Scheduled generation error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
