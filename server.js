const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin123";

// Serve static files
app.use("/chat", express.static(path.join(__dirname, "public/chat")));
app.use("/games", express.static(path.join(__dirname, "public/games")));
app.use("/css", express.static(path.join(__dirname, "public/css")));

// Serve dynamically generated game HTML files
app.use("/games/game_uploads", express.static(path.join(__dirname, "public/games/game_uploads")));

// Routes for chat pages
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

app.get("/chat/room", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// Routes for games pages
app.get("/games", (req, res) => {
  res.sendFile(path.join(__dirname, "public/games/index.html"));
});

// Admin panel route (example)
app.get("/admin", (req, res) => {
  if (req.query.token === ADMIN_TOKEN) {
    res.sendFile(path.join(__dirname, "public/games/admin.html"));
  } else {
    res.status(403).send("Forbidden");
  }
});

// API route to fetch all games dynamically
app.get("/games/list", (req, res) => {
  const uploadsDir = path.join(__dirname, "public/games/game_uploads");
  fs.readdir(uploadsDir, (err, files) => {
    if (err) return res.json([]);
    const htmlFiles = files.filter(f => f.endsWith(".html"));
    res.json(htmlFiles);
  });
});

// Default route → chat lobby
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

// Socket.io chat logic
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join", (username) => {
    socket.username = username;
    socket.broadcast.emit("user-joined", username);
  });

  socket.on("send-message", ({ sender, message }) => {
    io.emit("receive-message", { sender, message });
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      socket.broadcast.emit("user-left", socket.username);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
