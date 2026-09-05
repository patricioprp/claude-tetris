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
const RECORDS_STORAGE_KEY = 'tetris-records';
const MAX_RECORDS = 5;
const NAME_MAX_LENGTH = 8;   // debe coincidir con maxlength de #player-name
const DEFAULT_NAME = 'ANON';

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
const recordsPanel = document.getElementById('records-panel');
const recordsList = document.getElementById('records-list');
const recordsCombo = document.getElementById('records-combo');
const recordsMaxLines = document.getElementById('records-maxlines');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('player-name');
const saveScoreBtn = document.getElementById('save-score-btn');
const startScreen = document.getElementById('start-screen');
const startRecordsList = document.getElementById('start-records-list');
const startCombo = document.getElementById('start-combo');
const startMaxLines = document.getElementById('start-maxlines');
const playBtn = document.getElementById('play-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');

let board, current, next, hold, canHold, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let theme = 'dark';
let combo, bestComboRun, records, pendingEntry, pendingRun;

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
  return cleared;
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
  // Combo: sube con cada bloqueo que limpia lineas y se corta al bloquear sin limpiar.
  if (clearLines() > 0) {
    combo++;
    if (combo > bestComboRun) bestComboRun = combo;
  } else {
    combo = 0;
  }
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

// ---- Tabla de records local ----

function emptyRecords() {
  return { scores: [], bestCombo: 0, maxLines: 0 };
}

// Normaliza una entrada leida de localStorage; el contenido guardado no es de fiar.
function normalizeEntry(entry) {
  return {
    name: typeof entry.name === 'string' && entry.name.trim()
      ? entry.name.trim().slice(0, NAME_MAX_LENGTH)
      : DEFAULT_NAME,
    score: Number(entry.score) || 0,
    lines: Number(entry.lines) || 0,
    level: Number(entry.level) || 1,
  };
}

// Todo acceso a localStorage va en try/catch: en modo privado puede lanzar.
function loadRecords() {
  records = emptyRecords();
  let raw = null;
  try {
    raw = localStorage.getItem(RECORDS_STORAGE_KEY);
  } catch (err) {
    return;   // sin almacenamiento: se juega solo en memoria
  }
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (Array.isArray(parsed.scores)) {
      records.scores = parsed.scores
        .filter(entry => entry && typeof entry === 'object')
        .map(normalizeEntry)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RECORDS);
    }
    records.bestCombo = Number(parsed.bestCombo) || 0;
    records.maxLines = Number(parsed.maxLines) || 0;
  } catch (err) {
    records = emptyRecords();   // JSON corrupto: se descarta
  }
}

function saveRecords() {
  records.scores.sort((a, b) => b.score - a.score);
  records.scores = records.scores.slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    // Almacenamiento bloqueado o lleno: los records viven solo en esta sesion.
  }
}

function qualifiesForTop(value) {
  if (value <= 0) return false;
  return records.scores.length < MAX_RECORDS
    || value > records.scores[records.scores.length - 1].score;
}

// highlightIndex = -1 cuando no hay fila que destacar.
function renderRecords(listEl, comboEl, maxLinesEl, highlightIndex) {
  listEl.textContent = '';
  if (!records.scores.length) {
    const empty = document.createElement('li');
    empty.className = 'records-empty';
    empty.textContent = 'Todavía no hay records';
    listEl.appendChild(empty);
  } else {
    records.scores.forEach((entry, i) => {
      const row = document.createElement('li');
      if (i === highlightIndex) row.classList.add('current');
      const name = document.createElement('span');
      name.className = 'record-name';
      name.textContent = entry.name;   // nombre del jugador: siempre textContent, nunca innerHTML
      const value = document.createElement('span');
      value.className = 'record-score';
      value.textContent = `${entry.score.toLocaleString()} · ${entry.lines} L`;
      row.append(name, value);
      listEl.appendChild(row);
    });
  }
  comboEl.textContent = records.bestCombo;
  maxLinesEl.textContent = records.maxLines;
}

// Persiste los maximos de la partida (combo pico y total de lineas).
function registerRunStats(run) {
  let changed = false;
  if (run.combo > records.bestCombo) {
    records.bestCombo = run.combo;
    changed = true;
  }
  if (run.lines > records.maxLines) {
    records.maxLines = run.lines;
    changed = true;
  }
  if (changed) saveRecords();
}

function saveCurrentScore() {
  if (!pendingEntry || !pendingRun) return;   // evita guardar dos veces la misma partida
  pendingEntry = false;
  // #player-name se muestra en mayusculas por CSS: se guarda igual que se ve.
  const typed = nameInput.value.trim().slice(0, NAME_MAX_LENGTH).toUpperCase();
  const entry = {
    name: typed || DEFAULT_NAME,
    score: pendingRun.score,
    lines: pendingRun.lines,
    level: pendingRun.level,
  };
  records.scores.push(entry);
  saveRecords();   // ordena y recorta al top 5
  nameEntry.classList.add('hidden');
  renderRecords(recordsList, recordsCombo, recordsMaxLines, records.scores.indexOf(entry));
}

function showStartScreen() {
  renderRecords(startRecordsList, startCombo, startMaxLines, -1);
  startScreen.classList.remove('hidden');
}

nameInput.addEventListener('keydown', e => {
  e.stopPropagation();   // el input no debe disparar los controles del juego
  if (e.key === 'Enter') {
    e.preventDefault();
    saveCurrentScore();
  }
});

saveScoreBtn.addEventListener('click', saveCurrentScore);

playBtn.addEventListener('click', () => {
  startScreen.classList.add('hidden');
  init();
});

resetRecordsBtn.addEventListener('click', () => {
  if (!window.confirm('¿Seguro que quieres borrar todos los records?')) return;
  records = emptyRecords();
  saveRecords();
  renderRecords(startRecordsList, startCombo, startMaxLines, -1);
});

function endGame() {
  if (gameOver) return;   // el bucle puede volver a entrar tras el ultimo bloqueo
  gameOver = true;
  cancelAnimationFrame(animId);
  // Instantanea de la partida: lo que se muestra y se guarda no debe moverse despues.
  pendingRun = { score, lines, level, combo: bestComboRun };
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${pendingRun.score.toLocaleString()} · Mejor combo: ${pendingRun.combo}`;
  registerRunStats(pendingRun);
  pendingEntry = qualifiesForTop(pendingRun.score);
  if (pendingEntry) {
    nameInput.value = DEFAULT_NAME;
    nameEntry.classList.remove('hidden');
  } else {
    nameEntry.classList.add('hidden');
  }
  renderRecords(recordsList, recordsCombo, recordsMaxLines, -1);
  recordsPanel.classList.remove('hidden');
  overlay.classList.remove('hidden');
  if (pendingEntry) nameInput.select();
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
  if (pendingEntry) saveCurrentScore();   // reiniciar no debe tirar un record recien logrado
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  combo = 0;
  bestComboRun = 0;
  pendingEntry = false;
  pendingRun = null;
  lastTime = performance.now();
  hold = null;      // reiniciar descarta la pieza reservada
  canHold = true;
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  recordsPanel.classList.add('hidden');
  nameEntry.classList.add('hidden');
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

// El juego no arranca hasta pulsar Jugar; gameOver neutraliza el teclado mientras tanto.
gameOver = true;
paused = false;
combo = 0;
bestComboRun = 0;
pendingEntry = false;
pendingRun = null;
loadRecords();
showStartScreen();

applyTheme(localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark');
