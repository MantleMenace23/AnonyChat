const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// -------- FILE UPLOAD SETUP -------- //
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// -------- STATIC FILES -------- //
app.use("/uploads", express.static(uploadDir));

// Chat & Lobby
app.use("/chat", express.static(path.join(__dirname, "public/chat")));

// Games
app.use("/games", express.static(path.join(__dirname, "public/games")));

// Default route → Lobby
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

// Chat room
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// Upload route
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, originalName: req.file.originalname });
});

// -------- SOCKET.IO CHAT LOGIC -------- //
io.on("connection", (socket) => {
  console.log("User connected");

  // User joins a room
  socket.on("joinRoom", ({ username, room }) => {
    socket.join(room);
    socket.username = username;
    socket.room = room;

    // Notify others
    socket.to(room).emit("user-joined", username);
  });

  // Text messages
  socket.on("send-message", ({ sender, message }) => {
    if (socket.room) {
      io.to(socket.room).emit("receive-message", { sender, message });
    }
  });

  // File messages
  socket.on("send-file", ({ sender, fileUrl, originalName }) => {
    if (socket.room) {
      io.to(socket.room).emit("receive-file", {
        sender,
        fileUrl,
        originalName,
      });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    if (socket.username && socket.room) {
      socket.to(socket.room).emit("user-left", socket.username);
    }
  });
});

// -------- START SERVER -------- //
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
