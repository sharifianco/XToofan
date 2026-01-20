require('dotenv').config();

const express = require('express');
const session = require('express-session');
const supabase = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Admin auth middleware
function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) {
    return res.status(401).json({ error: 'Admin access required' });
  }
  next();
}

// Serve static files
app.use(express.static('public'));

// Get tweets from Supabase (public - no auth required)
app.get('/api/tweets', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tweets')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json({ tweets: data });
  } catch (error) {
    console.error('Fetch tweets error:', error);
    res.status(500).json({ error: 'Failed to fetch tweets' });
  }
});

// ============ ADMIN ROUTES ============

// Admin login
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Admin logout
app.get('/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/admin.html');
});

// Check admin status
app.get('/admin/status', (req, res) => {
  res.json({ isAdmin: !!req.session.isAdmin });
});

// Get all tweets (including inactive) for admin
app.get('/admin/tweets', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('tweets')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ tweets: data });
  } catch (error) {
    console.error('Admin fetch tweets error:', error);
    res.status(500).json({ error: 'Failed to fetch tweets' });
  }
});

// Create new tweet
app.post('/admin/tweets', requireAdmin, async (req, res) => {
  try {
    const { text, category, comment_tweet_url } = req.body;

    if (!text || text.length > 280) {
      return res.status(400).json({ error: 'Tweet text is required and must be 280 characters or less' });
    }

    const { data, error } = await supabase
      .from('tweets')
      .insert([{ text, category, comment_tweet_url, active: true }])
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, tweet: data });
  } catch (error) {
    console.error('Create tweet error:', error);
    res.status(500).json({ error: 'Failed to create tweet' });
  }
});

// Update tweet
app.put('/admin/tweets/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { text, category, comment_tweet_url, active } = req.body;

    const { data, error } = await supabase
      .from('tweets')
      .update({ text, category, comment_tweet_url, active })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, tweet: data });
  } catch (error) {
    console.error('Update tweet error:', error);
    res.status(500).json({ error: 'Failed to update tweet' });
  }
});

// Delete tweet
app.delete('/admin/tweets/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('tweets')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('Delete tweet error:', error);
    res.status(500).json({ error: 'Failed to delete tweet' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
