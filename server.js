// server.js — single web service hosting both chat and games (dynamic static by hostname)
// IMPORTANT: place your chat files in ./public/chat and games files in ./public/games

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// helper: pick folder by hostname
function getFolderByHost(hostname) {
  if (!hostname) return path.join(__dirname, 'public', 'chat');
  hostname = hostname.toLowerCase();
  if (hostname.startsWith('games.')) return path.join(__dirname, 'public', 'games');
  return path.join(__dirname, 'public', 'chat');
}

// Dynamic static middleware: serves files from chat OR games depending on hostname
app.use((req, res, next) => {
  const host = req.hostname || req.headers.host || '';
  const staticFolder = getFolderByHost(host.split(':')[0]); // strip port if any
  express.static(staticFolder, { index: false })(req, res, next);
});

// Root route: serve the index for the right site
app.get('/', (req, res) => {
  const host = (req.hostname || req.headers.host || '').split(':')[0].toLowerCase();
  const folder = getFolderByHost(host);
  res.sendFile(path.join(folder, 'index.html'));
});

// Also explicitly serve games index if someone requests /games (handy)
app.get('/games', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'games', 'index.html'));
});

// ---------------------
// Socket.IO chat logic
// ---------------------
// This implements the common events used by simple chat: joinRoom, chatMessage, disconnect
// It preserves the older behavior of emitting 'message' strings so existing clients keep working.

const sockets = {}; // socketId -> { username, room }

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('joinRoom', (room, username) => {
    try {
      // leave previous room if any
      const prev = sockets[socket.id];
      if (prev && prev.room && prev.room !== room) {
        socket.leave(prev.room);
        io.to(prev.room).emit('message', `${prev.username} left the room`);
      }

      socket.join(room);
      sockets[socket.id] = { username: String(username || 'Anon'), room: String(room || 'lobby') };

      // notify room (string message for compatibility)
      io.to(room).emit('message', `${username} joined ${room}`);

      // send updated user list (non-breaking: additional event)
      const users = getUsersInRoom(room);
      io.to(room).emit('roomData', { room, users });
    } catch (err) {
      console.error('joinRoom error', err);
    }
  });

  socket.on('chatMessage', (data) => {
    // data expected: { room, username, message } OR plain { message } if you use other format
    try {
      if (data && data.room && data.username) {
        io.to(data.room).emit('message', `${data.username}: ${data.message}`);
      } else if (data && data.message) {
        // fallback: broadcast to all
        io.emit('message', `${data.message}`);
      }
    } catch (err) {
      console.error('chatMessage error', err);
    }
  });

  socket.on('leaveRoom', () => {
    const s = sockets[socket.id];
    if (s && s.room) {
      socket.leave(s.room);
      io.to(s.room).emit('message', `${s.username} left ${s.room}`);
      const users = getUsersInRoom(s.room);
      io.to(s.room).emit('roomData', { room: s.room, users });
      delete sockets[socket.id];
    }
  });

  socket.on('disconnect', () => {
    const s = sockets[socket.id];
    if (s && s.room) {
      io.to(s.room).emit('message', `${s.username} disconnected`);
      const users = getUsersInRoom(s.room);
      io.to(s.room).emit('roomData', { room: s.room, users });
    }
    delete sockets[socket.id];
    console.log('socket disconnected', socket.id);
  });
});

// helper: get array of usernames in a room
function getUsersInRoom(room) {
  const users = [];
  for (const id in sockets) {
    if (sockets[id].room === room) users.push(sockets[id].username);
  }
  return users;
}

// listen
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
