const express = require("express");
const http = require("http");
const path = require("path");
const socketIO = require("socket.io");
const vhost = require("vhost");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// ------------ CHAT APP (anonychat.xyz) ------------
const chatApp = express();

// serve chat frontend
chatApp.use(express.static(path.join(__dirname, "public", "chat")));

// socket.io for chat
io.on("connection", (socket) => {
  console.log("User connected to chat");

  socket.on("joinRoom", (room) => {
    socket.join(room);
    console.log(`User joined room: ${room}`);
  });

  socket.on("chatMessage", ({ room, name, color, message }) => {
    io.to(room).emit("chatMessage", { name, color, message });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

// ------------ GAMES APP (games.anonychat.xyz) ------------
const gamesApp = express();

// serve games frontend
gamesApp.use(express.static(path.join(__dirname, "public", "games")));

// serve uploaded games
gamesApp.use(
  "/games/game_uploads",
  express.static(path.join(__dirname, "public", "games", "game_uploads"))
);

// API to list games
gamesApp.get("/api/games", (req, res) => {
  const uploadsDir = path.join(__dirname, "public", "games", "game_uploads");
  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error("Error reading games directory:", err);
      return res.json([]);
    }

    const games = files
      .filter((f) => f.endsWith(".html"))
      .map((f) => {
        const name = path.basename(f, ".html");
        return {
          name,
          file: `/games/game_uploads/${f}`,
          image: `/games/game_uploads/images/${name}.png`,
        };
      });

    res.json(games);
  });
});

// ------------ VHOST SETUP ------------
app.use(vhost("anonychat.xyz", chatApp));
app.use(vhost("games.anonychat.xyz", gamesApp));

// ------------ START SERVER ------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
