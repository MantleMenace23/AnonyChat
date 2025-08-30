const socket = io();

const loginDiv = document.getElementById("login");
const chatDiv = document.getElementById("chat");
const joinBtn = document.getElementById("joinBtn");
const sendBtn = document.getElementById("sendBtn");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const messageInput = document.getElementById("messageInput");
const chatBox = document.getElementById("chatBox");
const roomTitle = document.getElementById("roomTitle");
const fileInput = document.getElementById("fileInput");
const sendFileBtn = document.getElementById("sendFileBtn");
const colorSelect = document.getElementById("colorSelect");

let roomCode = "";
let name = "";
let textColor = colorSelect.value;

// Disable autocomplete
[nameInput, roomInput, messageInput].forEach(input => input.setAttribute("autocomplete", "off"));

// Join room
joinBtn.addEventListener("click", joinRoom);
function joinRoom() {
  name = nameInput.value.trim();
  roomCode = roomInput.value.trim();
  if (!name || !roomCode) return;

  socket.emit("joinRoom", { roomCode, name });

  loginDiv.classList.add("hidden");
  chatDiv.classList.remove("hidden");
  roomTitle.textContent = `Room: ${roomCode}`;
  messageInput.focus();
}

// Send chat message
sendBtn.addEventListener("click", sendMessage);
function sendMessage() {
  const msg = messageInput.value.trim();
  if (!msg) return;

  socket.emit("chatMessage", { roomCode, msg, color: textColor });
  messageInput.value = "";
  messageInput.focus();
}

// Send file
sendFileBtn.addEventListener("click", async () => {
  if (!fileInput.files.length) return;

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/upload", { method: "POST", body: formData });
  const data = await res.json();

  socket.emit("chatMessage", { roomCode, msg: data.url, color: textColor });
  fileInput.value = "";
});

// Change text color
colorSelect.addEventListener("change", () => { textColor = colorSelect.value; });

// Enter key handling
messageInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });
roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });
nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") joinRoom(); });

// Receive chat history
socket.on("chatHistory", (messages) => {
  chatBox.innerHTML = "";
  messages.forEach((message) => addMessage(message.sender, message.text, message.color));
});

// Receive new messages
socket.on("chatMessage", (message) => addMessage(message.sender, message.text, message.color));

// Add message
function addMessage(sender, text, color) {
  const div = document.createElement("div");
  div.classList.add("message");
  const appliedColor = color || "#ffcc00";

  if (text.match(/\.(jpeg|jpg|gif|png|webp)$/i)) {
    div.innerHTML = `<span class="sender">${sender}:</span><br><img src="${text}" style="max-width:100%; border-radius:8px;">`;
  } else {
    div.innerHTML = `<span class="sender">${sender}:</span> <span style="color:${appliedColor}">${text}</span>`;
  }

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  messageInput.focus();
}
