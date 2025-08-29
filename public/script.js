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
    chatbox.innerHTML = '';
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

    if (data.type === "text") {
        bubble.innerHTML = `<strong>${data.name}:</strong> ${data.text}`;
    } else if (data.type === "file") {
        let content = `<strong>${data.name}:</strong> `;
        if (data.file.mime.startsWith("image/")) {
            content += `<br><img src="${data.file.url}" alt="${data.file.name}" style="max-width:200px; max-height:200px;">`;
        }
        content += `<br><a href="${data.file.url}" target="_blank">${data.file.name}</a> (${humanSize(data.file.size)})`;
        bubble.innerHTML = content;
    }

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

function sendFile(file) {
    const formData = new FormData();
    formData.append("file", file);

    fetch("/upload", {
        method: "POST",
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        socket.emit('file', data);
    })
    .catch(err => {
        alert("Upload failed: " + err.message);
    });
}

// Add Enter key to send message
document.getElementById('msg').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        send();
    }
});

// Handle file input
document.getElementById('fileInput').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (file) {
        sendFile(file);
        e.target.value = ""; // reset input
    }
});

function humanSize(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) {
        bytes /= 1024;
        i++;
    }
    return `${bytes.toFixed(1)} ${units[i]}`;
}
