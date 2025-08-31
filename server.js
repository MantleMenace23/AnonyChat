// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import path from "path";

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ===== Middleware & Static Serving =====
app.use(express.static("public"));

// Chat root (default domain)
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public/index.html"));
});

// -------- Games Subdomain --------
// Serve games hub page at games.anonychat.xyz
app.get("/games", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public/games/index.html"));
});

// Serve uploaded games as static files
app.use("/game_uploads", express.static(path.join(process.cwd(), "public/games/game_uploads")));

// List of uploaded games
app.get("/list", (req, res) => {
  const gamesDir = path.join(process.cwd(), "public/games/game_uploads");

  fs.readdir(gamesDir, (err, files) => {
    if (err) {
      console.error("Error reading games directory:", err);
      return res.status(500).json({ error: "Unable to load games" });
    }
    const gameFiles = files.filter(f => f.endsWith(".html"));
    res.json(gameFiles);
  });
});

// ====== Chat (Socket.io) ======
let rooms = {};

io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("joinRoom", ({ room, username, color }) => {
    socket.join(room);

    if (!rooms[room]) {
      rooms[room] = [];
    }

    rooms[room].push({ id: socket.id, username, color });

    io.to(room).emit("userList", rooms[room]);
    console.log(`${username} joined room: ${room}`);
  });

  socket.on("chatMessage", ({ room, username, message, color }) => {
    io.to(room).emit("chatMessage", { username, message, color });
  });

  socket.on("disconnect", () => {
    for (let room in rooms) {
      rooms[room] = rooms[room].filter(u => u.id !== socket.id);
      io.to(room).emit("userList", rooms[room]);
    }
    console.log("A user disconnected");
  });
});

// ===== Start Server =====
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
