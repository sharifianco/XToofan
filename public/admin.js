// Token management
let authToken = localStorage.getItem('adminToken');

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
}

// Check admin status on page load
document.addEventListener('DOMContentLoaded', async () => {
  if (authToken) {
    // Verify token by trying to fetch tweets
    try {
      const res = await fetch('/api/admin-tweets', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showAdminPanel();
        loadTweets();
      } else {
        localStorage.removeItem('adminToken');
        authToken = null;
        showLoginForm();
      }
    } catch (error) {
      showLoginForm();
    }
  } else {
    showLoginForm();
  }

  // Setup character counters
  setupCharCounter('tweet-text', 'char-counter');
  setupCharCounter('edit-tweet-text', 'edit-char-counter');
});

function showLoginForm() {
  document.getElementById('login-section').classList.remove('hidden');
  document.getElementById('admin-section').classList.add('hidden');
}

function showAdminPanel() {
  document.getElementById('login-section').classList.add('hidden');
  document.getElementById('admin-section').classList.remove('hidden');
}

function setupCharCounter(textareaId, counterId) {
  const textarea = document.getElementById(textareaId);
  const counter = document.getElementById(counterId);

  if (textarea && counter) {
    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      counter.textContent = `${len}/280`;
      counter.classList.toggle('warning', len > 260);
    });
  }
}

// Login form
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');

  try {
    const res = await fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    const data = await res.json();

    if (res.ok && data.token) {
      authToken = data.token;
      localStorage.setItem('adminToken', authToken);
      showAdminPanel();
      loadTweets();
    } else {
      errorEl.textContent = data.error || 'Invalid password';
    }
  } catch (error) {
    errorEl.textContent = 'Login failed. Please try again.';
  }
});

// Logout function
function logout() {
  localStorage.removeItem('adminToken');
  authToken = null;
  showLoginForm();
}

// Add tweet form
document.getElementById('add-tweet-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const text = document.getElementById('tweet-text').value.trim();
  const category = document.getElementById('tweet-category').value.trim();
  const comment_tweet_url = document.getElementById('comment-url').value.trim();

  try {
    const res = await fetch('/api/admin-tweets', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ text, category: category || null, comment_tweet_url: comment_tweet_url || null })
    });

    if (res.ok) {
      showToast('Tweet added successfully!', 'success');
      document.getElementById('add-tweet-form').reset();
      document.getElementById('char-counter').textContent = '0/280';
      loadTweets();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to add tweet', 'error');
    }
  } catch (error) {
    showToast('Failed to add tweet', 'error');
  }
});

// Load tweets
async function loadTweets() {
  const container = document.getElementById('tweet-list');

  try {
    const res = await fetch('/api/admin-tweets', {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Failed to load tweets');

    const { tweets } = await res.json();

    if (!tweets || tweets.length === 0) {
      container.innerHTML = '<p style="color: #8b98a5; text-align: center;">No tweets yet. Add one above!</p>';
      return;
    }

    container.innerHTML = tweets.map(tweet => `
      <div class="admin-tweet-card ${tweet.active ? '' : 'inactive'}" data-id="${tweet.id}">
        <div class="tweet-header">
          <div class="tweet-meta">
            <span class="status-badge ${tweet.active ? 'active' : 'inactive'}">
              ${tweet.active ? 'Active' : 'Inactive'}
            </span>
            ${tweet.category ? `<span class="category">${escapeHtml(tweet.category)}</span>` : ''}
          </div>
          <div class="tweet-actions">
            <button class="btn btn-secondary btn-sm" onclick="editTweet('${tweet.id}')">Edit</button>
            <button class="btn btn-warning btn-sm" onclick="toggleTweet('${tweet.id}', ${!tweet.active})">
              ${tweet.active ? 'Deactivate' : 'Activate'}
            </button>
            <button class="btn btn-danger btn-sm" onclick="deleteTweet('${tweet.id}')">Delete</button>
          </div>
        </div>
        <p class="tweet-text">${escapeHtml(tweet.text)}</p>
        ${tweet.comment_tweet_url ? `<p class="tweet-comment-url">Reply to: ${escapeHtml(tweet.comment_tweet_url)}</p>` : ''}
      </div>
    `).join('');
  } catch (error) {
    console.error('Load tweets error:', error);
    container.innerHTML = '<p class="error">Failed to load tweets</p>';
  }
}

// Edit tweet
let currentEditTweet = null;

async function editTweet(id) {
  try {
    const res = await fetch('/api/admin-tweets', {
      headers: getAuthHeaders()
    });
    const { tweets } = await res.json();
    const tweet = tweets.find(t => t.id === id);

    if (!tweet) {
      showToast('Tweet not found', 'error');
      return;
    }

    currentEditTweet = tweet;
    document.getElementById('edit-tweet-id').value = tweet.id;
    document.getElementById('edit-tweet-text').value = tweet.text;
    document.getElementById('edit-tweet-category').value = tweet.category || '';
    document.getElementById('edit-comment-url').value = tweet.comment_tweet_url || '';
    document.getElementById('edit-char-counter').textContent = `${tweet.text.length}/280`;

    document.getElementById('edit-modal').classList.remove('hidden');
  } catch (error) {
    showToast('Failed to load tweet', 'error');
  }
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.add('hidden');
  currentEditTweet = null;
}

// Edit form submit
document.getElementById('edit-tweet-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('edit-tweet-id').value;
  const text = document.getElementById('edit-tweet-text').value.trim();
  const category = document.getElementById('edit-tweet-category').value.trim();
  const comment_tweet_url = document.getElementById('edit-comment-url').value.trim();

  try {
    const res = await fetch('/api/admin-tweets', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id,
        text,
        category: category || null,
        comment_tweet_url: comment_tweet_url || null,
        active: currentEditTweet.active
      })
    });

    if (res.ok) {
      showToast('Tweet updated successfully!', 'success');
      closeEditModal();
      loadTweets();
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to update tweet', 'error');
    }
  } catch (error) {
    showToast('Failed to update tweet', 'error');
  }
});

// Toggle tweet active status
async function toggleTweet(id, active) {
  try {
    // First get the current tweet data
    const tweetsRes = await fetch('/api/admin-tweets', {
      headers: getAuthHeaders()
    });
    const { tweets } = await tweetsRes.json();
    const tweet = tweets.find(t => t.id === id);

    if (!tweet) {
      showToast('Tweet not found', 'error');
      return;
    }

    const res = await fetch('/api/admin-tweets', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        id,
        text: tweet.text,
        category: tweet.category,
        comment_tweet_url: tweet.comment_tweet_url,
        active
      })
    });

    if (res.ok) {
      showToast(`Tweet ${active ? 'activated' : 'deactivated'}`, 'success');
      loadTweets();
    } else {
      showToast('Failed to update tweet', 'error');
    }
  } catch (error) {
    showToast('Failed to update tweet', 'error');
  }
}

// Delete tweet
async function deleteTweet(id) {
  if (!confirm('Are you sure you want to delete this tweet?')) return;

  try {
    const res = await fetch('/api/admin-tweets', {
      method: 'DELETE',
      headers: getAuthHeaders(),
      body: JSON.stringify({ id })
    });

    if (res.ok) {
      showToast('Tweet deleted', 'success');
      loadTweets();
    } else {
      showToast('Failed to delete tweet', 'error');
    }
  } catch (error) {
    showToast('Failed to delete tweet', 'error');
  }
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
