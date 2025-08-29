/*
  public/script.js - full client
  - Reads name & room from querystring OR localStorage
  - Connects to Socket.IO and emits joinRoom({room, name})
  - Receives chatHistory and chat messages
  - Posts files to /upload (FormData) with XHR to support progress and cancel
  - Emits 'file' with returned metadata
  - Renders messages (text, images inline, other files as links)
  - Typing indicator (local), presence list
  - Handles reconnection/backoff and error UI
*/

(function () {
  // ---------------- Utils ----------------
  function qs(id) { return document.getElementById(id); }
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function nowTs() { return Date.now(); }
  function humanSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let i=0; let n = Number(bytes);
    while (n >= 1024 && i < units.length-1) { n /= 1024; i++; }
    return `${n.toFixed(1)} ${units[i]}`;
  }
  function escapeText(s) {
    if (s == null) return '';
    return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  // ---------------- Read user & room ----------------
  const urlParams = new URLSearchParams(window.location.search);
  let name = urlParams.get('name') || '';
  let room = urlParams.get('room') || '';

  // fallback to localStorage (index.html saved them)
  if (!name) {
    try { name = localStorage.getItem('anonychat_name') || ''; } catch(e) { name = ''; }
  }
  if (!room) {
    try { room = localStorage.getItem('anonychat_room') || ''; } catch(e) { room = ''; }
  }

  // If either missing — redirect to join screen
  if (!name || !room) {
    alert('Missing room or name. Redirecting to join screen.');
    window.location.href = '/';
    return;
  }

  // ---------------- Elements ----------------
  const roomNameEl = qs('roomName');
  const roomMetaEl = qs('roomMeta');
  const chatbox = qs('chatbox');
  const chatForm = qs('chatForm');
  const msgInput = qs('msg');
  const fileInput = qs('fileInput');
  const leaveBtn = qs('leaveBtn');
  const presenceList = qs('presenceList');
  const uploadOverlay = qs('uploadOverlay');
  const uploadProgress = qs('uploadProgress');
  const uploadStatus = qs('uploadStatus');
  const cancelUploadBtn = qs('cancelUploadBtn');

  // UI initial text
  roomNameEl.textContent = `Room: ${room}`;
  roomMetaEl.textContent = `You: ${name}`;

  // ---------------- Socket connection ----------------
  // Use default io() — assumes socket.io served at /socket.io
  const socket = io({
    reconnectionAttempts: 10,
    transports: ['websocket', 'polling']
  });

  // Track presence (socket server will not maintain names for us; we keep a map)
  const presence = new Map(); // socketId -> name

  // Upload XHR controller state
  let currentUploadXhr = null;

  // ---------------- Socket handlers ----------------
  socket.on('connect', () => {
    console.log('[socket] connected', socket.id);
    socket.emit('joinRoom', { room, name });
    // announce that we are present (server will manage presence list)
  });

  socket.on('disconnect', (reason) => {
    console.warn('[socket] disconnected', reason);
  });

  socket.on('reconnect_attempt', (n) => {
    console.log('[socket] reconnect attempt', n);
  });

  socket.on('joinError', (obj) => {
    const message = obj && obj.error ? obj.error : 'Failed to join room';
    alert('Join failed: ' + message);
    window.location.href = '/';
  });

  socket.on('full', (obj) => {
    alert('Room is full. Please use another room.');
    window.location.href = '/';
  });

  // chatHistory - initial messages for this room
  socket.on('chatHistory', (messages) => {
    try {
      chatbox.innerHTML = '';
      if (!Array.isArray(messages)) return;
      messages.forEach((m) => renderMessage(m, { append: true }));
      chatbox.scrollTop = chatbox.scrollHeight;
    } catch (err) {
      console.error('chatHistory render error', err);
    }
  });

  // chat - new message broadcasted by server
  socket.on('chat', (msg) => {
    renderMessage(msg, { append: true });
    chatbox.scrollTop = chatbox.scrollHeight;
  });

  // typing indicator
  socket.on('typing', (payload) => {
    // payload: { id, name, ts }
    showTypingIndicator(payload);
  });

  // server /presence update (optional, if server emits)
  socket.on('presence', (list) => {
    // list: array of { id, name }
    updatePresenceList(list);
  });

  // Generic server messages
  socket.on('errorMessage', (txt) => {
    console.warn('[server]', txt);
  });

  // ---------------- Rendering helpers ----------------
  function renderMessage(msg, opts = {}) {
    // msg types:
    // { id, type:'text', name, text, ts }
    // { id, type:'file', name, file:{url, originalName, size, mime}, ts }
    // { id, type:'typing' } - handled separately
    try {
      const wrap = el('article', 'message');
      if (msg && msg.name === name) wrap.classList.add('self');

      // header
      const header = el('div', 'msg-header');
      const who = el('strong'); who.textContent = msg.name || 'Anon';
      const time = el('span', 'msg-time'); time.textContent = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
      header.appendChild(who);
      header.appendChild(time);
      wrap.appendChild(header);

      // body
      const body = el('div', 'msg-body');

      if (msg.type === 'file' && msg.file) {
        const f = msg.file;
        // if image mime inline show preview
        if (String(f.mime || '').startsWith('image/')) {
          const img = el('img', 'msg-image');
          img.src = f.url;
          img.alt = f.originalName || 'image';
          img.loading = 'lazy';
          // click to open full
          img.addEventListener('click', () => window.open(f.url, '_blank', 'noopener'));
          body.appendChild(img);

          const metaRow = el('div', 'msg-filemeta');
          const link = el('a'); link.href = f.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
          link.textContent = f.originalName || f.url;
          metaRow.appendChild(link);
          const size = el('span', 'meta-size'); size.textContent = ` • ${humanSize(f.size)}`;
          metaRow.appendChild(size);
          body.appendChild(metaRow);
        } else {
          const link = el('a', 'msg-filelink');
          link.href = f.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = f.originalName || f.url;
          body.appendChild(link);

          const meta = el('div', 'msg-filemeta');
          meta.textContent = `${f.mime || ''} • ${humanSize(f.size)}`;
          body.appendChild(meta);
        }
      } else {
        // text
        const p = el('p');
        p.textContent = msg.text || '';
        body.appendChild(p);
      }

      wrap.appendChild(body);

      if (opts.append) {
        chatbox.appendChild(wrap);
      } else {
        // return node
        return wrap;
      }
    } catch (err) {
      console.error('renderMessage error', err);
    }
  }

  // typing indicator: show a temporary indicator on the chatbox
  let typingTimeout = null;
  function showTypingIndicator(payload) {
    // payload: { id, name, ts }
    // We render a small ephemeral line like "Alice is typing..."
    const id = payload && payload.id ? `typing-${payload.id}` : null;
    if (!id) return;
    // ensure not duplicate
    if (qs(id)) {
      // refresh timer
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => {
        const elx = qs(id); if (elx) elx.remove();
      }, 2500);
      return;
    }
    const line = el('div');
    line.id = id;
    line.className = 'typing-indicator';
    line.textContent = `${payload.name || 'Someone'} is typing…`;
    chatbox.appendChild(line);
    chatbox.scrollTop = chatbox.scrollHeight;
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { const elx = qs(id); if (elx) elx.remove(); }, 2500);
  }

  // presence list update helper
  function updatePresenceList(list) {
    presenceList.innerHTML = '';
    if (!Array.isArray(list)) return;
    list.forEach(p => {
      const item = el('div', 'presence-item');
      item.textContent = p.name || 'Anon';
      presenceList.appendChild(item);
    });
  }

  // ---------------- Chat form send ----------------
  chatForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    msgInput.value = '';
  });

  // Enter to send (Shift+Enter for newline)
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    } else {
      // emit typing to server (debounced)
      socket.emit('typing');
    }
  });

  // ---------------- File upload flow ----------------
  // We'll use XHR to provide progress & cancellation.
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    // Basic safety: size limit
    const maxBytes = (MAX_FILE_MB || 10) * 1024 * 1024;
    if (file.size > maxBytes) {
      alert(`File too large (max ${humanSize(maxBytes)}).`);
      fileInput.value = '';
      return;
    }
    // Launch upload
    startFileUpload(file);
  });

  function startFileUpload(file) {
    // Show upload overlay
    uploadOverlay.hidden = false;
    uploadOverlay.setAttribute('aria-hidden', 'false');
    uploadStatus.textContent = `Uploading ${file.name}`;
    uploadProgress.value = 0;

    // Build form data
    const fd = new FormData();
    fd.append('file', file);

    // XHR
    const xhr = new XMLHttpRequest();
    currentUploadXhr = xhr;

    xhr.open('POST', '/upload', true);

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        uploadProgress.value = pct;
      }
    };

    xhr.onload = () => {
      currentUploadXhr = null;
      uploadOverlay.hidden = true;
      uploadOverlay.setAttribute('aria-hidden', 'true');
      if (xhr.status >= 200 && xhr.status < 300) {
        let resp;
        try { resp = JSON.parse(xhr.responseText); } catch (err) { resp = null; }
        if (resp && resp.url) {
          // Emit 'file' event with metadata server expects
          socket.emit('file', {
            url: resp.url,
            originalName: resp.originalName || resp.filename,
            size: resp.size || file.size,
            mime: resp.mime || file.type || 'application/octet-stream'
          });
        } else {
          alert('Upload succeeded but server returned invalid response.');
        }
      } else {
        const text = xhr.responseText || `HTTP ${xhr.status}`;
        alert('Upload failed: ' + text);
      }
      fileInput.value = '';
    };

    xhr.onerror = () => {
      currentUploadXhr = null;
      uploadOverlay.hidden = true;
      uploadOverlay.setAttribute('aria-hidden', 'true');
      alert('Upload failed due to a network error.');
      fileInput.value = '';
    };

    xhr.onabort = () => {
      currentUploadXhr = null;
      uploadOverlay.hidden = true;
      uploadOverlay.setAttribute('aria-hidden', 'true');
      alert('Upload canceled.');
      fileInput.value = '';
    };

    xhr.setRequestHeader('Accept', 'application/json');
    xhr.send(fd);

    // Cancel button wiring
    cancelUploadBtn.onclick = () => {
      if (xhr && xhr.readyState !== 4) {
        xhr.abort();
      }
    };
  }

  // ---------------- Presence / Leave ----------------
  leaveBtn.addEventListener('click', () => {
    // inform server optional (server will handle disconnect)
    try { socket.emit('leave', { room, name }); } catch (e) { /* ignore */ }
    // clear client storage
    try { localStorage.removeItem('anonychat_name'); localStorage.removeItem('anonychat_room'); } catch(e){}
    socket.disconnect();
    window.location.href = '/';
  });

  // Focus input
  msgInput.focus();

  // ---------------- Reconnect handling UI (optional) ----------------
  // Show a small console log. If you want UI, you can add DOM indicators.
  socket.on('reconnect', (attempt) => {
    console.log('[socket] reconnected after', attempt, 'attempts');
  });

})();
