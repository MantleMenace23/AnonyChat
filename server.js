const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// --- Serve static files ---
app.use(express.static(path.join(__dirname, "public"))); // everything under public

// --- Chat routes ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html")); // chat lobby
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html")); // chat room
});

// --- Games site route for subdomain ---
app.get("/", (req, res, next) => {
  // detect host header for games subdomain
  const host = req.headers.host;
  if (host && host.startsWith("games.")) {
    const uploadsDir = path.join(__dirname, "public/games/game_uploads");
    let gameFiles = [];

    if (fs.existsSync(uploadsDir)) {
      gameFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith(".html"));
    }

    let tilesHTML = "";
    gameFiles.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const content = fs.readFileSync(filePath, "utf-8");

      // Extract first image in HTML or fallback
      const imgMatch = content.match(/<img\s+src=["']([^"']+)["']/i);
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i);

      const img = imgMatch ? imgMatch[1] : "/games/default.png";
      const title = titleMatch ? titleMatch[1] : file.replace(".html", "");

      tilesHTML += `
        <div class="game-tile rounded-lg overflow-hidden shadow-lg">
          <a href="/games/game_uploads/${file}" target="_blank" class="block hover:scale-105 transition-transform duration-200">
            <img src="${img}" alt="${title}" class="w-full h-40 object-cover"/>
            <p class="text-center text-lg font-semibold mt-2 text-slate-100">${title}</p>
          </a>
        </div>
      `;
    });

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AnonyChat Games</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          body { background: linear-gradient(to bottom, #1f2937, #111827); font-family: 'Inter', sans-serif; color: #f9fafb; }
          main { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; padding: 2rem; max-width: 1200px; margin: 0 auto; }
        </style>
      </head>
      <body>
        <header class="max-w-6xl mx-auto p-4 text-center">
          <h1 class="text-3xl font-bold">AnonyChat Games</h1>
          <p class="text-slate-400 mt-1">Click a tile to play fullscreen</p>
        </header>
        <main>
          ${tilesHTML || '<p class="text-center text-slate-400 col-span-full">No games uploaded yet.</p>'}
        </main>
      </body>
      </html>
    `);
    return;
  }
  next();
});

// --- Socket.io for Chat ---
io.on("connection", (socket) => {
  console.log("A user connected");

  socket.on("join", (username) => {
    socket.username = username;
    socket.broadcast.emit("user-joined", username);
  });

  socket.on("send-message", ({ sender, message }) => {
    io.emit("receive-message", { sender, message });
  });

  socket.on("disconnect", () => {
    if (socket.username) {
      socket.broadcast.emit("user-left", socket.username);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
