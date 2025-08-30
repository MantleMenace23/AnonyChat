const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ===== Multer setup for file uploads =====
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + file.originalname),
});

const upload = multer({ storage });

// ===== Middleware =====
app.use(express.static(__dirname)); // serves index.html, chat.html, etc.
app.use("/uploads", express.static(uploadDir)); // serve uploaded files

// ===== Routes =====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/chat/:room", (req, res) => {
  res.sendFile(path.join(__dirname, "chat.html"));
});

// Upload endpoint (for images/files)
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");
  const fileUrl = "/uploads/" + req.file.filename;
  res.json({ url: fileUrl });
});

// ===== Socket.io =====
io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("joinRoom", (room, username) => {
    socket.join(room);
    console.log(`${username} joined ${room}`);
    socket.to(room).emit("message", {
      user: "system",
      text: `${username} joined the room.`,
    });
  });

  socket.on("chatMessage", ({ room, user, text, color }) => {
    io.to(room).emit("message", { user, text, color });
  });

  socket.on("fileUpload", ({ room, user, url }) => {
    io.to(room).emit("fileMessage", { user, url });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// ===== Start server =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
