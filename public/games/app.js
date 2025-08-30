// app.js
const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const playOverlay = document.getElementById("playOverlay");
const playFrame = document.getElementById("playFrame");
const playTitle = document.getElementById("playTitle");
const backBtn = document.getElementById("backBtn");
const openNewTab = document.getElementById("openNewTab");

let games = [];

// Fetch game list
async function fetchGames() {
  try {
    const res = await fetch("/games/list");
    games = await res.json();
    renderGames();
  } catch (e) {
    console.error("Failed to fetch games:", e);
  }
}

// Render game tiles
function renderGames() {
  grid.innerHTML = "";
  const filtered = games.filter(g => g.toLowerCase().includes(searchInput.value.toLowerCase()));
  if (filtered.length === 0) {
    document.getElementById("empty").classList.remove("hidden");
    return;
  }
  document.getElementById("empty").classList.add("hidden");

  filtered.forEach(file => {
    const name = file.replace(/\.html$/, "");
    const tile = document.createElement("div");
    tile.className = "bg-slate-800 rounded-lg p-2 cursor-pointer hover:bg-slate-700 transition flex flex-col items-center";
    
    // Use image inside HTML if present
    const img = document.createElement("img");
    img.src = `/games/game_uploads/${file}`;
    img.alt = name;
    img.className = "w-full h-32 object-cover rounded-lg mb-2";
    
    const title = document.createElement("span");
    title.textContent = name;
    title.className = "font-semibold text-slate-100 text-center";
    
    tile.appendChild(img);
    tile.appendChild(title);
    
    tile.addEventListener("click", () => {
      playTitle.textContent = name;
      playFrame.src = `/games/game_uploads/${file}`;
      playOverlay.classList.remove("hidden");
    });

    grid.appendChild(tile);
  });
}

// Search filter
searchInput.addEventListener("input", renderGames);

// Overlay buttons
backBtn.addEventListener("click", () => {
  playOverlay.classList.add("hidden");
  playFrame.src = "";
});
openNewTab.addEventListener("click", () => {
  window.open(playFrame.src, "_blank");
});

// Initial fetch
fetchGames();
