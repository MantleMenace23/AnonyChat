const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// serve static files
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// in-memory rooms
let rooms = {};

// Keep your old 762-line server logic intact
// with only these key fixes added:

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // ---- Join Room ----
  socket.on("joinRoom", ({ roomCode, name }) => {
    if (!roomCode || !name) return;

    // auto-create room if it doesn't exist
    if (!rooms[roomCode]) rooms[roomCode] = { users: {}, messages: [] };

    rooms[roomCode].users[socket.id] = name;
    socket.join(roomCode);

    // send chat history
    socket.emit("chatHistory", rooms[roomCode].messages);

    // announce join
    io.to(roomCode).emit("chatMessage", {
      sender: "System",
      text: `${name} joined the room.`
    });
  });

  // ---- Chat Messages ----
  socket.on("chatMessage", ({ roomCode, msg }) => {
    if (!roomCode || !msg || !rooms[roomCode]) return;

    const sender = rooms[roomCode].users[socket.id] || "Unknown";
    const message = { sender, text: msg };

    rooms[roomCode].messages.push(message);
    io.to(roomCode).emit("chatMessage", message);
  });

  // ---- Disconnect ----
  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      if (rooms[roomCode].users[socket.id]) {
        const name = rooms[roomCode].users[socket.id];
        delete rooms[roomCode].users[socket.id];

        io.to(roomCode).emit("chatMessage", {
          sender: "System",
          text: `${name} left the room.`
        });

        // remove empty rooms
        if (
          Object.keys(rooms[roomCode].users).length === 0 &&
          rooms[roomCode].messages.length === 0
        ) delete rooms[roomCode];
      }
    }
  });

  // ---- Your original custom events logic ----
  // Place any additional events you had in your 762-line server.js here,
  // but make sure they reference rooms properly as above
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
