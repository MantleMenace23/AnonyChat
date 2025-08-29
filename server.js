/**
 * server.js (CommonJS) — FULL, feature-rich AnonyChat server
 *
 * Features:
 *  - Express static hosting for public/
 *  - /upload endpoint using Multer (uploads to ./uploads)
 *  - Socket.IO room management with history + typing + presence
 *  - In-memory rooms with optional per-room JSON persistence on disk
 *  - Auto-delete empty rooms and optional file cleanup worker
 *  - Message pruning to cap memory usage per room
 *  - Rate-limiting per-socket (token bucket)
 *  - Admin endpoints: /health, /rooms, /room/:room
 *  - Safe uploads serving with nosniff + Cache-Control
 *  - Graceful shutdown and metrics logging
 *
 * Adjust configuration variables below to tune behavior.
 *
 * Required npm modules:
 *   express socket.io multer uuid mime-types morgan helmet fs-extra
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra'); // fs-extra for convenience (ensure install)
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const morgan = require('morgan');
const helmet = require('helmet');
const os = require('os');

// ---------------------- CONFIG ----------------------
const PORT = Number(process.env.PORT || 3000);
const APP_ROOT = __dirname;
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const UPLOAD_DIR = path.join(APP_ROOT, 'uploads');
const ROOM_PERSIST_DIR = path.join(APP_ROOT, 'room_data'); // optional persistence
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 20); // upload limit
const MAX_USERS_PER_ROOM = Number(process.env.MAX_USERS_PER_ROOM || 200);
const MAX_MESSAGES_PER_ROOM = Number(process.env.MAX_MESSAGES_PER_ROOM || 5000);
const MESSAGE_PRUNE_TO = Number(process.env.MESSAGE_PRUNE_TO || 3000);
const ALLOWED_MIME_WHITELIST = new Set([
  'image/png','image/jpeg','image/jpg','image/gif','image/webp','image/svg+xml',
  'application/pdf','text/plain','application/zip','application/x-7z-compressed',
  'application/x-rar-compressed','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const FILE_RETENTION_DAYS = Number(process.env.FILE_RETENTION_DAYS || 30);
const ENABLE_FILE_CLEANUP = process.env.ENABLE_FILE_CLEANUP !== 'false'; // default true
const PERSIST_ROOMS_TO_DISK = process.env.PERSIST_ROOMS_TO_DISK === 'true'; // default false

// Token bucket rate limit per socket (messages per second)
const RATE_LIMIT_TOKENS = Number(process.env.RATE_LIMIT_TOKENS || 8);
const RATE_LIMIT_REFILL_MS = Number(process.env.RATE_LIMIT_REFILL_MS || 1000);

// Ensure directories exist
fs.ensureDirSync(UPLOAD_DIR);
if (PERSIST_ROOMS_TO_DISK) fs.ensureDirSync(ROOM_PERSIST_DIR);

// ---------------------- MULTER (uploads) ----------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const original = path.basename(file.originalname || 'file');
    const safeBase = original.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const ext = path.extname(original) || (mime.extension(file.mimetype) ? `.${mime.extension(file.mimetype)}` : '');
    const filename = `${Date.now()}-${uuidv4()}-${safeBase}${ext}`;
    cb(null, filename);
  }
});

function fileFilter(req, file, cb) {
  const type = file.mimetype || '';
  // allow images always; otherwise check whitelist
  if (type.startsWith('image/') || ALLOWED_MIME_WHITELIST.has(type)) {
    cb(null, true);
  } else {
    cb(new Error(`Disallowed file type: ${type}`));
  }
}

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter
});

// ---------------------- EXPRESS SETUP ----------------------
const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

// Serve uploads safely
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

// Health endpoint
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now(), pid: process.pid }));

// Admin endpoints (lightweight)
app.get('/rooms', (_req, res) => {
  const summary = {};
  Object.keys(rooms).forEach(k => {
    summary[k] = {
      users: rooms[k].users.size,
      messages: rooms[k].messages.length,
      lastActive: rooms[k].lastActive
    };
  });
  res.json({ count: Object.keys(rooms).length, rooms: summary, ts: Date.now() });
});

app.get('/room/:room', (req, res) => {
  const r = req.params.room;
  if (!rooms[r]) return res.status(404).json({ error: 'Room not found' });
  res.json({
    room: r,
    users: Array.from(rooms[r].users).length,
    messages: rooms[r].messages.slice(-100), // last 100 messages
    lastActive: rooms[r].lastActive
  });
});

// Upload route
app.post('/upload', (req, res) => {
  const handler = upload.single('file');
  handler(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err && err.message ? err.message : err);
      const code = (err && err.code === 'LIMIT_FILE_SIZE') ? 413 : 400;
      return res.status(code).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const filename = req.file.filename;
    const publicUrl = `/uploads/${encodeURIComponent(filename)}`;
    const meta = {
      url: publicUrl,
      filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
      ts: Date.now()
    };
    res.json(meta);
  });
});

// ---------------------- ROOM STORE + HELPERS ----------------------
/**
 * rooms structure:
 * {
 *   roomCode: {
 *     users: Set(socketId,...),
 *     messages: [ { id, type:'text'|'file', name, text?, file?:{url,originalName,size,mime}, ts } ],
 *     lastActive: timestamp,
 *     createdAt: timestamp
 *   }
 * }
 */
