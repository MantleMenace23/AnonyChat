const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const PORT = 3000;
const MAX_USERS_PER_ROOM = 10;
const ROOM_EXPIRY_DAYS = 30;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};
// Structure:
// rooms = {
//   roomCode1: {
//     users: [],
//     lastActive: timestamp,
//     messages: [{name, text}, {name, text}, ...]
//   },
//   ...
// }

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/check/:room', (req, res) => {
    const room = req.params.room;
    if (!rooms[room]) return res.status(404).send("Room does not exist");
    const now = Date.now();
    const lastActive = rooms[room].lastActive;
    const days = (now - lastActive) / (1000 * 60 * 60 * 24);
    if (days > ROOM_EXPIRY_DAYS) {
        delete rooms[room];
        return res.status(410).send("Room expired");
    }
    res.send("Room is valid");
});

io.on('connection', (socket) => {
    socket.on('joinRoom', ({ room, name }) => {
        const now = Date.now();
        if (!rooms[room]) {
            rooms[room] = { users: [], lastActive: now, messages: [] };
        }

        if (rooms[room].users.length >= MAX_USERS_PER_ROOM) {
            socket.emit('full');
            return;
        }

        socket.join(room);
        socket.room = room;
        socket.name = name;
        rooms[room].users.push(socket.id);
        rooms[room].lastActive = now;

        // Send existing messages to the newly joined user
        socket.emit('chatHistory', rooms[room].messages);

        // Broadcast join message
        const joinMsg = { name: "System", text: `🔵 ${name} joined the room` };
        io.to(room).emit('chat', joinMsg);
        rooms[room].messages.push(joinMsg);
    });

    socket.on('chat', (msg) => {
        const room = socket.room;
        const name = socket.name;
        if (room) {
            const message = { name, text: msg };
            rooms[room].lastActive = Date.now();
            rooms[room].messages.push(message);
            io.to(room).emit('chat', message);
        }
    });

    socket.on('disconnect', () => {
        const room = socket.room;
        const name = socket.name;
        if (room && rooms[room]) {
            rooms[room].users = rooms[room].users.filter(id => id !== socket.id);
            const leaveMsg = { name: "System", text: `🔴 ${name} left the room` };
            io.to(room).emit('chat', leaveMsg);
            rooms[room].messages.push(leaveMsg);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
