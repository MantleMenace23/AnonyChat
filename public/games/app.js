const ADMIN_CODE = import.meta.env?.VITE_ADMIN_CODE || ''; // or set in environment

// DOM references
const grid = document.getElementById('grid');
const searchInput = document.getElementById('search');

const playOverlay = document.getElementById('playOverlay');
const playFrame = document.getElementById('playFrame');
const playTitle = document.getElementById('playTitle');
const backBtn = document.getElementById('backBtn');
const openNewTab = document.getElementById('openNewTab');

const adminModal = document.getElementById('adminModal');
const openAdminBtn = document.getElementById('open-admin');
const closeAdminBtn = document.getElementById('closeAdmin');
const adminLoginView = document.getElementById('adminLoginView');
const adminView = document.getElementById('adminView');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const adminCodeInput = document.getElementById('adminCode');
const loginMsg = document.getElementById('loginMsg');

const gameNameInput = document.getElementById('gameName');
const coverFileInput = document.getElementById('coverFile');
const coverUrlInput = document.getElementById('coverUrl');
const gameHtmlInput = document.getElementById('gameHtml');
const addGameBtn = document.getElementById('addGameBtn');
const clearFormBtn = document.getElementById('clearForm');

const reorderArea = document.getElementById('reorderArea');
const enableDragBtn = document.getElementById('enableDrag');
const saveOrderBtn = document.getElementById('saveOrder');
const enterRemoveBtn = document.getElementById('enterRemove');

const emptyMsg = document.getElementById('empty');

// Game storage
let games = [];
let dragEnabled = false;
let removeMode = false;

// ---------- RENDERING ----------

function renderGames(filter='') {
  grid.innerHTML = '';
  const filtered = games.filter(g => g.name.toLowerCase().includes(filter.toLowerCase()));
  if(filtered.length === 0) emptyMsg.classList.remove('hidden');
  else emptyMsg.classList.add('hidden');

  filtered.forEach((game, i) => {
    const tile = document.createElement('div');
    tile.classList.add('game-tile');
    tile.innerHTML = `
      <img src="${game.cover}" alt="${game.name}">
      <h3 class="text-center mt-2 font-semibold">${game.name}</h3>
    `;
    tile.addEventListener('click', () => {
      if(removeMode) { removeGame(i); return; }
      playGame(game);
    });
    grid.appendChild(tile);
  });
}

function playGame(game) {
  playTitle.textContent = game.name;
  playFrame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(game.html);
  playOverlay.classList.remove('hidden');
}

backBtn.addEventListener('click', () => {
  playOverlay.classList.add('hidden');
  playFrame.src = '';
});

openNewTab.addEventListener('click', () => {
  const game = games.find(g => g.name === playTitle.textContent);
  if(game) {
    const w = window.open();
    w.document.write(game.html);
    w.document.close();
  }
});

searchInput.addEventListener('input', () => {
  renderGames(searchInput.value);
});

// ---------- ADMIN PANEL ----------

openAdminBtn.addEventListener('click', () => adminModal.classList.remove('hidden'));
closeAdminBtn.addEventListener('click', () => adminModal.classList.add('hidden'));

adminLoginBtn.addEventListener('click', () => {
  if(adminCodeInput.value === ADMIN_CODE) {
    adminLoginView.classList.add('hidden');
    adminView.classList.remove('hidden');
    loginMsg.classList.add('hidden');
  } else {
    loginMsg.textContent = 'Incorrect code';
    loginMsg.classList.remove('hidden');
  }
});

// ---------- ADD / REMOVE / REORDER ----------

addGameBtn.addEventListener('click', () => {
  const name = gameNameInput.value.trim();
  const html = gameHtmlInput.value.trim();
  let cover = coverUrlInput.value.trim();

  if(coverFileInput.files.length > 0) {
    // In real host, upload file & get URL
    cover = URL.createObjectURL(coverFileInput.files[0]);
  }
  if(!name || !html) return alert('Name & HTML required');

  games.push({ name, html, cover });
  renderGames();
  renderReorder();
});

clearFormBtn.addEventListener('click', () => {
  gameNameInput.value='';
  gameHtmlInput.value='';
  coverFileInput.value='';
  coverUrlInput.value='';
});

function removeGame(i){
  if(!confirm(`Remove ${games[i].name}?`)) return;
  games.splice(i,1);
  renderGames();
  renderReorder();
}

function renderReorder(){
  reorderArea.innerHTML='';
  games.forEach((game,i)=>{
    const div = document.createElement('div');
    div.classList.add('flex','items-center','gap-2','p-1','bg-slate-800','rounded');
    div.innerHTML = `<img src="${game.cover}" alt=""><span>${game.name}</span>`;
    div.dataset.index=i;
    if(dragEnabled) {
      div.draggable=true;
      div.addEventListener('dragstart', dragStart);
      div.addEventListener('dragover', dragOver);
      div.addEventListener('drop', dropItem);
    }
    reorderArea.appendChild(div);
  });
}

enableDragBtn.addEventListener('click', () => {
  dragEnabled = !dragEnabled;
  reorderArea.querySelectorAll('div').forEach(d => {
    d.draggable = dragEnabled;
  });
});

saveOrderBtn.addEventListener('click', () => {
  const newOrder = [];
  reorderArea.querySelectorAll('div').forEach(d => newOrder.push(games[d.dataset.index]));
  games = newOrder;
  renderGames();
});

enterRemoveBtn.addEventListener('click', () => {
  removeMode = !removeMode;
  enterRemoveBtn.textContent = removeMode ? 'Remove Mode ON' : 'Remove Mode';
});

// ---------- DRAG & DROP ----------
let draggedIndex = null;
function dragStart(e){ draggedIndex = e.target.dataset.index; }
function dragOver(e){ e.preventDefault(); }
function dropItem(e){
  const targetIndex = e.target.dataset.index;
  if(draggedIndex===null || targetIndex===undefined) return;
  [games[draggedIndex], games[targetIndex]] = [games[targetIndex], games[draggedIndex]];
  draggedIndex=null;
  renderGames();
  renderReorder();
}

// ---------- INITIAL ----------
renderGames();
renderReorder();
