// server.js (CommonJS)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const PORT = process.env.PORT || 3000;
const MAX_USERS_PER_ROOM = 50; // adjust as needed
const ROOM_EXPIRY_DAYS = 30; // unused here but kept from earlier design
const MAX_FILE_MB = 10;

const APP_ROOT = __dirname;
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const UPLOAD_DIR = path.join(APP_ROOT, 'uploads');

// ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // create a safe, unique filename
    const time = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    cb(null, `${time}-${Math.round(Math.random()*1e9)}-${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 }
});

// Express + Socket.IO setup
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files (index.html, chat.html, script.js, style.css)
app.use(express.static(PUBLIC_DIR));
// Serve uploaded files
app.use('/uploads', express.static(UPLOAD_DIR, { index: false }));

// In-memory room store
// rooms = {
//   roomCode: {
//     users: Set(socketId,...),
//     messages: [ { type: 'text', name, text, ts }, { type: 'file', name, file: { url, originalName, size, mime }, ts } ],
//     lastActive: timestamp
//   }
// }
const rooms = {};

// Helper: ensure room exists
function ensureRoom(room) {
  if (!rooms[room]) {
    rooms[room] = { users: new Set(), messages: [], lastActive: Date.now() };
  }
  rooms[room].lastActive = Date.now();
  return rooms[room];
}

// Upload endpoint (used by client to upload file via fetch FormData)
app.post('/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Build metadata to return to client
    const fileUrl = `/uploads/${encodeURIComponent(req.file.filename)}`;
    const info = {
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype
    };
    return res.json(info);
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// Health endpoint (optional)
app.get('/health', (_req, res) => res.json({ ok: true }));

// Socket.IO behavior
io.on('connection', (socket) => {
  // store current room for socket
  socket.currentRoom = null;
  socket.userName = null;

  // Join room event
  // payload: { room, name }
  socket.on('joinRoom', (payload) => {
    try {
      const room = String(payload.room || '').trim();
      const name = String(payload.name || 'Anon').trim() || 'Anon';
      if (!room) {
        socket.emit('joinError', { error: 'Invalid room' });
        return;
      }

      // create or get room
      const roomObj = ensureRoom(room);

      // enforce max users per room
      if (roomObj.users.size >= MAX_USERS_PER_ROOM) {
        socket.emit('full');
        return;
      }

      // join socket
      socket.join(room);
      socket.currentRoom = room;
      socket.userName = name;
      roomObj.users.add(socket.id);
      roomObj.lastActive = Date.now();

      // send existing messages to this socket
      socket.emit('chatHistory', roomObj.messages);

      // broadcast join system message
      const joinMsg = {
        type: 'text',
        name: 'System',
        text: `🔵 ${name} joined the room`,
        ts: Date.now()
      };
      roomObj.messages.push(joinMsg);
      io.to(room).emit('chat', joinMsg);
    } catch (err) {
      console.error('joinRoom error', err);
      socket.emit('joinError', { error: 'Server error on join' });
    }
  });

  // Text chat event
  // payload: text string
  socket.on('chat', (text) => {
    const room = socket.currentRoom;
    const name = socket.userName || 'Anon';
    if (!room || !rooms[room]) return;

    const message = {
      type: 'text',
      name,
      text: String(text || ''),
      ts: Date.now()
    };

    rooms[room].messages.push(message);
    rooms[room].lastActive = Date.now();
    io.to(room).emit('chat', message);
  });

  // File broadcast event (client should POST to /upload, then emit this with file metadata)
  // payload: { url, originalName, size, mime }
  socket.on('file', (fileMeta) => {
    const room = socket.currentRoom;
    const name = socket.userName || 'Anon';
    if (!room || !rooms[room]) return;
    if (!fileMeta || !fileMeta.url) return;

    const message = {
      type: 'file',
      name,
      file: {
        url: String(fileMeta.url),
        originalName: String(fileMeta.originalName || 'file'),
        size: Number(fileMeta.size || 0),
        mime: String(fileMeta.mime || 'application/octet-stream')
      },
      ts: Date.now()
    };

    rooms[room].messages.push(message);
    rooms[room].lastActive = Date.now();
    io.to(room).emit('chat', message);
  });

  // Handle disconnect: remove from room and delete room if empty
  socket.on('disconnecting', () => {
    // socket.rooms contains rooms it is currently in (including a private socket room)
    const joinedRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    joinedRooms.forEach((room) => {
      const roomObj = rooms[room];
      if (!roomObj) return;
      roomObj.users.delete(socket.id);
      // broadcast leave message
      const leaveMsg = {
        type: 'text',
        name: 'System',
        text: `🔴 ${socket.userName || 'Someone'} left the room`,
        ts: Date.now()
      };
      roomObj.messages.push(leaveMsg);
      io.to(room).emit('chat', leaveMsg);

      // if empty, delete the room
      if (roomObj.users.size === 0) {
        delete rooms[room];
        // NOTE: uploaded files are not auto-deleted here (keeps uploads intact).
      }
    });
  });

  socket.on('disconnect', () => {
    // nothing else to do here (cleanup already performed in disconnecting)
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`AnonyChat server listening on http://localhost:${PORT} (PORT=${PORT})`);
});