const rooms = {};

// persistence helpers (optional)
async function persistRoomToDisk(room) {
  if (!PERSIST_ROOMS_TO_DISK) return;
  try {
    const obj = rooms[room];
    if (!obj) {
      await fs.remove(path.join(ROOM_PERSIST_DIR, `${room}.json`)).catch(()=>{});
      return;
    }
    const out = {
      createdAt: obj.createdAt,
      lastActive: obj.lastActive,
      messages: obj.messages.slice(-MAX_MESSAGES_PER_ROOM)
    };
    await fs.writeJson(path.join(ROOM_PERSIST_DIR, `${room}.json`), out, { spaces: 2 });
  } catch (err) {
    console.error('persistRoomToDisk error', err);
  }
}

async function restoreRoomsFromDisk() {
  if (!PERSIST_ROOMS_TO_DISK) return;
  try {
    const files = await fs.readdir(ROOM_PERSIST_DIR);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const room = f.slice(0, -5);
      try {
        const data = await fs.readJson(path.join(ROOM_PERSIST_DIR, f));
        rooms[room] = {
          users: new Set(),
          messages: data.messages || [],
          createdAt: data.createdAt || Date.now(),
          lastActive: data.lastActive || Date.now()
        };
        console.log('Restored room from disk:', room);
      } catch (err) {
        console.warn('Failed to parse room file', f, err);
      }
    }
  } catch (err) {
    console.warn('No persisted rooms to restore or error reading dir');
  }
}

// prune messages helper
function pruneMessages(roomObj) {
  if (!roomObj || !roomObj.messages) return;
  const overflow = roomObj.messages.length - MAX_MESSAGES_PER_ROOM;
  if (overflow > 0) {
    roomObj.messages.splice(0, overflow - MESSAGE_PRUNE_TO); // prune down to MESSAGE_PRUNE_TO below cap
  }
}

// ensure room exists
function ensureRoom(room) {
  if (!rooms[room]) {
    rooms[room] = {
      users: new Set(),
      messages: [],
      lastActive: Date.now(),
      createdAt: Date.now()
    };
    if (PERSIST_ROOMS_TO_DISK) persistRoomToDisk(room).catch(()=>{});
  } else {
    rooms[room].lastActive = Date.now();
  }
  return rooms[room];
}

