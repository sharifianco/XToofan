// Track clicked tweets in localStorage
function getClickedTweets() {
  try {
    return JSON.parse(localStorage.getItem('clickedTweets') || '[]');
  } catch {
    return [];
  }
}

function markTweetAsClicked(tweetId) {
  const clicked = getClickedTweets();
  if (!clicked.includes(tweetId)) {
    clicked.push(tweetId);
    localStorage.setItem('clickedTweets', JSON.stringify(clicked));
  }
  // Update UI
  const card = document.querySelector(`.tweet-card[data-id="${tweetId}"]`);
  if (card) {
    card.classList.add('clicked');
    const btn = card.querySelector('.btn-post');
    if (btn) {
      btn.classList.add('clicked');
      const originalText = btn.textContent.trim();
      if (!originalText.includes('✓')) {
        btn.innerHTML = `✓ ${originalText}`;
      }
    }
  }
}

function isTweetClicked(tweetId) {
  return getClickedTweets().includes(tweetId);
}

// Load tweets on page load
document.addEventListener('DOMContentLoaded', async () => {
  await loadTweets();
});

async function loadTweets() {
  const container = document.getElementById('tweets-container');

  try {
    const res = await fetch('/api/tweets');
    if (!res.ok) throw new Error('Failed to load tweets');

    const { tweets } = await res.json();

    if (!tweets || tweets.length === 0) {
      container.innerHTML = '<p class="empty-state">No tweets available.</p>';
      return;
    }

    container.innerHTML = tweets.map(tweet => {
      const intentUrl = buildIntentUrl(tweet);
      const isClicked = isTweetClicked(tweet.id);
      const buttonText = tweet.comment_tweet_url ? 'Reply on X' : 'Post on X';

      return `
        <div class="tweet-card ${isClicked ? 'clicked' : ''}" data-id="${tweet.id}">
          <div class="tweet-badges">
            ${tweet.category ? `<span class="category">${escapeHtml(tweet.category)}</span>` : ''}
            ${tweet.comment_tweet_url ? `<span class="category reply-badge">Reply</span>` : ''}
            ${isClicked ? '<span class="category clicked-badge">Posted</span>' : ''}
          </div>
          ${tweet.comment_tweet_url ? `
            <div class="reply-preview">
              <a href="${escapeHtml(tweet.comment_tweet_url)}" target="_blank" class="reply-link">
                View original tweet you're replying to
              </a>
            </div>
          ` : ''}
          <p class="text">${escapeHtml(tweet.text)}</p>
          <span class="char-count">${tweet.text.length}/280 characters</span>
          <a href="${intentUrl}" target="_blank" class="btn btn-post ${isClicked ? 'clicked' : ''}" onclick="markTweetAsClicked('${tweet.id}')">
            ${isClicked ? '✓ ' : ''}${buttonText}
          </a>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Load tweets error:', error);
    container.innerHTML = '<p class="error">Failed to load tweets. Please refresh the page.</p>';
  }
}

// Build X intent URL for tweet or reply
function buildIntentUrl(tweet) {
  const baseUrl = 'https://twitter.com/intent/tweet';
  const params = new URLSearchParams();

  // Add the tweet text
  params.set('text', tweet.text);

  // If it's a reply, add the in_reply_to parameter
  if (tweet.comment_tweet_url) {
    const match = tweet.comment_tweet_url.match(/status\/(\d+)/);
    if (match) {
      params.set('in_reply_to', match[1]);
    }
  }

  return `${baseUrl}?${params.toString()}`;
}

function showToast(message, type) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
