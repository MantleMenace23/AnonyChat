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
// Main Express App
// --------------------
const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);
const PORT = process.env.PORT || 3000;

// --------------------
// Host detection middleware
// --------------------
app.use((req, res, next) => {
  req.isChat = req.hostname === "lobby.eduspire.xyz" || req.hostname === "www.lobby.eduspire.xyz";
  req.isGames = req.hostname === "games.eduspire.xyz";
  next();
});

// --------------------
// Serve static files
// --------------------
app.use((req, res, next) => {
  if (req.isChat) {
    express.static(path.join(__dirname, "public/chat"))(req, res, next);
  } else if (req.isGames) {
    express.static(path.join(__dirname, "public/games"))(req, res, next);
  } else {
    res.status(404).send("404 Not Found");
  }
});

// --------------------
// Chat routes (lobby.eduspire.xyz only)
// --------------------
app.get("/", (req, res) => {
  if (req.isChat) {
    res.sendFile(path.join(__dirname, "public/chat/index.html"));
  } else if (req.isGames) {
    res.sendFile(path.join(__dirname, "public/games/index.html"));
  } else {
    res.status(404).send("404 Not Found");
  }
});

// Serve chat page at /chat and /chat/room (no redirect)
app.get(["/chat", "/chat/room"], (req, res) => {
  if (!req.isChat) return res.status(404).send("404 Not Found");
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// --------------------
// Games API for file listing (games.eduspire.xyz)
// --------------------
app.get("/game_uploads", (req, res) => {
  if (!req.isGames) return res.status(404).send("404 Not Found");

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

// --------------------
// Socket.io logic (chat only)
// --------------------
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

// --------------------
// Start server
// --------------------
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Chat subdomain: lobby.eduspire.xyz -> / and /chat (also /chat/room for form submission)`);
  console.log(`Games subdomain: games.eduspire.xyz -> / only`);
});
