const express = require("express");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

// Serve public folder
app.use(express.static("public"));

// Track connected users
let users = {};

io.on("connection", (socket) => {
  let userName;

  // User joins
  socket.on("join", (name) => {
    userName = name;
    users[socket.id] = userName;
    io.emit("user-joined", userName);
  });

  // Send messages
  socket.on("send-message", ({ sender, message }) => {
    io.emit("receive-message", { sender, message });
  });

  // Disconnect
  socket.on("disconnect", () => {
    if (userName) {
      io.emit("user-left", userName);
      delete users[socket.id];
    }
  });
});

// Start server
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Chat server running on port ${PORT}`));