// ---------------------- FILE CLEANUP WORKER (optional) ----------------------
async function cleanupOldFiles() {
  if (!ENABLE_FILE_CLEANUP) return;
  try {
    const files = await fs.readdir(UPLOAD_DIR);
    const now = Date.now();
    const keepMs = FILE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of files) {
      try {
        const full = path.join(UPLOAD_DIR, f);
        const st = await fs.stat(full);
        if (!st.isFile()) continue;
        if ((now - st.mtimeMs) > keepMs) {
          await fs.remove(full);
          console.log('Removed old upload', f);
        }
      } catch (err) {
        console.warn('cleanup file error', f, err.message || err);
      }
    }
  } catch (err) {
    console.warn('cleanupOldFiles error', err);
  }
}

// schedule cleanup daily
if (ENABLE_FILE_CLEANUP) {
  setInterval(() => {
    cleanupOldFiles().catch(()=>{});
  }, 24 * 60 * 60 * 1000).unref();
}

// ---------------------- RATE LIMIT (basic token bucket per-socket) ----------------------
class TokenBucket {
  constructor(tokens = RATE_LIMIT_TOKENS, refillMs = RATE_LIMIT_REFILL_MS) {
    this.capacity = tokens;
    this.tokens = tokens;
    this.refillMs = refillMs;
    this.lastRefill = Date.now();
  }
  consume(n = 1) {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > 0) {
      const refillCount = Math.floor(elapsed / this.refillMs);
      if (refillCount > 0) {
        this.tokens = Math.min(this.capacity, this.tokens + refillCount);
        this.lastRefill = now;
      }
    }
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

// ---------------------- SOCKET.IO SETUP ----------------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// per-socket metadata storage
const socketMeta = new Map(); // socketId -> { bucket, joinedRoom? }

// restore persisted rooms if enabled
restoreRoomsFromDisk().catch(()=>{});

io.on('connection', (socket) => {
  // Initialize token bucket
  socketMeta.set(socket.id, { bucket: new TokenBucket(), typedSince: 0 });

  // Attach basic logging for each socket
  console.log(`[socket] connected: ${socket.id} (total sockets: ${io.engine.clientsCount})`);

  // ----- joinRoom event: create or join room -----
  // payload: { room, name }
  socket.on('joinRoom', (payload) => {
    try {
      if (!payload || typeof payload !== 'object') {
        socket.emit('joinError', { error: 'Invalid payload' });
        return;
      }
      const room = String(payload.room || '').trim();
      const name = String(payload.name || 'Anon').trim() || 'Anon';
      if (!room) {
        socket.emit('joinError', { error: 'Invalid room' });
        return;
      }

      // ensure room
      const roomObj = ensureRoom(room);

      // enforce user limit
      if (roomObj.users.size >= MAX_USERS_PER_ROOM) {
        socket.emit('full', { error: 'Room is full' });
        return;
      }

      // save metadata
      socket.join(room);
      socket.room = room;
      socket.name = name;
      roomObj.users.add(socket.id);
      roomObj.lastActive = Date.now();
      socketMeta.get(socket.id).joinedRoom = room;

      // send existing messages
      socket.emit('chatHistory', roomObj.messages.slice());

      // broadcast join system message
      const joinMsg = { id: uuidv4(), type: 'text', name: 'System', text: `🔵 ${name} joined the room`, ts: Date.now() };
      roomObj.messages.push(joinMsg);
      pruneMessages(roomObj);
      io.to(room).emit('chat', joinMsg);

      // persistence
      if (PERSIST_ROOMS_TO_DISK) persistRoomToDisk(room).catch(()=>{});

      console.log(`[room] ${name} joined ${room} (${roomObj.users.size} users)`);

    } catch (err) {
      console.error('joinRoom handler error', err);
      socket.emit('joinError', { error: 'Server error on join' });
    }
  });

  // ----- text chat -----
  socket.on('chat', (text) => {
    try {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      if (!meta.bucket.consume(1)) {
        socket.emit('rateLimited', { error: 'Slow down — you are sending messages too fast.' });
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

      if (PERSIST_ROOMS_TO_DISK) persistRoomToDisk(room).catch(()=>{});
    } catch (err) {
      console.error('chat handler error', err);
    }
  });

  // ----- typing indicator (debounced) -----
  socket.on('typing', () => {
    try {
      const room = socket.room;
      if (!room) return;
      const payload = { id: socket.id, name: socket.name || 'Anon', ts: Date.now() };
      socket.to(room).emit('typing', payload);
    } catch (err) {
      // ignore
    }
  });

  // ----- file event: client should upload to /upload then emit 'file' with metadata -----
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
      if (PERSIST_ROOMS_TO_DISK) persistRoomToDisk(room).catch(()=>{});
    } catch (err) {
      console.error('file handler error', err);
    }
  });

