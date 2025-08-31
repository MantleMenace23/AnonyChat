const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Config ---
const PORT = process.env.PORT || 10000;
const CHAT_DOMAIN = "anonychat.xyz";
const GAMES_DOMAIN = "games.anonychat.xyz";

// --- Storage for game uploads ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "public/games/game_uploads"));
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// --- Virtual hosts ---
const vhost = require("vhost");

// --- Chat app ---
const chatApp = express();
chatApp.use(express.static(path.join(__dirname, "public/chat")));
chatApp.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// --- Game app ---
const gamesApp = express();
gamesApp.use(express.static(path.join(__dirname, "public/games")));
gamesApp.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/games/index.html"));
});

// Upload game files
gamesApp.post("/upload", upload.single("gameFile"), (req, res) => {
  res.json({ success: true, file: req.file.filename });
});

// --- Use vhost ---
app.use(vhost(CHAT_DOMAIN, chatApp));
app.use(vhost(GAMES_DOMAIN, gamesApp));

// --- Socket.io for chat ---
io.on("connection", (socket) => {
  socket.on("joinRoom", (room) => {
    socket.join(room);
  });

  socket.on("message", ({ room, user, msg }) => {
    io.to(room).emit("message", { user, msg });
  });
});

// --- Start server ---
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
