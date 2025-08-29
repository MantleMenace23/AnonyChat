const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// In-memory room storage
let rooms = {};

// File upload setup
const uploadsDir = path.join(__dirname, "public", "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
  })
});

// Upload endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded");
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Socket.io logic
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join room
  socket.on("joinRoom", ({ roomCode, name }) => {
    if (!roomCode || !name) return;

    if (!rooms[roomCode]) rooms[roomCode] = { users: {}, messages: [] };
    rooms[roomCode].users[socket.id] = name;
    socket.join(roomCode);

    // Send chat history
    socket.emit("chatHistory", rooms[roomCode].messages);

    // Announce join
    io.to(roomCode).emit("chatMessage", {
      sender: "System",
      text: `${name} joined the room.`
    });
  });

  // Chat messages
  socket.on("chatMessage", ({ roomCode, msg, color }) => {
    if (!roomCode || !msg || !rooms[roomCode]) return;

    const sender = rooms[roomCode].users[socket.id] || "Unknown";
    const message = { sender, text: msg, color };

    rooms[roomCode].messages.push(message);
    io.to(roomCode).emit("chatMessage", message);
  });

  // Disconnect
  socket.on("disconnect", () => {
    for (const roomCode in rooms) {
      if (rooms[roomCode].users[socket.id]) {
        const name = rooms[roomCode].users[socket.id];
        delete rooms[roomCode].users[socket.id];

        io.to(roomCode).emit("chatMessage", {
          sender: "System",
          text: `${name} left the room.`
        });

        if (Object.keys(rooms[roomCode].users).length === 0 && rooms[roomCode].messages.length === 0) {
          delete rooms[roomCode];
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
