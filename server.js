// server.js (CommonJS) - full-featured AnonyChat server
// - Express static for /public
// - /upload endpoint using Multer (uploads to ./uploads)
// - Socket.IO room management, history, join/leave broadcast
// - Auto-delete empty rooms
// - Message pruning to limit memory usage
// - Safe file serving with nosniff header
// Requires: npm i express socket.io multer uuid mime-types morgan helmet

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const mime = require('mime-types');
const morgan = require('morgan');
const helmet = require('helmet');

// -------- CONFIG --------
const PORT = process.env.PORT || 3000;
const APP_ROOT = __dirname;
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const UPLOAD_DIR = path.join(APP_ROOT, 'uploads');
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 10);
const MAX_MESSAGES_PER_ROOM = 1000; // prune older messages beyond this
const MAX_USERS_PER_ROOM = Number(process.env.MAX_USERS_PER_ROOM || 50);

// Allowed mime prefixes/types (images always allowed, add other types as needed)
const ALLOWED_MIME_WHITELIST = new Set([
  // images
  'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml',
  // documents
  'application/pdf', 'text/plain',
  // archives (common types)
  'application/zip', 'application/x-7z-compressed', 'application/x-rar-compressed',
  // common office formats (optional - add if you want)
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// -------- Multer setup (disk storage, sanitized filenames) --------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // sanitize original name and append uuid + timestamp
    const original = path.basename(file.originalname);
    const safeBase = original.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const ext = path.extname(original) || (mime.extension(file.mimetype) ? `.${mime.extension(file.mimetype)}` : '');
    const filename = `${Date.now()}-${uuidv4()}-${safeBase}${ext}`;
    cb(null, filename);
  }
});