  // ----- keepAlive (optional heartbeat from client) -----
  socket.on('keepAlive', () => {
    if (socket.room && rooms[socket.room]) rooms[socket.room].lastActive = Date.now();
  });

  // ----- disconnecting: cleanup membership and auto-delete empty rooms -----
  socket.on('disconnecting', () => {
    try {
      const roomsJoined = Array.from(socket.rooms).filter(r => r !== socket.id);
      roomsJoined.forEach(room => {
        const roomObj = rooms[room];
        if (!roomObj) return;
        // remove user
        roomObj.users.delete(socket.id);
        // system leave message
        const leaveMsg = { id: uuidv4(), type: 'text', name: 'System', text: `🔴 ${socket.name || 'Someone'} left the room`, ts: Date.now() };
        roomObj.messages.push(leaveMsg);
        io.to(room).emit('chat', leaveMsg);
        if (PERSIST_ROOMS_TO_DISK) persistRoomToDisk(room).catch(()=>{});
        // delete room if empty
        if (roomObj.users.size === 0) {
          delete rooms[room];
          if (PERSIST_ROOMS_TO_DISK) fs.remove(path.join(ROOM_PERSIST_DIR, `${room}.json`)).catch(()=>{});
          console.log(`[room] deleted empty room: ${room}`);
        }
      });
    } catch (err) {
      console.warn('disconnecting handler error', err);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected: ${socket.id} reason=${reason}`);
    socketMeta.delete(socket.id);
  });
});

// ---------------------- START SERVER ----------------------
server.listen(PORT, () => {
  console.log(`AnonyChat server listening on http://localhost:${PORT}`);
  console.log(`Public dir: ${PUBLIC_DIR}`);
  console.log(`Uploads dir: ${UPLOAD_DIR}`);
  if (PERSIST_ROOMS_TO_DISK) console.log(`Room persistence dir: ${ROOM_PERSIST_DIR}`);
});

// ---------------------- GRACEFUL SHUTDOWN ----------------------
function shutdown() {
  console.log('Shutdown initiated. Closing server...');
  server.close(async () => {
    console.log('HTTP server closed. Saving rooms to disk (if enabled)...');
    if (PERSIST_ROOMS_TO_DISK) {
      for (const r of Object.keys(rooms)) {
        try { await persistRoomToDisk(r); } catch (e) { console.warn('persist during shutdown failed', r, e); }
      }
    }
    console.log('Shutdown complete. Exiting.');
    process.exit(0);
  });
  // force exit after timeout
  setTimeout(() => {
    console.error('Shutdown timeout, forcing exit.');
    process.exit(1);
  }, 7000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ---------------------- OPTIONAL: Periodic stats log ----------------------
setInterval(() => {
  try {
    const roomCount = Object.keys(rooms).length;
    const userCount = Object.values(rooms).reduce((acc, r) => acc + r.users.size, 0);
    const mem = process.memoryUsage();
    console.log(`[stats] rooms=${roomCount} users=${userCount} mem=${Math.round(mem.rss/1024/1024)}MB uptime=${Math.round(process.uptime())}s`);
  } catch (err) { /* ignore */ }
}, 60 * 1000).unref();
