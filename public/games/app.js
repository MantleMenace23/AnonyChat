const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const playOverlay = document.getElementById("playOverlay");
const playFrame = document.getElementById("playFrame");
const playTitle = document.getElementById("playTitle");
const backBtn = document.getElementById("backBtn");
const openNewTab = document.getElementById("openNewTab");

// Load games
async function loadGames() {
  try {
    const res = await fetch("/games/list");
    const games = await res.json();

    grid.innerHTML = "";
    if (!games.length) {
      document.getElementById("empty").classList.remove("hidden");
      return;
    } else {
      document.getElementById("empty").classList.add("hidden");
    }

    games.forEach(file => {
      const name = file.replace(".html", "");
      const tile = document.createElement("div");
      tile.className = "bg-slate-900 p-4 rounded-lg shadow hover:shadow-lg cursor-pointer flex flex-col items-center gap-2";
      const img = document.createElement("img");
      img.src = `/games/game_uploads/${file}#logo`; // Anchor to logo inside HTML (optional)
      img.alt = name;
      img.className = "w-full h-32 object-cover rounded";
      const title = document.createElement("div");
      title.textContent = name;
      title.className = "text-center font-semibold";

      tile.appendChild(img);
      tile.appendChild(title);

      tile.addEventListener("click", () => openGame(file, name));

      grid.appendChild(tile);
    });

  } catch (err) {
    console.error("Failed to load games:", err);
  }
}

// Open game overlay
function openGame(file, name) {
  playOverlay.classList.remove("hidden");
  playFrame.src = `/games/game_uploads/${file}`;
  playTitle.textContent = name;
  openNewTab.onclick = () => window.open(`/games/game_uploads/${file}`, "_blank");
}

// Close overlay
backBtn.onclick = () => {
  playOverlay.classList.add("hidden");
  playFrame.src = "";
};

// Search functionality
searchInput.addEventListener("input", () => {
  const term = searchInput.value.toLowerCase();
  Array.from(grid.children).forEach(tile => {
    const title = tile.querySelector("div").textContent.toLowerCase();
    tile.style.display = title.includes(term) ? "flex" : "none";
  });
});

// Initial load
loadGames();
