const http = require("http");
const fs   = require("fs");
const path = require("path");

const API_KEY = ''; // 👈 Replace this with your key
const PORT    = 3000;
const PUBLIC  = path.join(__dirname, 'public');

// ── MIME types for static files ────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'text/javascript',
};

const server = http.createServer(async (req, res) => {

  // ── POST /chat → proxy to Claude ────────────────────────
  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { messages } = JSON.parse(body);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key':         API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type':      'application/json',
          },
          body: JSON.stringify({
            model:      'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system:     'You are a health and social justice guide. Help users who viewed the interactive health burden map on the index page interpret and understand the patterns they are seeing.Ask clarifying questions to give personalized advice.',
            messages,
          }),
        });

        const data = await response.json();
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));

      } catch (err) {
        console.error('Claude API error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  // ── GET → serve static files from /public ───────────────
  let filePath = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  const ext    = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
