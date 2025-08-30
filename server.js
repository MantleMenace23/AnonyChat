const express = require("express");
const path = require("path");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http);

// Serve all static files from public
app.use(express.static(path.join(__dirname, "public")));

// ---------- ROUTES ----------

// Chat main page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat", "index.html"));
});

// Chat alternative page if needed
app.get("/chat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat", "chat.html"));
});

// Games main page
app.get("/games", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "games", "index.html"));
});

// Optional: serve other static assets inside chat or games folders
app.use("/chat", express.static(path.join(__dirname, "public", "chat")));
app.use("/games", express.static(path.join(__dirname, "public", "games")));

// ---------- SOCKET.IO FOR CHAT ----------

let users = {};

io.on("connection", (socket) => {
  let userName;

  // User joins chat
  socket.on("join", (name) => {
    userName = name;
    users[socket.id] = userName;
    io.emit("user-joined", userName);
  });

  // User sends message
  socket.on("send-message", ({ sender, message }) => {
    io.emit("receive-message", { sender, message });
  });

  // User disconnects
  socket.on("disconnect", () => {
    if (userName) {
      io.emit("user-left", userName);
      delete users[socket.id];
    }
  });
});

// ---------- START SERVER ----------

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));
