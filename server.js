import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server);

const PORT = process.env.PORT || 3000;

// Resolve paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --------------------
// Middleware
// --------------------

// Serve public folder
// Games are on a subdomain, so we mount them under /games for internal paths
app.use(express.static(path.join(__dirname, "public")));

// --------------------
// Routes
// --------------------

// Lobby
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

// Chat room
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// Games main page (games.anonychat.xyz should point here via DNS or reverse proxy)
app.get("/games", (req, res) => {
  res.sendFile(path.join(__dirname, "public/games/index.html"));
});

// API endpoint → list all games
app.get("/games/api/games", (req, res) => {
  const gamesDir = path.join(__dirname, "public/games/game_uploads");
  const imagesDir = path.join(gamesDir, "images");

  const files = fs.readdirSync(gamesDir).filter(f => f.endsWith(".html"));

  const games = files.map(file => {
    const name = path.parse(file).name;

    // Match any image type
    let image = null;
    const exts = [".jpg", ".jpeg", ".png"];
    for (const ext of exts) {
      if (fs.existsSync(path.join(imagesDir, name + ext))) {
        image = `/games/game_uploads/images/${name + ext}`;
        break;
      }
    }

    return {
      name,
      file: `/games/game_uploads/${file}`,
      image: image || null
    };
  });

  res.json(games);
});

// Catch-all → 404
app.use((req, res) => {
  res.status(404).send("404 Not Found");
});

// --------------------
// Socket.io Chat
// --------------------

const rooms = {};

io.on("connection", (socket) => {
  let currentRoom = null;
  let username = null;

  socket.on("joinRoom", ({ room, user }) => {
    if (!room || !user) return;

    currentRoom = room;
    username = user;

    socket.join(currentRoom);

    if (!rooms[currentRoom]) rooms[currentRoom] = {};
    rooms[currentRoom][socket.id] = username;

    socket.to(currentRoom).emit("receive-message", { sender: "System", message: `${username} joined the room.` });
  });

  socket.on("send-message", ({ message }) => {
    if (!currentRoom || !username) return;
    io.to(currentRoom).emit("receive-message", { sender: username, message });
  });

  socket.on("send-file", ({ fileName, fileData }) => {
    if (!currentRoom || !username) return;
    io.to(currentRoom).emit("receive-file", { sender: username, fileName, fileData });
  });

  socket.on("disconnect", () => {
    if (currentRoom && rooms[currentRoom] && rooms[currentRoom][socket.id]) {
      const leavingUser = rooms[currentRoom][socket.id];
      delete rooms[currentRoom][socket.id];
      socket.to(currentRoom).emit("receive-message", { sender: "System", message: `${leavingUser} left the room.` });

      if (Object.keys(rooms[currentRoom]).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

// --------------------
// Start server
// --------------------
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
