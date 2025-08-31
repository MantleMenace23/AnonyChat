// server.js
const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// ===== ROUTES =====

// Home page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Chat always at /chat
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// ===== SOCKET.IO =====
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // Join a room by join code
  socket.on("joinRoom", (joinCode, username) => {
    socket.join(joinCode);
    socket.joinCode = joinCode;
    socket.username = username;

    console.log(`${username} joined room ${joinCode}`);
    io.to(joinCode).emit("message", {
      user: "system",
      text: `${username} has joined the room.`,
    });
  });

  // Handle chat messages
  socket.on("chatMessage", (msg) => {
    if (socket.joinCode) {
      io.to(socket.joinCode).emit("message", {
        user: socket.username,
        text: msg,
      });
    }
  });

  // Disconnect
  socket.on("disconnect", () => {
    if (socket.joinCode) {
      io.to(socket.joinCode).emit("message", {
        user: "system",
        text: `${socket.username || "Someone"} has left the room.`,
      });
    }
    console.log("Client disconnected:", socket.id);
  });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
