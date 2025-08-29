/* public/script.js
   Client logic for chat.html:
   - Reads ?name=...&room=... from the URL
   - Connects to socket.io then emits joinRoom({room,name})
   - Handles chat history and incoming messages ('chat')
   - Posts uploads to /upload then emits 'file' with returned metadata
   - Renders text, images, and file links
*/

(function () {
  // Utilities
  function qs(id) { return document.getElementById(id); }
  function elt(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function humanSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0, n = Number(bytes);
    while (n >= 1024 && i < units.length-1) { n /= 1024; i++; }
    return `${n.toFixed(1)} ${units[i]}`;
  }
  function escapeText(s) {
    if (s == null) return '';
    return String(s)
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  // Parse query params
  const params = new URLSearchParams(window.location.search);
  const name = params.get('name') || params.get('username') || '';
  const room = params.get('room') || params.get('r') || '';

  // Elements
  const roomNameEl = qs('roomName');
  const roomMetaEl = qs('roomMeta');
  const chatbox = qs('chatbox');
  const chatForm = qs('chatForm');
  const msgInput = qs('msg');
  const fileInput = qs('fileInput');
  const leaveBtn = qs('leaveBtn');

  // Guard: redirect to join if missing
  if (!name || !room) {
    alert('Missing room or name. Redirecting to join screen.');
    window.location.href = '/';
    throw new Error('Missing room or name');
  }

  // Show room in UI
  roomNameEl.textContent = `Room: ${escapeText(room)}`;
  roomMetaEl.textContent = `You are: ${escapeText(name)}`;

  // Connect socket (connect first, then joinRoom)
  const socket = io();

  // Join after connect
  socket.on('connect', () => {
    socket.emit('joinRoom', { room, name });
  });

  // Chat history (array of messages)
  socket.on('chatHistory', (messages) => {
    chatbox.innerHTML = '';
    if (Array.isArray(messages)) {
      messages.forEach(renderMessage);
      chatbox.scrollTop = chatbox.scrollHeight;
    }
  });

  // Incoming chat events
  socket.on('chat', (msg) => {
    renderMessage(msg);
    chatbox.scrollTop = chatbox.scrollHeight;
  });

  // Optional small helpers
  socket.on('full', () => {
    alert('Room is full.');
    window.location.href = '/';
  });
  socket.on('joinError', (obj) => {
    alert('Join error: ' + (obj && obj.error ? obj.error : 'Unknown'));
    window.location.href = '/';
  });
  socket.on('errorMessage', (txt) => {
    console.warn('Server:', txt);
  });

  // Leave button
  leaveBtn.addEventListener('click', () => {
    // quick disconnect and go home
    socket.disconnect();
    window.location.href = '/';
  });

  // Render message helper
  function renderMessage(msg) {
    // message shapes:
    // text: { id, type:'text', name, text, ts }
    // file: { id, type:'file', name, file:{url, originalName, size, mime}, ts }
    // System messages may be type:'text' with name 'System'

    const wrap = elt('article', 'message');
    // mark self
    if (msg && msg.name === name) wrap.classList.add('self');

    // header
    const header = elt('div', 'msg-header');
    const who = elt('strong'); who.textContent = msg.name || 'Anon';
    const time = elt('span', 'msg-time');
    time.textContent = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
    header.appendChild(who);
    header.appendChild(time);
    wrap.appendChild(header);

    // content
    const body = elt('div', 'msg-body');

    if (msg.type === 'file' && msg.file) {
      const f = msg.file;
      // images inline
      if (String(f.mime || '').startsWith('image/')) {
        const img = elt('img', 'msg-image');
        img.src = f.url;
        img.alt = f.originalName || 'image';
        img.loading = 'lazy';
        body.appendChild(img);

        const down = elt('div', 'msg-filemeta');
        const a = elt('a'); a.href = f.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = f.originalName || f.url;
        down.appendChild(a);
        const metaSpan = elt('span', 'meta-span');
        metaSpan.textContent = ` • ${humanSize(f.size)}`;
        down.appendChild(metaSpan);
        body.appendChild(down);
      } else {
        // other file types: display link + metadata
        const a = elt('a', 'msg-filelink');
        a.href = f.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = f.originalName || f.url;
        body.appendChild(a);

        const meta = elt('div', 'msg-filemeta');
        meta.textContent = `${f.mime || ''} • ${humanSize(f.size)}`;
        body.appendChild(meta);
      }
    } else {
      // text message
      const p = elt('p');
      p.textContent = msg.text || '';
      body.appendChild(p);
    }

    wrap.appendChild(body);
    chatbox.appendChild(wrap);
  }

  // Submit message via form
  chatForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    msgInput.value = '';
  });

  // Enter key behaviour already handled by form submit; keep shift+enter for newline
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    }
  });

  // File upload flow:
  // - User picks file -> client POST /upload (FormData)
  // - Server responds with {url, filename, originalName, size, mime}
  // - Client emits 'file' with that metadata (server will broadcast)
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // quick client side check
    const maxBytes = (10 * 1024 * 1024); // same as server MAX_FILE_MB default
    if (file.size > maxBytes) {
      alert(`File too large. Max allowed is ${humanSize(maxBytes)}.`);
      fileInput.value = '';
      return;
    }

    // Build FormData
    const fd = new FormData();
    fd.append('file', file);

    // UI feedback (disable composer while uploading)
    const sendBtn = document.querySelector('.composer-send');
    const oldSendText = sendBtn ? sendBtn.textContent : null;
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = 'Uploading...';
    }

    try {
      const resp = await fetch('/upload', { method: 'POST', body: fd });
      if (!resp.ok) {
        throw new Error(`Upload failed: ${resp.status}`);
      }
      const data = await resp.json();
      // Expected shape: { url, filename, originalName, size, mime }
      socket.emit('file', {
        url: data.url,
        originalName: data.originalName || data.filename || file.name,
        size: data.size || file.size,
        mime: data.mime || file.type || 'application/octet-stream'
      });
    } catch (err) {
      console.error('Upload error', err);
      alert('Upload failed: ' + (err.message || 'unknown error'));
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.textContent = oldSendText;
      }
      fileInput.value = ''; // reset input
    }
  });

  // Accessibility: focus message input after join
  msgInput.focus();

})();
