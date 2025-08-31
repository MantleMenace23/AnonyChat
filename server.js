const express = require("express");
const http = require("http");
const path = require("path");
const multer = require("multer");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---------- FILE UPLOADS (for games) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "public", "games", "game_uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// Keep the upload endpoint exactly as you had it
app.post("/upload", upload.single("gameFile"), (req, res) => {
  return res.send("File uploaded successfully");
});

// ---------- HOSTNAME-BASED ROUTING ----------
// NOTE: do NOT call express.static inside the request handler.
// We'll prepare two static handlers and dispatch based on hostname.

const CHAT_HOSTS = new Set(["anonychat.xyz", "www.anonychat.xyz"]);
const GAMES_HOST = "games.anonychat.xyz";

// prepare static middleware instances
const chatStatic = express.static(path.join(__dirname, "public", "chat"));
const gamesStatic = express.static(path.join(__dirname, "public", "games"));

// also expose game_uploads (HTML files) and images at the exact path your frontend expects:
// /games/game_uploads/<file> and /games/game_uploads/images/<img>
const gamesUploadsStatic = express.static(path.join(__dirname, "public", "games", "game_uploads"));

// dispatch middleware based on hostname
app.use((req, res, next) => {
  const host = (req.hostname || "").toLowerCase();

  // CHAT HOST
  if (CHAT_HOSTS.has(host)) {
    // Serve lobby at root
    if (req.path === "/" || req.path === "/index.html") {
      return res.sendFile(path.join(__dirname, "public", "chat", "index.html"));
    }

    // Serve chat page at /chat
    if (req.path === "/chat") {
      return res.sendFile(path.join(__dirname, "public", "chat", "chat.html"));
    }

    // Ensure any in-page client routing under /chat/* returns chat.html (if your frontend relies on it)
    if (req.path.startsWith("/chat/")) {
      return res.sendFile(path.join(__dirname, "public", "chat", "chat.html"));
    }

    // serve other static chat assets
    return chatStatic(req, res, next);
  }

  // GAMES HOST
  if (host === GAMES_HOST) {
    // Games landing page
    if (req.path === "/" || req.path === "/index.html") {
      return res.sendFile(path.join(__dirname, "public", "games", "index.html"));
    }

    // Important: serve uploaded game HTMLs and images at the exact path:
    // mount /games/game_uploads before general games static so those files are reachable.
    if (req.path.startsWith("/games/game_uploads")) {
      // strip nothing — gamesUploadsStatic will handle both /games/game_uploads/<file> and /games/game_uploads/images/<img>
      return gamesUploadsStatic(req, res, next);
    }

    // serve other static games assets (css/js/index.html etc)
    return gamesStatic(req, res, next);
  }

  // default fallback (unknown host)
  return next();
});

// ---------- SOCKET.IO (chat functionality) ----------
io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("joinRoom", (room, username) => {
    socket.join(room);
    console.log(`${username} joined room: ${room}`);
    io.to(room).emit("message", {
      user: "System",
      text: `${username} has joined the room.`,
    });
  });

  socket.on("chatMessage", ({ room, user, text, color }) => {
    if (!room) return;
    io.to(room).emit("message", { user, text, color });
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);
  });
});

// ---------- GAME LIST API ----------
// Keeps the exact behavior you had: only returns when host is games.anonychat.xyz
app.get("/api/games", (req, res) => {
  if ((req.hostname || "").toLowerCase() !== GAMES_HOST) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const gamesDir = path.join(__dirname, "public", "games", "game_uploads");
  const imagesDir = path.join(gamesDir, "images");

  fs.readdir(gamesDir, (err, files) => {
    if (err) {
      console.error("Failed to read games directory:", err);
      return res.status(500).json({ error: "Failed to read games directory" });
    }

    const games = files
      .filter((file) => typeof file === "string" && file.toLowerCase().endsWith(".html"))
      .map((file) => {
        const name = path.parse(file).name;

        // check for several image extensions, return the served path if exist
        const exts = [".png", ".jpg", ".jpeg", ".webp"];
        let image = null;
        for (const ext of exts) {
          const imgPath = path.join(imagesDir, `${name}${ext}`);
          if (fs.existsSync(imgPath)) {
            image = `/games/game_uploads/images/${name}${ext}`;
            break;
          }
        }

        return {
          name,
          file: `/games/game_uploads/${file}`, // EXACT raw path the iframe should load
          image, // may be null
        };
      });

    return res.json(games);
  });
});

// ---------- FULLSCREEN IFRAME WRAPPER (OPTIONAL) ----------
// NOTE: You said you want to keep the URL unchanged and load in an overlay iframe.
// The frontend can just set iframe.src to the `file` value from /api/games.
// Still, we offer a wrapper route (does NOT change existing URL rules) if needed:
// GET /game-wrapper/:name  -> returns a wrapper page that loads /games/game_uploads/<name>.html
app.get("/game-wrapper/:name", (req, res) => {
  const raw = req.params.name || "";
  const name = path.basename(raw);
  const gameFile = path.join(__dirname, "public", "games", "game_uploads", `${name}.html`);
  if (!fs.existsSync(gameFile)) return res.status(404).send("Game not found");

  const wrapperHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-black/90">
  <button onclick="history.back()" class="fixed top-4 left-4 z-50 px-4 py-2 rounded bg-slate-800 text-white">← Back</button>
  <iframe src="/games/game_uploads/${encodeURIComponent(name)}.html" style="position:fixed;inset:0;border:0;width:100%;height:100%"></iframe>
</body></html>`;

  return res.send(wrapperHtml);
});

// ---------- START SERVER ----------
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Expect chat at: anonychat.xyz -> public/chat`);
  console.log(`Expect games at: games.anonychat.xyz -> public/games`);
});
