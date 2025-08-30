const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "admin";

// --- Serve static files ---
app.use("/chat", express.static(path.join(__dirname, "public/chat")));
app.use("/games", express.static(path.join(__dirname, "public/games")));

// --- Routes for Chat ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

app.get("/chat/room", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// --- Routes for Games ---
app.get("/games", (req, res) => {
  const uploadsDir = path.join(__dirname, "public/games/game_uploads");
  let gameFiles = [];

  // Pull all HTML files from game_uploads
  if (fs.existsSync(uploadsDir)) {
    gameFiles = fs.readdirSync(uploadsDir).filter(f => f.endsWith(".html"));
  }

  // Build HTML dynamically
  let tilesHTML = "";
  gameFiles.forEach(file => {
    const filePath = path.join(uploadsDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    // Extract image src and title from the file
    let imgMatch = content.match(/<img\s+src=["']([^"']+)["']/i);
    let titleMatch = content.match(/<title>([^<]+)<\/title>/i);

    const img = imgMatch ? imgMatch[1] : "default.png";
    const title = titleMatch ? titleMatch[1] : file.replace(".html", "");

    tilesHTML += `
      <div class="game-tile">
        <a href="/games/game_uploads/${file}" target="_blank">
          <img src="${img}" alt="${title}" />
          <p>${title}</p>
        </a>
      </div>
    `;
  });

  // Send the full page
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AnonyChat Games</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link rel="stylesheet" href="/games/games.css">
    </head>
    <body class="bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100 font-sans">
      <header class="max-w-6xl mx-auto p-4 flex items-center justify-between gap-4">
        <h1 class="text-2xl font-bold">AnonyChat Games</h1>
      </header>
      <main class="max-w-6xl mx-auto p-4 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        ${tilesHTML || '<p class="text-center text-slate-400 col-span-full">No games uploaded yet.</p>'}
      </main>
    </body>
    </html>
  `);
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
