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
    cb(null, path.join(__dirname, "public/games/game_uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

app.post("/upload", upload.single("gameFile"), (req, res) => {
  res.send("File uploaded successfully");
});

// ---------- HOSTNAME-BASED ROUTING ----------
app.use((req, res, next) => {
  const host = req.hostname;

  if (host === "anonychat.xyz" || host === "www.anonychat.xyz") {
    // ----- CHAT SITE -----
    if (req.path === "/" || req.path === "/index.html") {
      return res.sendFile(path.join(__dirname, "public/chat/index.html"));
    }
    if (req.path === "/chat") {
      return res.sendFile(path.join(__dirname, "public/chat/chat.html"));
    }
    return express.static(path.join(__dirname, "public/chat"))(req, res, next);
  }

  if (host === "games.anonychat.xyz") {
    // ----- GAMES SITE -----
    if (req.path === "/" || req.path === "/index.html") {
      return res.sendFile(path.join(__dirname, "public/games/index.html"));
    }
    return express.static(path.join(__dirname, "public/games"))(req, res, next);
  }

  return next();
});

// ---------- SOCKET.IO (chat functionality) ----------
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("joinRoom", (room, username) => {
    socket.join(room);
    console.log(`${username} joined room: ${room}`);
    io.to(room).emit("message", {
      user: "System",
      text: `${username} has joined the room.`,
    });
  });

  socket.on("chatMessage", ({ room, user, text, color }) => {
    io.to(room).emit("message", { user, text, color });
  });

  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

// ---------- GAME LIST API (for games page) ----------
app.get("/api/games", (req, res) => {
  if (req.hostname !== "games.anonychat.xyz") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const gamesDir = path.join(__dirname, "public/games/game_uploads");
  const imagesDir = path.join(gamesDir, "images");

  fs.readdir(gamesDir, (err, files) => {
    if (err) {
      return res.status(500).json({ error: "Failed to read games directory" });
    }

    const games = files
      .filter((file) => file.endsWith(".html"))
      .map((file) => {
        const name = path.parse(file).name;
        const possibleImages = [
          `${name}.jpg`,
          `${name}.jpeg`,
          `${name}.png`,
        ];

        let image = null;
        for (const img of possibleImages) {
          if (fs.existsSync(path.join(imagesDir, img))) {
            image = `/games/game_uploads/images/${img}`;
            break;
          }
        }

        return {
          name,
          file: `/games/game_uploads/${file}`,
          image,
        };
      });

    res.json(games);
  });
});

// ---------- START SERVER ----------
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});