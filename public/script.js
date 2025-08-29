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
joinBtn.addEventListener("click", () => {
  name = nameInput.value.trim();
  roomCode = roomInput.value.trim();
  if (!name || !roomCode) return;

  socket.emit("joinRoom", { roomCode, name });

  loginDiv.classList.add("hidden");
  chatDiv.classList.remove("hidden");
  roomTitle.textContent = `Room: ${roomCode}`;
});

// Send message
sendBtn.addEventListener("click", () => {
  const msg = messageInput.value.trim();
  if (!msg) return;

  socket.emit("chatMessage", { roomCode, msg });
  messageInput.value = "";
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
}
