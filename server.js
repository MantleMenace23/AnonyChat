const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const vhost = require("vhost");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const CHAT_DOMAIN = "anonychat.xyz";
const GAMES_DOMAIN = "games.anonychat.xyz";

// --- Chat App ---
const chatApp = express();
chatApp.use(express.static(path.join(__dirname, "public/chat")));

// Serve lobby join
chatApp.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

// Serve /chat route
chatApp.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// Serve any /chat/... route to chat.html
chatApp.get("/chat/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// --- Games App ---
const gamesApp = express();
const gamesPath = path.join(__dirname, "public/games");
const uploadsPath = path.join(gamesPath, "game_uploads");
const imagesPath = path.join(uploadsPath, "images");

// Serve static games files
gamesApp.use(express.static(gamesPath));
gamesApp.use("/game_uploads", express.static(uploadsPath));
gamesApp.use("/game_uploads/images", express.static(imagesPath));

// API to list all games (pulled from GitHub files)
gamesApp.get("/game_list", (req, res) => {
  if (!fs.existsSync(uploadsPath)) return res.json([]);

  const games = fs.readdirSync(uploadsPath)
    .filter(f => f.endsWith(".html"))
    .map(file => {
      const name = path.parse(file).name;
      const possibleExt = [".png", ".jpg", ".jpeg"];
      let image = null;
      for (let ext of possibleExt) {
        const imgPath = path.join(imagesPath, name + ext);
        if (fs.existsSync(imgPath)) {
          image = "/game_uploads/images/" + name + ext;
          break;
        }
      }
      return { name, file: "/game_uploads/" + file, image };
    });

  res.json(games);
});

// --- Mount vhosts ---
app.use(vhost(CHAT_DOMAIN, chatApp));
app.use(vhost(GAMES_DOMAIN, gamesApp));

// --- Socket.IO for chat ---
io.on("connection", socket => {
  socket.on("joinRoom", room => {
    socket.join(room);
  });
  socket.on("message", ({ room, user, msg }) => {
    io.to(room).emit("message", { user, msg });
  });
});

// --- Start server ---
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
