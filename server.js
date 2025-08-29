/**
 * server.js
 * Full-featured AnonyChat server (CommonJS)
 *
 * Features:
 *  - Express static hosting for public/
 *  - /upload endpoint using Multer (uploads to ./uploads)
 *  - Socket.IO room management (joinRoom, chat, file, typing)
 *  - In-memory room store with optional per-room JSON persistence
 *  - Message history sent on join
 *  - Auto-delete room when last user leaves
 *  - Per-socket token-bucket rate limiting
 *  - Safe serving of uploads (nosniff, caching)
 *  - Periodic stats output
 *  - Admin endpoints: /health, /rooms, /room/:room
 *  - File cleanup worker (old uploads)
 *  - Graceful shutdown
 *
 * Configuration via environment variables (see constants below)
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const morgan = require('morgan');
const helmet = require('helmet');

/* ============================
   CONFIGURATION (tweak here)
   ============================ */
const PORT = Number(process.env.PORT || 3000);
const APP_ROOT = __dirname;
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const UPLOAD_DIR = path.join(APP_ROOT, 'uploads');
const ROOM_PERSIST_DIR = path.join(APP_ROOT, 'room_data'); // optional persistence files
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 20); // max upload size (MB)
const MAX_MESSAGES_PER_ROOM = Number(process.env.MAX_MESSAGES_PER_ROOM || 5000);
const MESSAGE_PRUNE_TO = Number(process.env.MESSAGE_PRUNE_TO || 3000);
const MAX_USERS_PER_ROOM = Number(process.env.MAX_USERS_PER_ROOM || 100);
const FILE_RETENTION_DAYS = Number(process.env.FILE_RETENTION_DAYS || 30);
const ENABLE_FILE_CLEANUP = process.env.ENABLE_FILE_CLEANUP !== 'false';
const PERSIST_ROOMS_TO_DISK = process.env.PERSIST_ROOMS_TO_DISK === 'true';
const STATS_INTERVAL_SECONDS = Number(process.env.STATS_INTERVAL_SECONDS || 60);

// Token bucket settings (rate-limiting)
const RATE_LIMIT_TOKENS = Number(process.env.RATE_LIMIT_TOKENS || 8); // tokens capacity
const RATE_LIMIT_REFILL_MS = Number(process.env.RATE_LIMIT_REFILL_MS || 1000); // refill interval

// Allowed MIME types whitelist (images allowed by prefix)
const ALLOWED_MIME_WHITELIST = new Set([
  'image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml',
  'application/pdf','text/plain','application/zip',
  'application/x-7z-compressed','application/x-rar-compressed',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

/* =================================
   Ensure directories exist
   ================================= */
fs.ensureDirSync(PUBLIC_DIR);
fs.ensureDirSync(UPLOAD_DIR);
if (PERSIST_ROOMS_TO_DISK) fs.ensureDirSync(ROOM_PERSIST_DIR);

/* ============================
   Multer (upload handling)
   ============================ */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // sanitize original name
    const original = path.basename(file.originalname || 'file');
    const safeBase = original.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const ext = path.extname(original) || (mime.extension(file.mimetype) ? `.${mime.extension(file.mimetype)}` : '');
    const filename = `${Date.now()}-${uuidv4()}-${safeBase}${ext}`;
    cb(null, filename);
  }
});

