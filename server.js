const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "adminsecret";

// --------- Multer for file uploads (game uploads) ---------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "public/games/game_uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// --------- Serve static files ---------
app.use("/chat", express.static(path.join(__dirname, "public/chat")));
app.use("/games", express.static(path.join(__dirname, "public/games")));
app.use("/css", express.static(path.join(__dirname, "public/css")));

// --------- Chat routes ---------
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

app.get("/chat/room", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// --------- Games routes ---------
app.get("/games", (req, res) => {
  res.sendFile(path.join(__dirname, "public/games/index.html"));
});

// List uploaded games for frontend
app.get("/games/list-uploads", (req, res) => {
  const uploadsDir = path.join(__dirname, "public/games/game_uploads");
  if (!fs.existsSync(uploadsDir)) return res.json([]);
  const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith(".html"));
  res.json(files);
});

// Serve individual uploaded games
app.use("/games/game_uploads", express.static(path.join(__dirname, "public/games/game_uploads")));

// --------- Admin panel ---------
app.get("/admin", (req, res) => {
  const token = req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).send("Forbidden: Invalid token");
  res.sendFile(path.join(__dirname, "public/games/admin.html"));
});

// Upload new game via admin panel
app.post("/admin/upload", upload.single("gameFile"), (req, res) => {
  if (req.query.token !== ADMIN_TOKEN) return res.status(403).send("Forbidden: Invalid token");
  res.json({ success: true, filename: req.file.originalname });
});

// --------- Default route: chat lobby ---------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

// --------- Socket.io chat logic ---------
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join", (username) => {
    socket.username = username;
    socket.broadcast.emit("user-joined", username);
  });

  socket.on("send-message", ({ sender, message }) => {
    io.emit("receive-message", { sender, message });
  });

  socket.on("send-file", ({ sender, filename, url, type }) => {
    io.emit("receive-file", { sender, filename, url, type });
  });

  socket.on("disconnect", () => {
    if (socket.username) socket.broadcast.emit("user-left", socket.username);
  });
});

// --------- Start server ---------
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
