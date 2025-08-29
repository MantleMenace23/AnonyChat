const socket = io.connect(window.location.origin);

const loginDiv = document.getElementById("login");
const chatDiv = document.getElementById("chat");
const joinBtn = document.getElementById("joinBtn");
const sendBtn = document.getElementById("sendBtn");
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const messageInput = document.getElementById("messageInput");
const chatBox = document.getElementById("chatBox");
const roomTitle = document.getElementById("roomTitle");

let roomCode = "";
let name = "";

// Join button
joinBtn.addEventListener("click", joinRoom);
function joinRoom() {
  name = nameInput.value.trim();
  roomCode = roomInput.value.trim();
  if (!name || !roomCode) return;

  socket.emit("joinRoom", { roomCode, name });

  loginDiv.classList.add("hidden");
  chatDiv.classList.remove("hidden");
  roomTitle.textContent = `Room: ${roomCode}`;
  messageInput.focus(); // focus input immediately
}

// Send button
sendBtn.addEventListener("click", sendMessage);
function sendMessage() {
  const msg = messageInput.value.trim();
  if (!msg) return;

  socket.emit("chatMessage", { roomCode, msg });
  messageInput.value = "";
  messageInput.focus(); // keep focus after sending
}

// Enter key behavior
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});
roomInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinRoom();
});

// Receive chat history
socket.on("chatHistory", (messages) => {
  chatBox.innerHTML = "";
  messages.forEach((message) => addMessage(message.sender, message.text));
});

// Receive new message
socket.on("chatMessage", (message) => addMessage(message.sender, message.text));

// Add message to chat box
function addMessage(sender, text) {
  const div = document.createElement("div");
  div.classList.add("message");
  div.innerHTML = `<span class="sender">${sender}:</span> ${text}`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  messageInput.focus(); // keep focus on input
}
