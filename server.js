const express = require("express");
const path = require("path");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

// Serve static files from public
app.use(express.static(path.join(__dirname, "public")));

// Serve chat index at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Optional: serve chat.html explicitly
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

// Socket.io logic (unchanged)
let users = {};
io.on("connection", (socket) => {
  let userName;

  socket.on("join", (name) => {
    userName = name;
    users[socket.id] = userName;
    io.emit("user-joined", userName);
  });

  socket.on("send-message", ({ sender, message }) => {
    io.emit("receive-message", { sender, message });
  });

  socket.on("disconnect", () => {
    if (userName) {
      io.emit("user-left", userName);
      delete users[socket.id];
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
