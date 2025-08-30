// =======================
// Chat variables & DOM
// =======================
const socket = io();

const chatBox = document.getElementById("chatBox");
const input = document.getElementById("msg");
const form = document.getElementById("composerForm");
const fileInput = document.getElementById("fileInput");
const uploadOverlay = document.getElementById("uploadOverlay");
const uploadStatus = document.getElementById("uploadStatus");
const uploadProgress = document.getElementById("uploadProgress");
const cancelUploadBtn = document.getElementById("cancelUploadBtn");
const leaveBtn = document.getElementById("leaveBtn");
const presenceList = document.getElementById("presenceList");
const meta = document.getElementById("meta");
const roomTitle = document.getElementById("roomTitle");

// =======================
// User Setup
// =======================
let userName = prompt("Enter your name:") || "Anonymous";
socket.emit("join", userName);

// =======================
// Send Message
// =======================
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  socket.emit("send-message", { sender: userName, message });
  input.value = "";
});

// =======================
// Receive Messages
// =======================
socket.on("receive-message", ({ sender, message }) => {
  const msgDiv = document.createElement("div");
  msgDiv.classList.add("message");
  msgDiv.innerHTML = `<span class="sender">${sender}:</span> ${message}`;
  chatBox.appendChild(msgDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
});

// =======================
// User join/leave
// =======================
socket.on("user-joined", (name) => {
  const notice = document.createElement("div");
  notice.classList.add("message");
  notice.innerHTML = `<em>${name} joined the chat</em>`;
  chatBox.appendChild(notice);
  chatBox.scrollTop = chatBox.scrollHeight;
  updatePresence(name, true);
});

socket.on("user-left", (name) => {
  const notice = document.createElement("div");
  notice.classList.add("message");
  notice.innerHTML = `<em>${name} left the chat</em>`;
  chatBox.appendChild(notice);
  chatBox.scrollTop = chatBox.scrollHeight;
  updatePresence(name, false);
});

// =======================
// Presence / Users List
// =======================
let users = [];

function updatePresence(name, joined) {
  if (joined) {
    users.push(name);
  } else {
    users = users.filter(u => u !== name);
  }
  renderPresence();
}

function renderPresence() {
  presenceList.innerHTML = "";
  users.forEach(u => {
    const div = document.createElement("div");
    div.textContent = u;
    presenceList.appendChild(div);
  });
}

// =======================
// Leave Room
// =======================
leaveBtn.addEventListener("click", () => {
  socket.disconnect();
  chatBox.innerHTML += `<div class="message"><em>You left the chat</em></div>`;
});

// =======================
// File upload (optional)
// =======================
fileInput.addEventListener("change", () => {
  if (fileInput.files.length === 0) return;
  const file = fileInput.files[0];
  uploadOverlay.classList.remove("hidden");
  uploadStatus.textContent = `Uploading ${file.name}...`;
  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    uploadProgress.value = progress;
    if (progress >= 100) {
      clearInterval(interval);
      uploadStatus.textContent = "Upload complete!";
      setTimeout(() => {
        uploadOverlay.classList.add("hidden");
        uploadProgress.value = 0;
        fileInput.value = "";
      }, 500);
    }
  }, 100);
});
