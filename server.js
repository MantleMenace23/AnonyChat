import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// --------------------
// Setup paths
// --------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------------------
// Chat server
// --------------------
const chatApp = express();
const chatServer = http.createServer(chatApp);
const io = new SocketIOServer(chatServer);
const CHAT_PORT = process.env.CHAT_PORT || 3000;

// Serve chat static files
chatApp.use(express.static(path.join(__dirname, "public/chat")));

// Lobby route
chatApp.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

// Chat room route
chatApp.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// Socket.io chat logic
const rooms = {};

io.on("connection", (socket) => {
  let currentRoom = null;
  let username = null;

  socket.on("joinRoom", ({ room, user }) => {
    if (!room || !user) return;

    currentRoom = room;
    username = user;

    socket.join(currentRoom);

    if (!rooms[currentRoom]) rooms[currentRoom] = {};
    rooms[currentRoom][socket.id] = username;

    socket.to(currentRoom).emit("receive-message", {
      sender: "System",
      message: `${username} joined the room.`,
    });
  });

  socket.on("send-message", ({ message }) => {
    if (!currentRoom || !username) return;
    io.to(currentRoom).emit("receive-message", { sender: username, message });
  });

  socket.on("send-file", ({ fileName, fileData }) => {
    if (!currentRoom || !username) return;
    io.to(currentRoom).emit("receive-file", { sender: username, fileName, fileData });
  });

  socket.on("disconnect", () => {
    if (currentRoom && rooms[currentRoom] && rooms[currentRoom][socket.id]) {
      const leavingUser = rooms[currentRoom][socket.id];
      delete rooms[currentRoom][socket.id];
      socket.to(currentRoom).emit("receive-message", {
        sender: "System",
        message: `${leavingUser} left the room.`,
      });

      if (Object.keys(rooms[currentRoom]).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

// Catch-all for chat
chatApp.use((req, res) => {
  res.status(404).send("404 Not Found - Chat");
});

// Start chat server
chatServer.listen(CHAT_PORT, () => {
  console.log(`Chat server running on http://localhost:${CHAT_PORT}`);
});

// --------------------
// Games server
// --------------------
const gamesApp = express();
const GAMES_PORT = process.env.GAMES_PORT || 4000;

// Serve everything in public/games at root
gamesApp.use(express.static(path.join(__dirname, "public/games")));

// API to list all games (matches your original working file-pulling logic)
gamesApp.get("/game_uploads", (req, res) => {
  const gamesDir = path.join(__dirname, "public/games/game_uploads");
  const imagesDir = path.join(gamesDir, "images");

  try {
    const files = fs.readdirSync(gamesDir).filter(f => f.endsWith(".html"));

    let html = "<!DOCTYPE html><html><body><ul>";
    files.forEach(file => {
      html += `<li><a href="${file}">${file}</a></li>`;
    });
    html += "</ul></body></html>";

    res.send(html);
  } catch (err) {
    res.status(500).send("Error reading games directory");
  }
});

// Catch-all for games
gamesApp.use((req, res) => {
  res.status(404).send("404 Not Found - Games");
});

// Start games server
gamesApp.listen(GAMES_PORT, () => {
  console.log(`Games server running on http://localhost:${GAMES_PORT}`);
});
