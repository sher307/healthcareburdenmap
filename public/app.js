// ── DOM References ─────────────────────────────────────────
const messagesDiv = document.getElementById('messages');
const input       = document.getElementById('user-input');
const sendBtn     = document.getElementById('send-btn');

// ── Conversation History ───────────────────────────────────
// Claude needs the full message history on each request
let history = [];

// ── Event Listeners ────────────────────────────────────────
sendBtn.addEventListener('click', sendMessage);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// ── Send Message ───────────────────────────────────────────
async function sendMessage() {
  const userText = input.value.trim();
  if (!userText) return;

  // Show user message
  addMessage('user', userText);
  history.push({ role: 'user', content: userText });
  input.value = '';

  // Disable input while waiting
  setLoading(true);

  // Show typing indicator
  const typingEl = addMessage('assistant', 'Claude is thinking…', true);

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.error?.message || 'Something went wrong.');
    }

    const reply = data.content[0].text;

    // Remove typing indicator, show real reply
    typingEl.remove();
    addMessage('assistant', reply);
    history.push({ role: 'assistant', content: reply });

  } catch (err) {
    typingEl.remove();
    addMessage('assistant', `⚠️ Error: ${err.message}`);
    console.error(err);
  }

  setLoading(false);
}

// ── Helper: Add a message bubble ──────────────────────────
function addMessage(role, text, isTyping = false) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}${isTyping ? ' typing' : ''}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  wrapper.appendChild(bubble);
  messagesDiv.appendChild(wrapper);

  // Auto-scroll to latest message
  messagesDiv.scrollTop = messagesDiv.scrollHeight;

  return wrapper;
}

// ── Helper: Toggle loading state ──────────────────────────
function setLoading(isLoading) {
  sendBtn.disabled = isLoading;
  input.disabled   = isLoading;
  if (!isLoading) input.focus();
}
