const grid = document.getElementById("grid");
const emptyMsg = document.getElementById("empty");
const playOverlay = document.getElementById("playOverlay");
const playFrame = document.getElementById("playFrame");
const playTitle = document.getElementById("playTitle");
const backBtn = document.getElementById("backBtn");
const openNewTab = document.getElementById("openNewTab");
const searchInput = document.getElementById("search");

let allGames = [];

// Fetch all game HTML files from the uploads folder
async function loadGames() {
  try {
    const res = await fetch("/games/game_uploads/");
    const files = await res.json();

    const htmlFiles = files.filter(f => f.endsWith(".html"));

    if (!htmlFiles.length) {
      emptyMsg.classList.remove("hidden");
      return;
    }

    const gameData = await Promise.all(
      htmlFiles.map(async file => {
        const html = await fetch(`/games/game_uploads/${file}`).then(r => r.text());
        const doc = new DOMParser().parseFromString(html, "text/html");
        const name = doc.querySelector("meta[name='game-name']")?.content || "Unnamed Game";
        const cover = doc.querySelector("meta[name='game-cover']")?.content || "";
        return { file, name, cover };
      })
    );

    allGames = gameData;
    renderGames(allGames);

  } catch (err) {
    console.error(err);
  }
}

// Render the game tiles
function renderGames(games) {
  grid.innerHTML = "";
  if (!games.length) {
    emptyMsg.classList.remove("hidden");
    return;
  }
  emptyMsg.classList.add("hidden");

  games.forEach(game => {
    const gameTile = document.createElement("div");
    gameTile.className = "bg-slate-800 rounded-lg overflow-hidden shadow-lg cursor-pointer hover:scale-105 transition transform";
    gameTile.innerHTML = `
      ${game.cover ? `<img src="${game.cover}" class="w-full h-40 object-cover">` : ''}
      <div class="p-2">
        <h3 class="font-semibold text-lg text-white">${game.name}</h3>
      </div>
    `;
    gameTile.addEventListener("click", () => {
      playTitle.textContent = game.name;
      playFrame.src = `/games/game_uploads/${game.file}`;
      playOverlay.classList.remove("hidden");
    });
    grid.appendChild(gameTile);
  });
}

// Search filtering
searchInput.addEventListener("input", () => {
  const term = searchInput.value.toLowerCase();
  const filtered = allGames.filter(g => g.name.toLowerCase().includes(term));
  renderGames(filtered);
});

// Close overlay
backBtn.addEventListener("click", () => {
  playOverlay.classList.add("hidden");
  playFrame.src = "";
});
openNewTab.addEventListener("click", () => {
  window.open(playFrame.src, "_blank");
});

loadGames();