// file filter checks mime types
function fileFilter(req, file, cb) {
  const mimetype = file.mimetype || '';
  // Allow anything that starts with image/ OR is on the whitelist
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

// -------- Express + security & logging --------
const app = express();
app.use(helmet({
  // allow images to be loaded cross-origin from the uploads folder if needed
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(morgan('tiny'));

// serve site static files
app.use(express.static(PUBLIC_DIR));

// serve uploads with a header to prevent content sniffing
app.use('/uploads', express.static(UPLOAD_DIR, {
  index: false,
  setHeaders: (res, filePath) => {
    // set Content-Type if possible
    const ext = path.extname(filePath).slice(1);
    const t = mime.lookup(ext);
    if (t) res.setHeader('Content-Type', t);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // optionally add cache-control (adjust as desired)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// -------- Health & admin endpoints --------
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Optional: list active rooms (not exposed in production unless you want it)
app.get('/rooms', (_req, res) => {
  // returns room name -> { users, messageCount, lastActive }
  const summary = {};
  for (const [room, obj] of Object.entries(rooms)) {
    summary[room] = {
      users: obj.users.size,
      messageCount: obj.messages.length,
      lastActive: obj.lastActive
    };
  }
  res.json(summary);
});

// -------- In-memory room store --------
// Structure:
// rooms = {
//   roomCode: {
//     users: Set(socketId, ...),
//     messages: [ { id, type: 'text'|'file', name, text?, file?:{url, originalName, size, mime}, ts } ],
//     lastActive: timestamp
//   },
//   ...
// }
const rooms = {};

// Helper: ensure room exists
function ensureRoom(room) {
  if (!rooms[room]) {
    rooms[room] = {
      users: new Set(),
      messages: [],
      lastActive: Date.now()
    };
  } else {
    rooms[room].lastActive = Date.now();
  }
  return rooms[room];
}

// Helper: prune old messages to cap memory usage
function pruneMessages(roomObj) {
  if (!roomObj || !roomObj.messages) return;
  const overflow = roomObj.messages.length - MAX_MESSAGES_PER_ROOM;
  if (overflow > 0) {
    roomObj.messages.splice(0, overflow);
  }
}

// -------- HTTP server + Socket.IO --------
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // loosened for dev; tighten for production
});

// Attach useful middleware per-socket if needed
io.on('connection', (socket) => {
  // We'll set socket.room and socket.name after join
  socket.room = null;
  socket.name = null;

  // JOIN ROOM
  // payload: { room: string, name: string }
  socket.on('joinRoom', (payload) => {
    try {
      const room = String((payload && payload.room) || '').trim();
      const name = String((payload && payload.name) || 'Anon').trim() || 'Anon';
      if (!room) {
        socket.emit('joinError', { error: 'Invalid room' });
        return;
      }

      // create or get the room
      const roomObj = ensureRoom(room);

      // enforce limits per-room
      if (roomObj.users.size >= MAX_USERS_PER_ROOM) {
        socket.emit('full', { error: 'Room is full' });
        return;
      }

      // join
      socket.join(room);
      socket.room = room;
      socket.name = name;
      roomObj.users.add(socket.id);
      roomObj.lastActive = Date.now();

      // send existing history (a copy)
      socket.emit('chatHistory', roomObj.messages.slice());

      // broadcast system join message
      const joinMsg = {
        id: uuidv4(),
        type: 'text',
        name: 'System',
        text: `🔵 ${name} joined the room`,
        ts: Date.now()
      };
      roomObj.messages.push(joinMsg);
      pruneMessages(roomObj);
      io.to(room).emit('chat', joinMsg);

    } catch (err) {
      console.error('joinRoom error', err);
      socket.emit('joinError', { error: 'Server error on join' });
    }
  });

  // CHAT (text)
  // payload: string (text)
  socket.on('chat', (text) => {
    try {
      const room = socket.room;
      const name = socket.name || 'Anon';
      if (!room || !rooms[room]) {
        socket.emit('errorMessage', 'Room not recognized');
        return;
      }
      const message = {
        id: uuidv4(),
        type: 'text',
        name,
        text: String(text || '').slice(0, 5000),
        ts: Date.now()
      };
      rooms[room].messages.push(message);
      rooms[room].lastActive = Date.now();
      pruneMessages(rooms[room]);
      io.to(room).emit('chat', message);

    } catch (err) {
      console.error('chat error', err);
    }
  });

  // FILE BROADCAST
  // payload: { url, originalName, size, mime }
  // NOTE: clients should upload to /upload first, then emit 'file' with the returned metadata.
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

      // shape the file message
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

    } catch (err) {
      console.error('file event error', err);
    }
  });

  // Keep-alive / heartbeat - optional
  socket.on('keepAlive', () => {
    if (socket.room && rooms[socket.room]) {
      rooms[socket.room].lastActive = Date.now();
    }
  });

  // CLEANUP: when a socket is leaving rooms (disconnecting)
  socket.on('disconnecting', () => {
    // socket.rooms is a Set-like; includes socket.id and any joined rooms
    const joined = Array.from(socket.rooms).filter(r => r !== socket.id);
    joined.forEach(room => {
      const roomObj = rooms[room];
      if (!roomObj) return;

      // remove user
      roomObj.users.delete(socket.id);

      // broadcast leave
      const leaveMsg = {
        id: uuidv4(),
        type: 'text',
        name: 'System',
        text: `🔴 ${socket.name || 'Someone'} left the room`,
        ts: Date.now()
      };
      roomObj.messages.push(leaveMsg);
      io.to(room).emit('chat', leaveMsg);

      // auto-delete empty room
      if (roomObj.users.size === 0) {
        // optional: you could also delete associated uploaded files here, but careful
        delete rooms[room];
        // console.log(`Deleted room ${room} (empty)`);
      }
    });
  });

  socket.on('disconnect', (reason) => {
    // final cleanup logging if needed
    // console.log('socket disconnected', socket.id, reason);
  });
});

// -------- Upload endpoint (Multer) --------
// Note: client should POST FormData { file } -> server stores it and returns metadata JSON.
// After a successful upload the client should emit socket 'file' with returned metadata.
app.post('/upload', (req, res) => {
  // Use the multer 'upload.single' wrapper here for express route
  const handler = upload.single('file');
  handler(req, res, (err) => {
    if (err) {
      // multer error
      console.error('MULTER ERROR', err);
      const code = (err.code === 'LIMIT_FILE_SIZE') ? 413 : 400;
      return res.status(code).json({ error: err.message || 'Upload error' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Build a safe public URL path (served from /uploads)
    const filename = req.file.filename;
    const publicUrl = `/uploads/${encodeURIComponent(filename)}`;

    // Return metadata to client
    return res.json({
      url: publicUrl,
      filename: filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype
    });
  });
});

// -------- Start server --------
server.listen(PORT, () => {
  console.log(`AnonyChat listening on http://localhost:${PORT} (PORT=${PORT})`);
});

// -------- Graceful shutdown helper (optional) --------
function shutdown() {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  // force exit after 5s
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
