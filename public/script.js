const socket = io();
const params = new URLSearchParams(location.search);
const room = params.get("room");
const name = params.get("name");

document.getElementById('roomName').innerText = `Room: ${room}`;

if (!room || !name) {
    alert("Missing room or name");
    location.href = "/";
}

socket.emit('joinRoom', { room, name });

socket.on('full', () => {
    alert("Room is full.");
    location.href = "/";
});

// Load chat history
socket.on('chatHistory', (messages) => {
    const chatbox = document.getElementById("chatbox");
    chatbox.innerHTML = ''; // Clear existing
    messages.forEach(data => {
        addMessage(data);
    });
    chatbox.scrollTop = chatbox.scrollHeight;
});

socket.on('chat', (data) => {
    addMessage(data);
});

function addMessage(data) {
    const chatbox = document.getElementById("chatbox");
    const bubble = document.createElement("div");
    bubble.className = data.name === name ? "bubble me" : "bubble";
    bubble.innerHTML = `<strong>${data.name}:</strong> ${data.text}`;
    chatbox.appendChild(bubble);
    chatbox.scrollTop = chatbox.scrollHeight;
}

function send() {
    const input = document.getElementById("msg");
    const text = input.value.trim();
    if (text) {
        socket.emit('chat', text);
        input.value = "";
    }
}

// Add Enter key to send message
document.getElementById('msg').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        send();
    }
});
