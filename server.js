// server.js — drop-in replacement (preserves URLs and behavior)
const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const CHAT_HOSTS = new Set(["anonychat.xyz", "www.anonychat.xyz"]);
const GAMES_HOST = "games.anonychat.xyz";

// --- multer upload storage (keeps single-file upload behavior) ---
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(__dirname, "public", "games", "game_uploads");
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => cb(null, file.originalname),
});
const upload = multer({ storage: uploadStorage });

// --- Prepare static middleware instances (not inside request handler) ---
const chatStatic = express.static(path.join(__dirname, "public", "chat"));
const gamesStatic = express.static(path.join(__dirname, "public", "games"));
const gamesUploadsStatic = express.static(path.join(__dirname, "public", "games", "game_uploads"));

// --- Upload endpoint (kept) ---
app.post("/upload", upload.single("gameFile"), (req, res) => {
  return res.send("File uploaded successfully");
});

// --- Host dispatch: dispatch to chat or games behavior based on req.hostname ---
// (keeps your exact URL/domain rules)
app.use((req, res, next) => {
  const host = (req.hostname || "").toLowerCase();

  // CHAT host
  if (CHAT_HOSTS.has(host)) {
    // root -> lobby
    if (req.path === "/" || req.path === "/index.html") {
      return res.sendFile(path.join(__dirname, "public", "chat", "index.html"));
    }
    // /chat -> chat.html
    if (req.path === "/chat") {
      return res.sendFile(path.join(__dirname, "public", "chat", "chat.html"));
    }
    // any /chat/* should also serve chat.html (frontend uses in-page routing/join codes)
    if (req.path.startsWith("/chat/")) {
      return res.sendFile(path.join(__dirname, "public", "chat", "chat.html"));
    }
    // otherwise serve chat assets
    return chatStatic(req, res, next);
  }

  // GAMES host
  if (host === GAMES_HOST) {
    // root -> games index
    if (req.path === "/" || req.path === "/index.html") {
      return res.sendFile(path.join(__dirname, "public", "games", "index.html"));
    }

    // Serve uploaded game HTMLs and images at the exact expected path:
    // /games/game_uploads/<file> and /games/game_uploads/images/<img>
    if (req.path.startsWith("/games/game_uploads")) {
      return gamesUploadsStatic(req, res, next);
    }

    // serve other games assets (index, css, js)
    return gamesStatic(req, res, next);
  }

  // Unknown host
  return next();
});

// --- Socket.io (chat) ---
// Keep behavior broad so older clients work: accept joinRoom, send-message, chatMessage
io.on("connection", (socket) => {
  console.log("socket connected:", socket.id);

  socket.on("joinRoom", (room, username) => {
    if (!room) return;
    socket.join(room);
    socket.username = username || "Anonymous";
    console.log(`${socket.username} joined ${room}`);
    io.to(room).emit("user-joined", { user: socket.username });
  });

  // legacy event names support
  socket.on("send-message", (data) => {
    // expected shape: { room, sender, message }
    if (!data || !data.room) return;
    io.to(data.room).emit("receive-message", {
      sender: data.sender || socket.username || "Anonymous",
      message: data.message,
    });
  });

  socket.on("chatMessage", (payload) => {
    // expected shape: { room, user, text }
    if (!payload || !payload.room) return;
    io.to(payload.room).emit("message", {
      user: payload.user || socket.username || "Anonymous",
      text: payload.text,
    });
  });

  socket.on("disconnect", () => {
    console.log("socket disconnected:", socket.id);
  });
});

// --- /api/games: list games from public/games/game_uploads ---
// Only allowed when the request lands on the games host
app.get("/api/games", (req, res) => {
  if ((req.hostname || "").toLowerCase() !== GAMES_HOST) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const gamesDir = path.join(__dirname, "public", "games", "game_uploads");
  const imagesDir = path.join(gamesDir, "images");
  if (!fs.existsSync(gamesDir)) return res.json([]);

  let files;
  try {
    files = fs.readdirSync(gamesDir);
  } catch (err) {
    console.error("Failed to read games dir:", err);
    return res.status(500).json({ error: "Failed to read games" });
  }

  const games = files
    .filter((f) => typeof f === "string" && f.toLowerCase().endsWith(".html"))
    .map((file) => {
      const name = path.parse(file).name;
      // detect image ext
      const exts = [".png", ".jpg", ".jpeg", ".webp"];
      let image = null;
      for (const ext of exts) {
        const candidate = path.join(imagesDir, `${name}${ext}`);
        if (fs.existsSync(candidate)) {
          image = `/games/game_uploads/images/${name}${ext}`;
          break;
        }
      }
      return { name, file: `/games/game_uploads/${file}`, image };
    });

  return res.json(games);
});

// --- start server ---
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Chat host(s): ${Array.from(CHAT_HOSTS).join(", ")}`);
  console.log(`Games host: ${GAMES_HOST}`);
});
