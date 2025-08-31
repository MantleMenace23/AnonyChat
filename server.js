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
    cb(null, file.originalname); // Keep original name
  },
});
const upload = multer({ storage });

app.post("/upload", upload.single("gameFile"), (req, res) => {
  res.send("File uploaded successfully");
});

// ---------- SERVE STATIC FILES ----------
// anonychat.xyz → lobby
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

// anonychat.xyz/chat → chat rooms
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// games.anonychat.xyz → games site
app.get("/games", (req, res) => {
  res.redirect("https://games.anonychat.xyz");
});

// Serve static files for main site
app.use(express.static(path.join(__dirname, "public/chat")));

// Serve static files for games site under games.anonychat.xyz
app.use(express.static(path.join(__dirname, "public/games")));

// ---------- SOCKET.IO (chat functionality) ----------
io.on("connection", (socket) => {
  console.log("A user connected");

  // Join a room
  socket.on("joinRoom", (room, username) => {
    socket.join(room);
    console.log(`${username} joined room: ${room}`);
    io.to(room).emit("message", {
      user: "System",
      text: `${username} has joined the room.`,
    });
  });

  // Handle chat messages
  socket.on("chatMessage", ({ room, user, text, color }) => {
    io.to(room).emit("message", { user, text, color });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("A user disconnected");
  });
});

// ---------- GAME LIST API (for live search & tiles) ----------
app.get("/api/games", (req, res) => {
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
