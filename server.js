const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const multer = require("multer");
const vhost = require("vhost");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const CHAT_DOMAIN = "anonychat.xyz";
const GAMES_DOMAIN = "games.anonychat.xyz";

// --- Multer storage for game uploads ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, "public/games/game_uploads"));
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

// --- Chat app ---
const chatApp = express();
chatApp.use(express.static(path.join(__dirname, "public/chat")));
chatApp.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// --- Games app ---
const gamesApp = express();
gamesApp.use(express.static(path.join(__dirname, "public/games")));

// Dynamic game list API
gamesApp.get("/game_list", (req, res) => {
  const uploadsPath = path.join(__dirname, "public/games/game_uploads");
  const imagesPath = path.join(uploadsPath, "images");

  const games = fs.readdirSync(uploadsPath)
    .filter(f => f.endsWith(".html"))
    .map(file => {
      const name = path.parse(file).name;
      // Check for matching image
      const possibleExtensions = [".png", ".jpg", ".jpeg"];
      let image = null;
      for (let ext of possibleExtensions) {
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

// Upload a new game file
gamesApp.post("/upload", upload.single("gameFile"), (req, res) => {
  res.json({ success: true, file: req.file.filename });
});

// --- Mount vhosts ---
app.use(vhost(CHAT_DOMAIN, chatApp));
app.use(vhost(GAMES_DOMAIN, gamesApp));

// --- Socket.IO for chat rooms ---
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
