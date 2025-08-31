import express from "express";
import http from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------- STATIC FILES ----------
// Chat site (anonychat.xyz)
app.use("/", express.static(join(__dirname, "public/chat")));

// Games site (games.anonychat.xyz)
app.use("/games", express.static(join(__dirname, "public/games")));

// Root index for chat (anonychat.xyz)
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public/chat/index.html"));
});

// Chat rooms (anonychat.xyz/chat)
app.get("/chat", (req, res) => {
  res.sendFile(join(__dirname, "public/chat/chat.html"));
});

// Games index (games.anonychat.xyz)
app.get("/games", (req, res) => {
  res.sendFile(join(__dirname, "public/games/index.html"));
});

// ---------- SOCKET.IO ----------
io.on("connection", (socket) => {
  console.log("User connected");

  socket.on("joinRoom", (room, username) => {
    socket.join(room);
    console.log(`${username} joined room ${room}`);
    io.to(room).emit("message", { user: "System", text: `${username} joined!` });
  });

  socket.on("chatMessage", ({ room, user, text, color }) => {
    io.to(room).emit("message", { user, text, color });
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

// ---------- START ----------
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
