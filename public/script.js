/* public/script.js
   - Reads query params (name, room) and optional create params (create=1, roomCode, roomName, max)
   - Connects to socket.io (relative path so works on Render)
   - If create=1 present: emits createRoom with payload and auto-joins
   - Otherwise emits joinRoom
   - Handles chatHistory, chat (server emits 'chat'), presence, typing
   - Sends 'chat' events for text and 'file' after uploading to /upload
*/

(function () {
  // helpers
  function qs(id) { return document.getElementById(id); }
  function el(tag, cls) { const e=document.createElement(tag); if(cls) e.className = cls; return e; }
  function escapeHtml(s){ return String(s||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
  function humanSize(bytes){ if(!bytes && bytes!==0) return '0 B'; const u=['B','KB','MB','GB']; let i=0,n=Number(bytes); while(n>=1024&&i<u.length-1){n/=1024;i++} return n.toFixed(1)+' '+u[i]; }

  // parse query string
  const params = new URLSearchParams(location.search);
  const name = params.get('name') || '';
  const room = params.get('room') || params.get('roomCode') || '';
  const createFlag = params.get('create') === '1';
  const createRoomName = params.get('roomName') || '';
  const createMax = params.get('max') || '';

  // elements
  const roomTitle = qs('roomTitle');
  const meta = qs('meta');
  const chatbox = qs('chatbox');
  const presenceList = qs('presenceList');
  const composerForm = qs('composerForm');
  const msgInput = qs('msg');
  const fileInput = qs('fileInput');
  const leaveBtn = qs('leaveBtn');
  const uploadOverlay = qs('uploadOverlay');
  const uploadProgress = qs('uploadProgress');
  const uploadStatus = qs('uploadStatus');
  const cancelUploadBtn = qs('cancelUploadBtn');

  // sanity checks
  if (!name || !room) {
    alert('Missing name or room. Redirecting to join screen.');
    location.href = '/';
    throw new Error('Missing name or room in query params');
  }

  roomTitle.textContent = `Room: ${room}`;
  meta.textContent = `You: ${name}`;

  // Socket.IO — relative path so works on Render
  const socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10
  });

  // state
  let currentUploadXhr = null;
  let typingTimeout = null;

  socket.on('connect', () => {
    console.log('[socket] connected', socket.id);
    if (createFlag) {
      // emit createRoom first (server will auto-join)
      socket.emit('createRoom', {
        roomName: createRoomName || room,
        roomCode: room,
        maxUsers: Number(createMax) || 10,
        name: name
      });
    } else {
      socket.emit('joinRoom', { room, name });
    }
  });

  // server feedback
  socket.on('createError', (obj) => { alert('Create error: ' + (obj && obj.error ? obj.error : 'Unknown')); location.href = '/'; });
  socket.on('joinError', (obj) => { alert('Join error: ' + (obj && obj.error ? obj.error : 'Unknown')); location.href = '/'; });
  socket.on('full', (obj) => { alert('Room full: ' + (obj && obj.error ? obj.error : 'Room is full')); location.href = '/'; });

  // chatHistory — replace content
  socket.on('chatHistory', (messages) => {
    chatbox.innerHTML = '';
    if (!Array.isArray(messages)) return;
    messages.forEach(renderMessage);
    chatbox.scrollTop = chatbox.scrollHeight;
  });

  // new chat message (server uses 'chat' for both system & user messages)
  socket.on('chat', (msg) => {
    renderMessage(msg);
    chatbox.scrollTop = chatbox.scrollHeight;
  });

  // presence updates
  socket.on('presence', (list) => {
    presenceList.innerHTML = '';
    if (!Array.isArray(list)) return;
    list.forEach(p => {
      const item = el('div', 'presence-item');
      item.textContent = p.name || 'Anon';
      presenceList.appendChild(item);
    });
  });

  // typing indicator
  socket.on('typing', (payload) => {
    if (!payload || !payload.id) return;
    const id = `typing-${payload.id}`;
    if (qs(id)) {
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(()=>{ const t=qs(id); if(t) t.remove(); }, 2200);
      return;
    }
    const typ = el('div', 'typing');
    typ.id = id;
    typ.textContent = `${payload.name || 'Someone'} is typing…`;
    chatbox.appendChild(typ);
    chatbox.scrollTop = chatbox.scrollHeight;
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(()=>{ const t=qs(id); if(t) t.remove(); }, 2200);
  });

  // renderMessage supports text, system, and file messages
  function renderMessage(msg) {
    if (!msg) return;
    if (msg.type === 'text' && msg.name === 'System') {
      const sys = el('div', 'msg system');
      sys.textContent = msg.text;
      chatbox.appendChild(sys);
      return;
    }

    const wrapper = el('article', 'msg');
    if (msg.name === name) wrapper.classList.add('self');

    const header = el('div', 'msg-header');
    const who = el('strong'); who.textContent = msg.name || 'Anon';
    const time = el('span', 'msg-time'); time.textContent = msg.ts ? new Date(msg.ts).toLocaleTimeString() : '';
    header.appendChild(who);
    header.appendChild(time);
    wrapper.appendChild(header);

    const body = el('div', 'msg-body');
    if (msg.type === 'file' && msg.file) {
      const f = msg.file;
      if ((f.mime || '').startsWith('image/')) {
        const img = el('img', 'msg-image');
        img.src = f.url;
        img.alt = f.originalName || 'image';
        img.loading = 'lazy';
        img.addEventListener('click', () => openLightbox(f.url));
        body.appendChild(img);

        const meta = el('div','msg-filemeta');
        const a = el('a'); a.href = f.url; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent = f.originalName || f.url;
        meta.appendChild(a);
        const size = el('span','meta-size'); size.textContent = ` • ${humanSize(f.size)}`;
        meta.appendChild(size);
        body.appendChild(meta);
      } else {
        const a = el('a','msg-filelink'); a.href = f.url; a.target='_blank'; a.rel='noopener noreferrer';
        a.textContent = f.originalName || f.url;
        body.appendChild(a);
        const meta = el('div','msg-filemeta'); meta.textContent = `${f.mime || ''} • ${humanSize(f.size)}`; body.appendChild(meta);
      }
    } else {
      const p = el('p'); p.textContent = msg.text || '';
      body.appendChild(p);
    }

    wrapper.appendChild(body);
    chatbox.appendChild(wrapper);
  }

  // lightbox for images
  function openLightbox(src) {
    const overlay = el('div','lightbox');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', () => overlay.remove());
    overlay.innerHTML = `<img src="${escapeHtml(src)}" alt="image" />`;
    document.body.appendChild(overlay);
    overlay.focus();
  }

  // send text
  composerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit('chat', text);
    msgInput.value = '';
  });

  // typing indicator
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // handled by submit
      return;
    }
    socket.emit('typing');
  });

  // file upload (XHR with progress) then emit 'file' to the room
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const maxMB = 25;
    if (file.size > maxMB * 1024 * 1024) {
      alert(`File too large. Max ${maxMB} MB.`);
      fileInput.value = '';
      return;
    }
    uploadFile(file);
  });

  // drag & drop support for quick upload
  ['dragenter','dragover'].forEach(evt => {
    document.addEventListener(evt, (ev) => { ev.preventDefault(); ev.stopPropagation(); }, false);
  });
  document.addEventListener('drop', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
      uploadFile(ev.dataTransfer.files[0]);
    }
  }, false);

  function uploadFile(file) {
    uploadOverlay.classList.remove('hidden');
    uploadStatus.textContent = `Uploading ${file.name}…`;
    uploadProgress.value = 0;

    const fd = new FormData();
    fd.append('file', file);

    const xhr = new XMLHttpRequest();
    currentUploadXhr = xhr;
    xhr.open('POST', '/upload', true);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        uploadProgress.value = Math.round((ev.loaded/ev.total)*100);
      }
    };
    xhr.onload = () => {
      currentUploadXhr = null;
      uploadOverlay.classList.add('hidden');
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          const resp = JSON.parse(xhr.responseText);
          if (resp && resp.url) {
            socket.emit('file', {
              url: resp.url,
              originalName: resp.originalName || resp.filename || file.name,
              size: resp.size || file.size,
              mime: resp.mime || file.type || 'application/octet-stream'
            });
          } else {
            alert('Upload succeeded but server returned unexpected response.');
          }
        } else {
          alert('Upload failed: ' + (xhr.responseText || ('HTTP ' + xhr.status)));
        }
      } catch (err) {
        alert('Upload parse error.');
      }
      fileInput.value = '';
    };
    xhr.onerror = () => {
      currentUploadXhr = null;
      uploadOverlay.classList.add('hidden');
      alert('Upload failed due to network error.');
      fileInput.value = '';
    };
    xhr.onabort = () => {
      currentUploadXhr = null;
      uploadOverlay.classList.add('hidden');
      alert('Upload canceled.');
      fileInput.value = '';
    };
    xhr.setRequestHeader('Accept','application/json');
    xhr.send(fd);

    cancelUploadBtn.onclick = () => { if (xhr && xhr.readyState !== 4) xhr.abort(); };
  }

  // leave room
  leaveBtn.addEventListener('click', () => {
    try { socket.emit('leave'); } catch (e) {}
    socket.disconnect();
    location.href = '/';
  });

  // focus input
  msgInput.focus();

  // keyboard shortcut: Ctrl/Cmd+K focus chat input
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault(); msgInput.focus();
    }
  });

})();