function fileFilter(req, file, cb) {
  const mimetype = file.mimetype || '';
  if (mimetype.startsWith('image/') || ALLOWED_MIME_WHITELIST.has(mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Disallowed file type: ${mimetype}`));
  }
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter
});

/* ============================
   Express + security + logging
   ============================ */
const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

// Serve uploads safely with Cache-Control and nosniff
app.use('/uploads', express.static(UPLOAD_DIR, {
  index: false,
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).slice(1);
    const t = mime.lookup(ext);
    if (t) res.setHeader('Content-Type', t);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

/* ============================
   Admin endpoints
   ============================ */
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now(), pid: process.pid }));

// Return a summary of rooms (not sensitive)
app.get('/rooms', (_req, res) => {
  const summary = {};
  for (const [k, v] of Object.entries(rooms)) {
    summary[k] = { users: v.users.size, messages: v.messages.length, lastActive: v.lastActive, createdAt: v.createdAt };
  }
  res.json({ count: Object.keys(rooms).length, rooms: summary, ts: Date.now() });
});

app.get('/room/:room', (req, res) => {
  const name = req.params.room;
  if (!rooms[name]) return res.status(404).json({ error: 'Room not found' });
  const r = rooms[name];
  return res.json({
    room: name,
    users: Array.from(r.users.values()),
    messageCount: r.messages.length,
    lastActive: r.lastActive,
    createdAt: r.createdAt
  });
});

/* ============================
   Upload endpoint (POST /upload)
   - Client should POST FormData { file: File }
   - Server returns JSON { url, filename, originalName, size, mime }
   - Client then emits socket 'file' with metadata so server broadcasts to room
   ============================ */
app.post('/upload', (req, res) => {
  const handler = upload.single('file');
  handler(req, res, (err) => {
    if (err) {
      console.error('Upload error', err);
      const code = (err.code === 'LIMIT_FILE_SIZE') ? 413 : 400;
      return res.status(code).json({ error: err.message || 'Upload error' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filename = req.file.filename;
    const publicUrl = `/uploads/${encodeURIComponent(filename)}`;
    return res.json({
      url: publicUrl,
      filename: filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype
    });
  });
});

/* ============================
   Rooms store + helpers
   ============================
   rooms structure:
   {
     roomCode: {
       users: Map(socketId -> name),
       messages: [ { id, type:'text'|'file', name, text?, file?, ts } ],
       lastActive: timestamp,
       createdAt: timestamp
     }
   }
   ============================ */
const rooms = {};

/* Persistence helpers (optional) */
async function persistRoom(room) {
  if (!PERSIST_ROOMS_TO_DISK) return;
  try {
    const r = rooms[room];
    if (!r) {
      await fs.remove(path.join(ROOM_PERSIST_DIR, `${room}.json`)).catch(()=>{});
      return;
    }
    const out = { createdAt: r.createdAt, lastActive: r.lastActive, messages: r.messages.slice(-MAX_MESSAGES_PER_ROOM) };
    await fs.writeJson(path.join(ROOM_PERSIST_DIR, `${room}.json`), out, { spaces: 2 });
  } catch (e) {
    console.error('persistRoom error', e);
  }
}

async function restoreRoomsFromDisk() {
  if (!PERSIST_ROOMS_TO_DISK) return;
  try {
    const files = await fs.readdir(ROOM_PERSIST_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = await fs.readJson(path.join(ROOM_PERSIST_DIR, f));
        const room = f.slice(0, -5);
        rooms[room] = {
          users: new Map(),
          messages: data.messages || [],
          lastActive: data.lastActive || Date.now(),
          createdAt: data.createdAt || Date.now()
        };
        console.log('Restored room from disk:', room);
      } catch (err) {
        console.warn('Failed to read persisted room', f, err.message || err);
      }
    }
  } catch (err) {
    // no persisted rooms - that's fine
  }
}

/* Helper: ensure room exists */
function ensureRoom(room) {
  if (!rooms[room]) {
    rooms[room] = { users: new Map(), messages: [], lastActive: Date.now(), createdAt: Date.now() };
  } else {
    rooms[room].lastActive = Date.now();
  }
  return rooms[room];
}

/* Prune messages to limit memory */
function pruneMessages(roomObj) {
  if (!roomObj || !roomObj.messages) return;
  const overflow = roomObj.messages.length - MAX_MESSAGES_PER_ROOM;
  if (overflow > 0) {
    roomObj.messages.splice(0, overflow - MESSAGE_PRUNE_TO);
  }
}

/* ============================
   File cleanup worker (optional)
   ============================ */
async function cleanupOldUploads() {
  if (!ENABLE_FILE_CLEANUP) return;
  try {
    const entries = await fs.readdir(UPLOAD_DIR);
    const now = Date.now();
    const keepMs = FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of entries) {
      try {
        const full = path.join(UPLOAD_DIR, f);
        const st = await fs.stat(full);
        if (!st.isFile()) continue;
        if ((now - st.mtimeMs) > keepMs) {
          await fs.remove(full);
          console.log('[cleanup] removed old upload', f);
        }
      } catch (e) {
        // ignore individual file errors
      }
    }
  } catch (e) {
    console.warn('cleanupOldUploads error', e);
  }
}

if (ENABLE_FILE_CLEANUP) {
  setInterval(() => cleanupOldUploads().catch(()=>{}), 24*60*60*1000).unref();
}

/* ============================
   Token bucket (rate-limiting)
   ============================ */
class TokenBucket {
  constructor(capacity=RATE_LIMIT_TOKENS, refillMs=RATE_LIMIT_REFILL_MS) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillMs = refillMs;
    this.lastRefill = Date.now();
  }
  consume(n=1) {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillCount = Math.floor(elapsed / this.refillMs);
    if (refillCount > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + refillCount);
      this.lastRefill = now;
    }
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

/* ============================
   HTTP server + Socket.IO
   ============================ */
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Map socketId -> tokenBucket + metadata
const socketMeta = new Map();

/* Restore any persisted rooms at startup */
restoreRoomsFromDisk().catch(()=>{});

/* Periodic stats logging */
setInterval(() => {
  try {
    const roomCount = Object.keys(rooms).length;
    const userCount = Object.values(rooms).reduce((acc, r) => acc + r.users.size, 0);
    const mem = process.memoryUsage();
    console.log(`[stats] rooms=${roomCount} users=${userCount} mem=${Math.round(mem.rss/1024/1024)}MB uptime=${Math.round(process.uptime())}s`);
  } catch (e) { /* ignore */ }
}, STATS_INTERVAL_SECONDS * 1000).unref();

/* ============================
   Socket.IO event handlers
   ============================ */
io.on('connection', (socket) => {
  // Init metadata
  socketMeta.set(socket.id, { bucket: new TokenBucket(), joinedRoom: null, name: null });

  console.log('[socket] connected', socket.id);

  // joinRoom event: payload { room, name }
  socket.on('joinRoom', (payload) => {
    try {
      if (!payload || typeof payload !== 'object') {
        socket.emit('joinError', { error: 'Invalid join payload' });
        return;
      }
      const room = String(payload.room || '').trim();
      const name = String(payload.name || 'Anon').trim() || 'Anon';
      if (!room) {
        socket.emit('joinError', { error: 'Invalid room' });
        return;
      }

      // Ensure room
      const roomObj = ensureRoom(room);

      // enforce max users
      if (roomObj.users.size >= MAX_USERS_PER_ROOM) {
        socket.emit('full', { error: 'Room is full' });
        return;
      }

      // Join socket.io room
      socket.join(room);
      socket.room = room;
      socket.name = name;
      roomObj.users.set(socket.id, name);
      roomObj.lastActive = Date.now();
      socketMeta.get(socket.id).joinedRoom = room;
      socketMeta.get(socket.id).name = name;

      // Send chat history to the newly joined socket
      socket.emit('chatHistory', roomObj.messages.slice());

      // System join message
      const joinMsg = { id: uuidv4(), type: 'text', name: 'System', text: `🔵 ${name} joined the room`, ts: Date.now() };
      roomObj.messages.push(joinMsg);
      pruneMessages(roomObj);
      io.to(room).emit('chat', joinMsg);

      // Broadcast presence list (simple array of names)
      io.to(room).emit('presence', Array.from(roomObj.users.entries()).map(([id, nm]) => ({ id, name: nm })));

      // Persist room if enabled
      if (PERSIST_ROOMS_TO_DISK) persistRoom(room).catch(()=>{});

      console.log(`[room] ${name} joined ${room} (users=${roomObj.users.size})`);
    } catch (err) {
      console.error('joinRoom error', err);
      socket.emit('joinError', { error: 'Server error on join' });
    }
  });

  // chat (text)
  socket.on('chat', (text) => {
    try {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      // Rate limiting
      if (!meta.bucket.consume(1)) {
        socket.emit('rateLimited', { error: 'You are sending messages too quickly' });
        return;
      }

      const room = socket.room;
      const name = socket.name || 'Anon';
      if (!room || !rooms[room]) {
        socket.emit('errorMessage', 'Room not recognized');
        return;
      }

      const message = { id: uuidv4(), type: 'text', name, text: String(text || '').slice(0, 10000), ts: Date.now() };
      rooms[room].messages.push(message);
      rooms[room].lastActive = Date.now();
      pruneMessages(rooms[room]);
      io.to(room).emit('chat', message);
      if (PERSIST_ROOMS_TO_DISK) persistRoom(room).catch(()=>{});
    } catch (err) {
      console.error('chat handler error', err);
    }
  });

  // file event: payload { url, originalName, size, mime }
  // Client uploads to /upload and then emits 'file'
  socket.on('file', (fileMeta) => {
    try {
      const room = socket.room;
      const name = socket.name || 'Anon';
      if (!room || !rooms[room]) {
        socket.emit('errorMessage', 'Room not recognized');
        return;
      }
      if (!fileMeta || !fileMeta.url) {
        socket.emit('errorMessage', 'Invalid file metadata');
        return;
      }
      const fileMessage = {
        id: uuidv4(),
        type: 'file',
        name,
        file: {
          url: String(fileMeta.url),
          originalName: String(fileMeta.originalName || fileMeta.filename || 'file'),
          size: Number(fileMeta.size || 0),
          mime: String(fileMeta.mime || 'application/octet-stream')
        },
        ts: Date.now()
      };
      rooms[room].messages.push(fileMessage);
      rooms[room].lastActive = Date.now();
      pruneMessages(rooms[room]);
      io.to(room).emit('chat', fileMessage);
      if (PERSIST_ROOMS_TO_DISK) persistRoom(room).catch(()=>{});
    } catch (err) {
      console.error('file event error', err);
    }
  });

  // typing indicator
  socket.on('typing', () => {
    try {
      const room = socket.room;
      if (!room || !rooms[room]) return;
      const payload = { id: socket.id, name: socket.name || 'Anon', ts: Date.now() };
      socket.to(room).emit('typing', payload);
    } catch (err) {}
  });

  // keepAlive (heartbeat)
  socket.on('keepAlive', () => {
    if (socket.room && rooms[socket.room]) rooms[socket.room].lastActive = Date.now();
  });

  // disconnecting: remove from rooms, broadcast leave, delete empty rooms
  socket.on('disconnecting', () => {
    try {
      const joined = Array.from(socket.rooms).filter(r => r !== socket.id);
      for (const room of joined) {
        const roomObj = rooms[room];
        if (!roomObj) continue;
        const name = roomObj.users.get(socket.id) || socket.name || 'Someone';
        roomObj.users.delete(socket.id);
        const leaveMsg = { id: uuidv4(), type: 'text', name: 'System', text: `🔴 ${name} left the room`, ts: Date.now() };
        roomObj.messages.push(leaveMsg);
        io.to(room).emit('chat', leaveMsg);
        io.to(room).emit('presence', Array.from(roomObj.users.entries()).map(([id, nm]) => ({ id, name: nm })));
        if (roomObj.users.size === 0) {
          delete rooms[room];
          if (PERSIST_ROOMS_TO_DISK) fs.remove(path.join(ROOM_PERSIST_DIR, `${room}.json`)).catch(()=>{});
          console.log(`[room] deleted empty room: ${room}`);
        } else {
          if (PERSIST_ROOMS_TO_DISK) persistRoom(room).catch(()=>{});
        }
      }
    } catch (err) {
      console.warn('disconnecting error', err);
    }
  });

  socket.on('disconnect', (reason) => {
    socketMeta.delete(socket.id);
    // final logging
    console.log('[socket] disconnected', socket.id, reason);
  });

}); // end io.on('connection')

/* ============================
   Start server
   ============================ */
server.listen(PORT, () => {
  console.log(`AnonyChat listening at http://localhost:${PORT} (PORT=${PORT})`);
  console.log(`Public dir: ${PUBLIC_DIR}`);
  console.log(`Uploads dir: ${UPLOAD_DIR}`);
  if (PERSIST_ROOMS_TO_DISK) console.log(`Room persistence dir: ${ROOM_PERSIST_DIR}`);
});

/* ============================
   Graceful shutdown
   ============================ */
function shutdown() {
  console.log('Shutdown requested — closing server...');
  server.close(async () => {
    console.log('HTTP server closed.');
    if (PERSIST_ROOMS_TO_DISK) {
      console.log('Persisting rooms to disk before exit...');
      for (const r of Object.keys(rooms)) {
        try { await persistRoom(r); } catch (e) { console.warn('persist error', r, e); }
      }
    }
    console.log('Exiting.');
    process.exit(0);
  });
  // force exit after timeout
  setTimeout(() => {
    console.error('Force exiting after timeout.');
    process.exit(1);
  }, 7000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/* ============================
   End of server.js
   ============================ */
