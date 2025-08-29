/*
  public/script.js - Full client logic
  - Reads name & room from querystring OR localStorage
  - Connects to Socket.IO and emits joinRoom({room, name})
  - Handles chatHistory and incoming 'chat'
  - Uploads files to /upload (XHR for progress), then emits 'file'
  - Renders text & file messages, images inline
  - Typing indicator, presence list, reconnection handling
  - Drag & drop file support and keyboard shortcuts
*/

(function () {
  // ---- Utilities ----
  function qs(id) { return document.getElementById(id); }
  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function humanSize(bytes) {
    if (bytes == null) return '0 B';
    const units = ['B','KB','MB','GB','TB'];
    let i=0, n = Number(bytes);
    while (n >= 1024 && i < units.length-1) { n /= 1024; i++; }
    return `${n.toFixed(1)} ${units[i]}`;
  }
  function escapeText(s) {
    if (s == null) return '';
    return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  // ---- Read name & room ----
  const urlParams = new URLSearchParams(window.location.search);
  let name = urlParams.get('name') || '';
  let room = urlParams.get('room') || '';

  // fallback to localStorage saved by index.html
  try {
    if (!name) name = localStorage.getItem('anonychat_name') || '';
    if (!room) room = localStorage.getItem('anonychat_room') || '';
  } catch (e) { /* ignore */ }

  if (!name || !room) {
    alert('Missing name or room. Redirecting to join screen.');
    window.location.href = '/';
  }

  // ---- Elements ----
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

  roomNameEl.textContent = `Room: ${room}`;
  roomMetaEl.textContent = `You: ${name}`;

  // ---- Socket.IO connection ----
  const socket = io({
    reconnectionAttempts: 10,
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log('[socket] connected', socket.id);
    socket.emit('joinRoom', { room, name });
  });

  socket.on('disconnect', (reason) => {
    console.warn('[socket] disconnected', reason);
  });

  socket.on('reconnect_attempt', (n) => {
    console.log('[socket] reconnect attempt', n);
  });

  // ---- Server event handlers ----
  socket.on('joinError', (obj) => {
    alert('Join failed: ' + (obj && obj.error ? obj.error : 'Unknown'));
    window.location.href = '/';
  });

  socket.on('full', (obj) => {
    alert('Room is full. Please use another room.');
    window.location.href = '/';
  });

  socket.on('chatHistory', (messages) => {
    chatbox.innerHTML = '';
    if (!Array.isArray(messages)) return;
    messages.forEach(renderMessage);
    chatbox.scrollTop = chatbox.scrollHeight;
  });

  socket.on('chat', (msg) => {
    renderMessage(msg);
    chatbox.scrollTop = chatbox.scrollHeight;
  });

  socket.on('presence', (list) => {
    updatePresenceList(list);
  });

  socket.on('typing', (payload) => {
    showTypingIndicator(payload);
  });

  socket.on('errorMessage', (txt) => {
    console.warn('[server]', txt);
  });

  // ---- Render message ----
  function renderMessage(msg) {
    try {
      if (!msg) return;
      if (msg.type === 'text' && msg.name === 'System') {
        const sys = el('div', 'message system');
        sys.textContent = msg.text;
        chatbox.appendChild(sys);
        return;
      }

      const wrap = el('article', 'message');
      if (msg && msg.name === name) wrap.classList.add('self');

      const header = el('div', 'msg-header');
      const who = el('strong'); who.textContent = msg.name || 'Anon';
      const time = el('span', 'msg-time'); time.textContent = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
      header.appendChild(who);
      header.appendChild(time);
      wrap.appendChild(header);

      const body = el('div', 'msg-body');

      if (msg.type === 'file' && msg.file) {
        const f = msg.file;
        if (String(f.mime || '').startsWith('image/')) {
          const img = el('img', 'msg-image');
          img.src = f.url;
          img.alt = f.originalName || 'image';
          img.loading = 'lazy';
          img.addEventListener('click', () => openLightbox(f.url));
          body.appendChild(img);

          const meta = el('div', 'msg-filemeta');
          const a = el('a'); a.href = f.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.textContent = f.originalName || f.url;
          meta.appendChild(a);
          const size = el('span', 'meta-size'); size.textContent = ` • ${humanSize(f.size)}`;
          meta.appendChild(size);
          body.appendChild(meta);
        } else {
          const a = el('a', 'msg-filelink'); a.href = f.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.textContent = f.originalName || f.url;
          body.appendChild(a);
          const meta = el('div','msg-filemeta'); meta.textContent = `${f.mime || ''} • ${humanSize(f.size)}`; body.appendChild(meta);
        }
      } else {
        const p = el('p'); p.textContent = msg.text || '';
        body.appendChild(p);
      }

      wrap.appendChild(body);
      chatbox.appendChild(wrap);
    } catch (err) {
      console.error('renderMessage error', err);
    }
  }

  // Lightbox
  function openLightbox(src) {
    const overlay = el('div','lightbox-overlay');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', () => overlay.remove());
    overlay.innerHTML = `<div class="lightbox-card"><img src="${escapeText(src)}" alt="image"/></div>`;
    document.body.appendChild(overlay);
    overlay.focus();
  }

  // ---- Presence ----
  function updatePresenceList(list) {
    presenceList.innerHTML = '';
    if (!Array.isArray(list)) return;
    list.forEach(p => {
      const item = el('div', 'presence-item');
      item.textContent = p.name || 'Anon';
      presenceList.appendChild(item);
    });
  }

  // ---- Typing indicator ----
  let typingTimeout = null;
  function showTypingIndicator(payload) {
    if (!payload || !payload.id) return;
    const id = `typing-${payload.id}`;
    if (qs(id)) {
      if (typingTimeout) clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => { const e = qs(id); if (e) e.remove(); }, 2500);
      return;
    }
    const elTyping = el('div', 'typing-indicator');
    elTyping.id = id;
    elTyping.textContent = `${payload.name || 'Someone'} is typing…`;
    chatbox.appendChild(elTyping);
    chatbox.scrollTop = chatbox.scrollHeight;
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => { const e = qs(id); if (e) e.remove(); }, 2500);
  }

  // ---- Sending text ----
  chatForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    msgInput.value = '';
  });

  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.requestSubmit();
    } else {
      socket.emit('typing');
    }
  });

  // ---- File upload (XHR) ----
  let currentUploadXhr = null;
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const maxMB = 20;
    if (file.size > maxMB * 1024 * 1024) {
      alert(`File too large (max ${maxMB} MB)`);
      fileInput.value = '';
      return;
    }
    startFileUpload(file);
  });

  // Drag & drop
  ['dragenter','dragover'].forEach(evt => {
    document.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      const f = e.dataTransfer.files[0];
      startFileUpload(f);
    }
  }, false);

  function startFileUpload(file) {
    uploadOverlay.hidden = false;
    uploadOverlay.setAttribute('aria-hidden','false');
    uploadStatus.textContent = `Uploading ${file.name}`;
    uploadProgress.value = 0;

    const fd = new FormData();
    fd.append('file', file);

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
      uploadOverlay.setAttribute('aria-hidden','true');
      if (xhr.status >= 200 && xhr.status < 300) {
        let resp;
        try { resp = JSON.parse(xhr.responseText); } catch (err) { resp = null; }
        if (resp && resp.url) {
          socket.emit('file', {
            url: resp.url,
            originalName: resp.originalName || resp.filename || file.name,
            size: resp.size || file.size,
            mime: resp.mime || file.type || 'application/octet-stream'
          });
        } else {
          alert('Upload succeeded but server returned invalid response.');
        }
      } else {
        alert('Upload failed: ' + (xhr.responseText || ('HTTP ' + xhr.status)));
      }
      fileInput.value = '';
    };

    xhr.onerror = () => {
      currentUploadXhr = null;
      uploadOverlay.hidden = true;
      uploadOverlay.setAttribute('aria-hidden','true');
      alert('Upload failed due to a network error.');
      fileInput.value = '';
    };

    xhr.onabort = () => {
      currentUploadXhr = null;
      uploadOverlay.hidden = true;
      uploadOverlay.setAttribute('aria-hidden','true');
      alert('Upload canceled.');
      fileInput.value = '';
    };

    xhr.setRequestHeader('Accept', 'application/json');
    xhr.send(fd);

    cancelUploadBtn.onclick = () => { if (xhr && xhr.readyState !== 4) xhr.abort(); };
  }

  // ---- Leave button ----
  leaveBtn.addEventListener('click', () => {
    try { socket.emit('leave', { room, name }); } catch (e) {}
    try { localStorage.removeItem('anonychat_name'); localStorage.removeItem('anonychat_room'); } catch (e) {}
    socket.disconnect();
    window.location.href = '/';
  });

  // Focus input on load
  msgInput.focus();

  // Keyboard shortcut: Ctrl/Cmd+K to focus input
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      msgInput.focus();
    }
  });

})();
