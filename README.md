# طوفان توییتری - XToofan

A simple web app for organizing Twitter storms in support of **Free Iran** movement.

## What is this?

This app helps activists and supporters coordinate tweet storms by providing pre-written tweets that users can post with a single click. Instead of everyone writing their own tweets, organizers can prepare impactful messages that supporters can easily share.

## How it works

1. **Admin** adds pre-written tweets via the admin panel
2. **Supporters** visit the website and see all available tweets
3. **One click** opens X (Twitter) with the tweet text pre-filled
4. **User posts** the tweet from their own account

No login required. No API keys needed for users. Simple and accessible.

## Features

- Pre-written tweets stored in database
- One-click posting via X Web Intents
- Reply/comment tweets support
- Admin panel for managing tweets
- RTL (Persian) support
- Mobile-friendly design
- Dark theme (X-style)

## Setup

### Prerequisites

- Node.js 18+
- Supabase account (free tier works)

### Database Setup

1. Create a Supabase project at https://supabase.com
2. Run this SQL to create the tweets table:

```sql
CREATE TABLE tweets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  text TEXT NOT NULL CHECK (char_length(text) <= 280),
  category TEXT,
  comment_tweet_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Installation

```bash
# Clone the repository
git clone https://github.com/sharifianco/XToofan.git
cd XToofan

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
# - SUPABASE_URL
# - SUPABASE_ANON_KEY
# - SESSION_SECRET
# - ADMIN_PASSWORD

# Start the server
npm start
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `SESSION_SECRET` | Random string for session encryption |
| `ADMIN_PASSWORD` | Password for admin panel access |

## Usage

### For Supporters

1. Visit the website
2. Browse available tweets
3. Click "Post on X" button
4. X app/website opens with pre-filled text
5. Review and post!

### For Admins

1. Go to `/admin.html`
2. Login with admin password
3. Add, edit, or delete tweets
4. Set tweets as active/inactive

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: Supabase (PostgreSQL)
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Posting**: X Web Intents (no API required)

## Why Web Intents?

Using X Web Intents instead of API:
- No X Developer account needed
- No API rate limits
- Users post from their own accounts
- Works on mobile (opens X app)
- More transparent (users see what they're posting)

---

## زن، زندگی، آزادی
## Woman, Life, Freedom

This project is dedicated to the brave people of Iran fighting for freedom and democracy.

---

## License

MIT
