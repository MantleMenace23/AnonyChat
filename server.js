const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// --- Serve static files ---
app.use("/css", express.static(path.join(__dirname, "public/css")));
app.use("/chat", express.static(path.join(__dirname, "public/chat")));
app.use("/games", express.static(path.join(__dirname, "public/games")));

// --- Chat routes ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

app.get("/chat/room", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// --- Games routes ---
app.get("/games", (req, res) => {
  res.sendFile(path.join(__dirname, "public/games/index.html"));
});

// --- Dynamic API to load game tiles ---
app.get("/games/list", (req, res) => {
  const uploadDir = path.join(__dirname, "public/games/game_uploads");
  if (!fs.existsSync(uploadDir)) {
    return res.json([]);
  }
  const files = fs.readdirSync(uploadDir).filter(f => f.endsWith(".html"));
  const games = files.map(file => {
    const htmlPath = path.join(uploadDir, file);
    const content = fs.readFileSync(htmlPath, "utf-8");
    // Extract title from <title> or fallback to filename
    const titleMatch = content.match(/<title>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : "Untitled";
    // Extract first image src if present
    const imgMatch = content.match(/<img[^>]+src="([^">]+)"/i);
    const img = imgMatch ? imgMatch[1] : null;
    return { file, title, img };
  });
  res.json(games);
});

// --- Admin panel check example ---
app.get("/admin", (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) {
    return res.status(403).send("Unauthorized");
  }
  res.send("Admin Panel");
});

// --- Socket.io chat logic ---
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join", (username) => {
    socket.username = username;
    socket.broadcast.emit("user-joined", username);
  });

  socket.on("send-message", ({ sender, message }) => {
    io.emit("receive-message", { sender, message });
  });

  socket.on("send-file", ({ sender, filename, data, mime }) => {
    io.emit("receive-file", { sender, filename, data, mime });
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      socket.broadcast.emit("user-left", socket.username);
    }
  });
});

// --- Start server ---
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
