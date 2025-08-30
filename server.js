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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin123";

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "public/chat/uploads"));
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + "-" + file.originalname;
    cb(null, unique);
  },
});
const upload = multer({ storage });

// Serve static folders
app.use("/chat", express.static(path.join(__dirname, "public/chat")));
app.use("/games", express.static(path.join(__dirname, "public/games")));
app.use("/css", express.static(path.join(__dirname, "public/css")));

// Middleware to detect domain and serve correct site
app.use((req, res, next) => {
  const host = req.headers.host;
  req.isChat = host.includes("anonychat.xyz") && !host.startsWith("games.");
  req.isGames = host.startsWith("games.");
  next();
});

// Chat routes
app.get("/", (req, res) => {
  if (req.isChat) {
    res.sendFile(path.join(__dirname, "public/chat/index.html"));
  } else if (req.isGames) {
    res.sendFile(path.join(__dirname, "public/games/index.html"));
  } else {
    res.status(404).send("Unknown domain");
  }
});

app.get("/chat/room", (req, res) => {
  if (req.isChat) {
    res.sendFile(path.join(__dirname, "public/chat/chat.html"));
  } else {
    res.status(404).send("Not found");
  }
});

// File upload for chat
app.post("/chat/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");
  res.json({
    filename: req.file.filename,
    url: `/chat/uploads/${req.file.filename}`,
  });
});

// Serve game HTML dynamically
app.get("/games/game_uploads/:file", (req, res) => {
  if (!req.isGames) return res.status(404).send("Not found");
  const filePath = path.join(__dirname, "public/games/game_uploads", req.params.file);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("Game not found");
  }
});

// API to list games dynamically
app.get("/games/list", (req, res) => {
  if (!req.isGames) return res.status(404).send("Not found");
  const dir = path.join(__dirname, "public/games/game_uploads");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".html"));
  const games = files.map(file => {
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    // Extract title and image from HTML meta tags
    const titleMatch = html.match(/<title>(.*?)<\/title>/);
    const imgMatch = html.match(/<img.*?src="(.*?)"/);
    return {
      file,
      title: titleMatch ? titleMatch[1] : "Untitled",
      image: imgMatch ? imgMatch[1] : "",
    };
  });
  res.json(games);
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

  socket.on("send-file", ({ sender, file }) => {
    io.emit("receive-file", { sender, file });
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      socket.broadcast.emit("user-left", socket.username);
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
