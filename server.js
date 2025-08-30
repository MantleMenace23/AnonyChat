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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// Multer setup for file uploads
const upload = multer({ dest: path.join(__dirname, "public/chat/uploads/") });

// Serve static files
app.use("/chat", express.static(path.join(__dirname, "public/chat")));
app.use("/games", express.static(path.join(__dirname, "public/games")));
app.use("/css", express.static(path.join(__dirname, "public/css")));

// === CHAT ROUTES ===
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

app.get("/chat/room", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// File upload endpoint
app.post("/chat/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");
  const file = req.file;
  const fileUrl = `/chat/uploads/${file.filename}_${file.originalname}`;
  fs.renameSync(file.path, path.join(__dirname, "public/chat/uploads", `${file.filename}_${file.originalname}`));
  res.json({ fileUrl, originalName: file.originalname });
});

// === GAMES ROUTES ===
app.get("/games", (req, res) => {
  res.sendFile(path.join(__dirname, "public/games/index.html"));
});

// Dynamically load game tiles from game_uploads
app.get("/games/game_uploads/:gameFile", (req, res) => {
  const gamePath = path.join(__dirname, "public/games/game_uploads", req.params.gameFile);
  if (fs.existsSync(gamePath)) {
    res.sendFile(gamePath);
  } else {
    res.status(404).send("Game not found");
  }
});

// === ADMIN PANEL (example route) ===
app.post("/admin", express.json(), (req, res) => {
  const { token } = req.body;
  if (token !== ADMIN_TOKEN) return res.status(403).send("Forbidden");
  res.send({ status: "ok" });
});

// === DEFAULT ROUTE ===
app.get("/", (req, res) => {
  res.redirect("/chat");
});

// === SOCKET.IO CHAT ===
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join", ({ username, room }) => {
    socket.username = username;
    socket.room = room;
    socket.join(room);
    socket.to(room).emit("user-joined", username);
  });

  socket.on("send-message", ({ room, message }) => {
    io.to(room).emit("receive-message", { sender: socket.username, message });
  });

  socket.on("send-file", ({ room, fileUrl, originalName }) => {
    io.to(room).emit("receive-file", { sender: socket.username, fileUrl, originalName });
  });

  socket.on("disconnect", () => {
    if (socket.username && socket.room) {
      socket.to(socket.room).emit("user-left", socket.username);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
