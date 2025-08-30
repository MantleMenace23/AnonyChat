const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

// Serve static files
app.use("/chat", express.static(path.join(__dirname, "public/chat")));
app.use("/games", express.static(path.join(__dirname, "public/games")));
app.use("/css", express.static(path.join(__dirname, "public/css")));

// Routes for chat pages
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/index.html"));
});

app.get("/chat/room", (req, res) => {
  res.sendFile(path.join(__dirname, "public/chat/chat.html"));
});

// Routes for games pages
app.get("/games", (req, res) => {
  res.sendFile(path.join(__dirname, "public/games/index.html"));
});

// Default route (redirect to chat lobby)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public/chat/index.html"));
});


// Socket.io chat logic
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
