// public/script.js
// Client logic for chat.html + index.html flow
// Works with the server.js above: joinRoom, emits 'chat', uploads via /upload, then emits 'file'

(function () {
  // detect whether we're on index (join) or chat page by checking DOM elements
  // chat.html is expected to include this script and have the elements used below.
  // If on index.html, index.html contains its own short script to redirect to chat.html (we provided earlier).
  const socket = io();

  // ---- Utilities ----
  function qs(id) { return document.getElementById(id); }
  function humanSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0;
    let n = Number(bytes);
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(1)} ${units[i]}`;
  }

  // If chatbox element isn't present, nothing to do (this allows same script on multiple pages)
  const chatbox = qs('chatbox');
  if (!chatbox) return;

  // Parse username and room from query string (chat.html?username=...&room=...)
  const params = new URLSearchParams(location.search);
  const name = params.get('username') || params.get('name') || params.get('user') || 'Anon';
  const room = params.get('room') || params.get('r') || '';

  if (!room || !name) {
    alert('Missing room or name. Go back and join a room first.');
    location.href = '/';
    throw new Error('Missing room or name');
  }

  // Update UI
  const roomNameEl = qs('roomName');
  if (roomNameEl) roomNameEl.innerText = `Room: ${room}`;

  // Join server room
  socket.emit('joinRoom', { room, name });

  // ---- Socket event handlers ----
  // get existing history
  socket.on('chatHistory', (messages) => {
    chatbox.innerHTML = '';
    messages.forEach(addMessageToDOM);
    chatbox.scrollTop = chatbox.scrollHeight;
  });

  // new incoming chat message (either text or file)
  socket.on('chat', (msg) => {
    addMessageToDOM(msg);
  });

  // optional events
  socket.on('full', () => {
    alert('Room is full.');
    location.href = '/';
  });
  socket.on('joinError', (obj) => {
    alert('Could not join room: ' + (obj && obj.error ? obj.error : 'Unknown error'));
    location.href = '/';
  });

  // ---- Sending text ----
  const msgInput = qs('msg');
  const chatForm = qs('chatForm');
  if (chatForm) {
    chatForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const text = msgInput.value.trim();
      if (!text) return;
      socket.emit('chat', text);
      msgInput.value = '';
      // optimistic local echo is handled by server broadcasting back
    });
  }

  // allow Enter to send (already handled by form submit), but keep for safety
  if (msgInput) {
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (chatForm) chatForm.requestSubmit();
      }
    });
  }

  // ---- File upload flow ----
  const fileInput = qs('fileInput');
  const fileLabel = document.querySelector('.file-label');

  if (fileLabel && fileInput) {
    // when user clicks the label, fileInput will open because label is for=fileInput
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      // optional: brief client-side size/type checks
      const maxBytes = (10 * 1024 * 1024); // keep in sync with server MAX_FILE_MB
      if (file.size > maxBytes) {
        alert(`File too large. Max is ${humanSize(maxBytes)}.`);
        fileInput.value = '';
        return;
      }

      // Build FormData and POST to /upload
      const fd = new FormData();
      fd.append('file', file);
      try {
        // show a simple uploading indicator on the file label
        const prevLabel = fileLabel.innerText;
        fileLabel.innerText = 'Uploading...';

        const res = await fetch('/upload', { method: 'POST', body: fd });
        if (!res.ok) {
          throw new Error('Upload failed: ' + res.status);
        }
        const data = await res.json();
        // data: { url, filename, originalName, size, mime }
        // emit to socket so server will broadcast a file message to the room
        socket.emit('file', {
          url: data.url,
          originalName: data.originalName || data.filename || file.name,
          size: data.size || file.size,
          mime: data.mime || file.type || 'application/octet-stream'
        });

        fileLabel.innerText = prevLabel;
        fileInput.value = '';
      } catch (err) {
        console.error('Upload error', err);
        alert('Upload failed: ' + (err.message || 'unknown'));
        fileLabel.innerText = '??';
        fileInput.value = '';
      }
    });
  }

  // ---- DOM helper to render messages ----
  function addMessageToDOM(msg) {
    // msg shape:
    // text: { type: 'text', name, text, ts }
    // file: { type: 'file', name, file: { url, originalName, size, mime }, ts }

    const el = document.createElement('div');
    el.classList.add('message');

    const isSelf = (msg.name === name);
    if (isSelf) el.classList.add('self');

    // header (name + time)
    const header = document.createElement('div');
    header.style.fontSize = '0.9rem';
    header.style.marginBottom = '4px';
    header.style.color = '#333';
    const time = new Date(msg.ts || Date.now());
    const timeStr = time.toLocaleTimeString();
    header.innerHTML = `<strong>${escapeHtml(msg.name || 'Anon')}</strong> <span style="font-weight:400; color:#666; font-size:0.85rem;">${timeStr}</span>`;
    el.appendChild(header);

    // content
    if (msg.type === 'file' && msg.file && msg.file.url) {
      const fm = msg.file;
      if (String(fm.mime || '').startsWith('image/')) {
        // image inline
        const img = document.createElement('img');
        img.src = fm.url;
        img.alt = fm.originalName || 'image';
        img.loading = 'lazy';
        img.style.maxWidth = '400px';
        img.style.maxHeight = '400px';
        img.style.borderRadius = '8px';
        el.appendChild(img);

        // small link + size below
        const row = document.createElement('div');
        row.style.marginTop = '6px';
        row.innerHTML = `<a href="${fm.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(fm.originalName || fm.url)}</a> • ${humanSize(fm.size)}`;
        el.appendChild(row);
      } else {
        // generic file link
        const a = document.createElement('a');
        a.href = fm.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = fm.originalName || fm.url;
        el.appendChild(a);

        const meta = document.createElement('div');
        meta.style.marginTop = '6px';
        meta.style.color = '#666';
        meta.style.fontSize = '0.9rem';
        meta.textContent = `${fm.mime || ''} • ${humanSize(fm.size)}`;
        el.appendChild(meta);
      }
    } else {
      // text message
      const p = document.createElement('div');
      p.style.whiteSpace = 'pre-wrap';
      p.textContent = msg.text || '';
      el.appendChild(p);
    }

    chatbox.appendChild(el);
    // scroll to bottom
    chatbox.scrollTop = chatbox.scrollHeight;
  }

  // Basic XSS-safe text escaping for names and plain text (we use textContent where possible)
  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
})();
