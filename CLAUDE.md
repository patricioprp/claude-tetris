# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla-JS Tetris: three files (`index.html`, `style.css`, `game.js`), no dependencies, no build step, no tests, no `package.json`. Do not introduce a bundler, framework, or npm tooling unless explicitly asked.

## Running

```bash
start index.html            # Windows — opens directly, works fine (no fetch/modules)
python3 -m http.server 8000 # or any static server, if a server context is needed
```

There is no build, lint, or test command. Verification is manual: open the page and play.

## Architecture

`game.js` is a single IIFE-less top-level script under `'use strict'`, loaded with a plain `<script src>` (no modules). All state lives in module-scope `let` bindings declared in one statement: `board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId`. Functions mutate these directly rather than taking/returning state — keep that style when extending.

Key structures:

- **`board`** — `ROWS × COLS` array of ints. `0` = empty; `1–7` = color index, which doubles as the piece type. `PIECES[type]` and `COLORS[type]` are 1-indexed arrays whose slot `0` is `null`, so index 0 is never a valid piece.
- **`current` / `next`** — `{ type, shape, x, y }`. `shape` is a mutable square matrix filled with the piece's own type number; rotation replaces it via `rotateCW` (transpose + reverse). Pieces are deep-copied out of `PIECES` in `randomPiece()` — never mutate `PIECES` itself.
- **`collide(shape, ox, oy)`** — the single source of truth for legality. Every move, rotation, ghost projection, drop, and the game-over check goes through it. Rows above the board (`ny < 0`) are allowed, so spawning partially off-screen is legal.

Control flow: `init()` → `spawn()` → `requestAnimationFrame(loop)`. `loop` accumulates `dt` into `dropAccum` and steps the piece down once `dropInterval` is exceeded, otherwise calls `lockPiece()` (= `merge` → `clearLines` → `spawn`). Pause and game over both `cancelAnimationFrame(animId)` and show the same `#overlay`; resuming resets `lastTime` before re-entering `loop` to avoid a huge `dt` spike. `restartBtn` re-runs `init()`, which cancels the pending frame before scheduling a new one — preserve that guard to avoid stacking loops.

Input is one `keydown` listener that early-returns on `paused || gameOver` (except `KeyP`) and calls `updateHUD()` at the end of every handled key.

## Constraints when editing

- **Canvas size is duplicated.** `COLS`, `ROWS`, `BLOCK` in `game.js` must match `width`/`height` on `<canvas id="board">` in `index.html` (`COLS*BLOCK` × `ROWS*BLOCK`, currently 300×600). `drawNext` hardcodes a 4×4 preview grid at 30px against the 120×120 `#next-canvas`.
- **Level/speed coupling.** `level = floor(lines / 10) + 1` and `dropInterval = max(100, 1000 - (level - 1) * 90)` are recomputed only inside `clearLines`. `init()` re-seeds `dropInterval = 1000` separately — change both together.
- **Wall kicks** are the simple `[0, -1, 1, -2, 2]` horizontal offsets in `tryRotate`, not SRS. Rotation silently fails if no offset fits.
- **Scoring**: `LINE_SCORES[cleared] * level` on clear, `+2` per cell for hard drop, `+1` per row for soft drop.

## Conventions

- User-facing strings (HTML, overlay text, README, code comments) are in **Spanish**; identifiers are in English. Keep both.
- The palette is defined twice by design: `COLORS` in `game.js` for pieces, dark-theme hex values in `style.css` for chrome. `style.css` uses literal hex, not CSS custom properties.
- All rendering goes through `drawBlock(context, x, y, colorIndex, size, alpha)`, shared by the board, ghost (`alpha` 0.2), and next-piece preview; it also draws the top highlight strip and always resets `globalAlpha` to 1.
