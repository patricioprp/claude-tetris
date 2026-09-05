'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - azul palido
  '#ffb74d', // L - orange
  '#90a4ae', // Tuerca - gris metalico
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // Tuerca - hueco en el centro
];

const NUT_TYPE = 8;
const NUT_CHANCE = 0.10; // la tuerca es una pieza rara de reto

const LINE_SCORES = [0, 100, 300, 500, 800];

const GRID_COLORS = { dark: '#22222e', light: '#c8c8d8' };
const HIGHLIGHT_COLORS = { dark: 'rgba(255,255,255,0.12)', light: 'rgba(255,255,255,0.45)' };
const THEME_STORAGE_KEY = 'tetris-theme';

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const holdSection = document.getElementById('hold-section');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');

let board, current, next, hold, canHold, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let startLevel, baseLevel, menuOpen;   // preferencia de nivel, nivel base de la partida en curso y estado del menu
let theme = 'dark';

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

// Construye una pieza a partir de un tipo dado; copia profunda para no mutar PIECES.
function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  return makePiece(Math.random() < NUT_CHANCE ? NUT_TYPE : Math.floor(Math.random() * 7) + 1);
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = baseLevel + Math.floor(lines / 10);   // parte del nivel inicial elegido en el menu
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

// Reserva: guarda la pieza activa o la intercambia con la ya reservada. Solo 1 uso por turno.
function holdPiece() {
  if (!canHold) return;
  const stashed = hold;
  hold = current.type;
  if (stashed === null) {
    spawn();                      // bucket vacio: la activa se guarda y entra la del Next
  } else {
    current = makePiece(stashed); // intercambio: vuelve sin rotacion y centrada
    if (collide(current.shape, current.x, current.y)) endGame();
  }
  canHold = false;                // spawn() lo pone en true, por eso se bloquea DESPUES
  drawHold();
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  canHold = true;   // cada pieza nueva rehabilita la reserva
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
  drawHold();       // refresca el atenuado del panel
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = HIGHLIGHT_COLORS[theme];
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = GRID_COLORS[theme];
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

// Rejilla de vista previa 4x4 compartida por NEXT y HOLD; shape null = lienzo limpio.
function drawPreview(context, canvasEl, shape) {
  const PB = 30;
  context.clearRect(0, 0, canvasEl.width, canvasEl.height);
  if (!shape) return;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(context, offX + c, offY + r, shape[r][c], PB);
}

function drawNext() {
  drawPreview(nextCtx, nextCanvas, next.shape);
}

function drawHold() {
  // drawPreview solo lee la matriz, por eso es seguro pasar PIECES[hold] sin copiar.
  drawPreview(holdCtx, holdCanvas, hold ? PIECES[hold] : null);
  holdSection.classList.toggle('locked', !canHold);   // atenua el panel si esta bloqueado
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

// ---- Menu de pausa ----
const START_LEVEL_STORAGE_KEY = 'tetris-start-level';
const pauseOverlay = document.getElementById('pause-overlay');
const resumeBtn = document.getElementById('resume-btn');
const menuRestartBtn = document.getElementById('menu-restart-btn');
const toggleControlsBtn = document.getElementById('toggle-controls-btn');
const pauseControls = document.getElementById('pause-controls');
const startLevelSelect = document.getElementById('start-level');
const MAX_START_LEVEL = startLevelSelect.options.length;   // el rango lo define el <select> de index.html

// Nivel inicial guardado; cualquier valor ausente o fuera de rango cae a 1.
function loadStartLevel() {
  const stored = parseInt(localStorage.getItem(START_LEVEL_STORAGE_KEY), 10);
  return stored >= 1 && stored <= MAX_START_LEVEL ? stored : 1;
}

function openMenu() {
  menuOpen = true;
  startLevelSelect.value = String(startLevel);
  pauseControls.classList.add('hidden');              // el menu siempre abre con los controles plegados
  toggleControlsBtn.textContent = 'Ver controles';
  pauseOverlay.classList.remove('hidden');
}

function closeMenu() {
  menuOpen = false;
  pauseOverlay.classList.add('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    closeMenu();
    lastTime = performance.now();   // sin esto el primer dt tras reanudar seria enorme
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    openMenu();
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  baseLevel = startLevel;   // congelado al empezar: cambiar la preferencia no altera la partida en curso
  level = baseLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (baseLevel - 1) * 90);   // misma formula que clearLines
  dropAccum = 0;
  lastTime = performance.now();
  hold = null;      // reiniciar descarta la pieza reservada
  canHold = true;
  next = randomPiece();
  spawn();
  updateHUD();
  closeMenu();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (paused || menuOpen || gameOver) return;   // con el menu abierto ninguna tecla mueve la pieza
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
    case 'KeyC':
    case 'ShiftLeft':
    case 'ShiftRight':
      holdPiece();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

resumeBtn.addEventListener('click', () => togglePause());
menuRestartBtn.addEventListener('click', () => init());   // init() cierra el menu y reengancha el bucle

toggleControlsBtn.addEventListener('click', () => {
  const hidden = pauseControls.classList.toggle('hidden');
  toggleControlsBtn.textContent = hidden ? 'Ver controles' : 'Ocultar controles';
});

startLevelSelect.addEventListener('change', () => {
  const value = Math.min(MAX_START_LEVEL, Math.max(1, parseInt(startLevelSelect.value, 10) || 1));
  startLevel = value;
  startLevelSelect.value = String(value);
  localStorage.setItem(START_LEVEL_STORAGE_KEY, String(value));   // se aplica en la proxima partida
});

function applyTheme(t) {
  theme = t;
  document.body.classList.toggle('light', theme === 'light');
  themeToggle.checked = theme === 'light';
  if (board) {
    draw();
    drawNext();
    drawHold();
  }
}

themeToggle.addEventListener('change', () => {
  const t = themeToggle.checked ? 'light' : 'dark';
  localStorage.setItem(THEME_STORAGE_KEY, t);
  applyTheme(t);
});

applyTheme(localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark');

startLevel = loadStartLevel();   // se lee una sola vez; despues manda el valor en memoria

init();
