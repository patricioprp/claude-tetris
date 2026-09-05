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
const SKIN_STORAGE_KEY = 'tetris-skin';

// Tabla de skins: cada entrada aporta su paleta (indice 0 = null, 8 = tuerca), sus
// colores de rejilla/brillo por tema y su estilo de dibujo. 'retro' es la linea base.
const SKINS = {
  retro: {
    style: 'retro',
    colors: COLORS,
    grid: GRID_COLORS,
    highlight: HIGHLIGHT_COLORS,
  },
  neon: {
    style: 'neon',
    colors: [
      null,
      '#00e5ff', // I
      '#ffea00', // O
      '#e040fb', // T
      '#00e676', // S
      '#ff1744', // Z
      '#2979ff', // J
      '#ff9100', // L
      '#b0bec5', // Tuerca
    ],
    grid: { dark: 'rgba(0,229,255,0.10)', light: 'rgba(0,229,255,0.16)' },
    highlight: { dark: 'rgba(255,255,255,0.35)', light: 'rgba(255,255,255,0.35)' },
    fill: { dark: 'rgba(6,6,14,0.85)', light: 'rgba(18,18,32,0.80)' },
  },
  pastel: {
    style: 'pastel',
    colors: [
      null,
      '#a8e6e8', // I
      '#ffe9a8', // O
      '#dcc0ea', // T
      '#bfe3c0', // S
      '#f5b8b8', // Z
      '#bcd6f7', // J
      '#ffd7ac', // L
      '#cfd8dc', // Tuerca
    ],
    grid: { dark: '#2a2a3a', light: '#e2e0ec' },
    highlight: { dark: 'rgba(255,255,255,0.45)', light: 'rgba(255,255,255,0.65)' },
  },
  pixel: {
    style: 'pixel',
    colors: [
      null,
      '#2ec4d6', // I
      '#f2c14e', // O
      '#a05fd6', // T
      '#5cb85c', // S
      '#d64545', // Z
      '#3d7fe0', // J
      '#e08b26', // L
      '#8d9aa5', // Tuerca
    ],
    grid: { dark: '#2b2b38', light: '#c6c6b8' },
    highlight: { dark: 'rgba(255,255,255,0.12)', light: 'rgba(255,255,255,0.45)' },
  },
};

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
const skinSelect = document.getElementById('skin-select');

let board, current, next, hold, canHold, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let theme = 'dark';
let skin = 'retro';

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
    level = Math.floor(lines / 10) + 1;
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

// Skin activo, con retro como respaldo si el valor guardado ya no existe.
function activeSkin() {
  return SKINS[skin] || SKINS.retro;
}

// Traza un rectangulo redondeado; usa roundRect si el navegador lo soporta.
function roundRectPath(context, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, w, h, rad);
    return;
  }
  context.moveTo(x + rad, y);
  context.lineTo(x + w - rad, y);
  context.quadraticCurveTo(x + w, y, x + w, y + rad);
  context.lineTo(x + w, y + h - rad);
  context.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  context.lineTo(x + rad, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - rad);
  context.lineTo(x, y + rad);
  context.quadraticCurveTo(x, y, x + rad, y);
  context.closePath();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const sk = activeSkin();
  const color = sk.colors[colorIndex];
  const base = alpha ?? 1;   // el fantasma llega con 0.2: cada skin multiplica sobre este valor
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  context.globalAlpha = base;
  switch (sk.style) {
    case 'neon': {
      // relleno oscuro, contorno del color de la pieza y resplandor con shadowBlur
      context.fillStyle = sk.fill[theme];
      context.fillRect(px, py, s, s);
      context.shadowColor = color;
      context.shadowBlur = Math.max(4, size * 0.35);
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.strokeRect(px + 1, py + 1, s - 2, s - 2);
      context.shadowBlur = 0;
      context.globalAlpha = base * 0.3;
      context.fillStyle = color;
      context.fillRect(px + 4, py + 4, s - 8, s - 8);
      break;
    }
    case 'pastel': {
      // esquinas redondeadas simuladas y brillo suave en la parte superior
      roundRectPath(context, px, py, s, s, size * 0.24);
      context.fillStyle = color;
      context.fill();
      context.globalAlpha = base * 0.8;
      roundRectPath(context, px + 2, py + 2, s - 4, Math.max(3, s * 0.3), size * 0.16);
      context.fillStyle = sk.highlight[theme];
      context.fill();
      break;
    }
    case 'pixel': {
      // bisel de dos tonos mas una trama de puntos, en multiplos de un pixel logico
      const u = Math.max(1, Math.round(size / 10));
      context.fillStyle = color;
      context.fillRect(px, py, s, s);
      context.globalAlpha = base * 0.45;
      context.fillStyle = '#ffffff';
      context.fillRect(px, py, s, u);
      context.fillRect(px, py, u, s);
      for (let i = 1; i < 4; i++) context.fillRect(px + i * u * 2, py + i * u * 2, u, u);
      context.globalAlpha = base * 0.35;
      context.fillStyle = '#000000';
      context.fillRect(px, py + s - u, s, u);
      context.fillRect(px + s - u, py, u, s);
      for (let i = 1; i < 4; i++) context.fillRect(px + s - u - i * u * 2, py + s - u - i * u * 2, u, u);
      break;
    }
    default: {
      context.fillStyle = color;
      context.fillRect(px, py, s, s);
      // highlight
      context.fillStyle = sk.highlight[theme];
      context.fillRect(px, py, s, 4);
    }
  }
  context.shadowBlur = 0;   // imprescindible: si no, el resplandor se filtra a la rejilla y a las previews
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = activeSkin().grid[theme];
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

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
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
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  hold = null;      // reiniciar descarta la pieza reservada
  canHold = true;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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

// El skin es un eje independiente del tema claro/oscuro: ambos se combinan libremente.
function applySkin(s) {
  skin = SKINS[s] ? s : 'retro';
  for (const id of Object.keys(SKINS)) document.body.classList.toggle('skin-' + id, id === skin);
  skinSelect.value = skin;
  if (board) {
    draw();
    drawNext();
    drawHold();
  }
}

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  localStorage.setItem(SKIN_STORAGE_KEY, skin);   // guarda el valor ya validado
  skinSelect.blur();   // sin esto las flechas seguirian cambiando el skin mientras se juega
});

applySkin(localStorage.getItem(SKIN_STORAGE_KEY) || 'retro');

init();
