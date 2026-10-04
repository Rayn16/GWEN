// Browser front end for Depths of Gwen: draws the model on a canvas and
// turns keys, clicks and taps into model actions. All rules live in model.js.

import { Game, TILE, MAX_DEPTH, FOV_RADIUS } from './model.js';

const CELL_W = 18;
const CELL_H = 22;

const KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0],
  y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
  Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1],
};

const $ = (id) => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');
const css = getComputedStyle(document.documentElement);
const color = (name) => css.getPropertyValue(name).trim();
const palette = {
  stone: color('--stone'), stoneLit: color('--stone-lit'), floor: color('--floor'),
  torch: color('--torch'), ink: color('--ink'), dim: color('--dim'), ground: color('--ground'),
};
const glyphFont = `600 ${CELL_H * 0.78}px ${css.getPropertyValue('--font-mono').trim()}`;

let game;
let actions = []; // every accepted action, so the game can be replayed from its seed

function start({ seed, replay = [] } = {}) {
  game = new Game({ seed });
  actions = [];
  for (const action of replay) perform(action, false);
  canvas.width = game.width * CELL_W * devicePixelRatio;
  canvas.height = game.height * CELL_H * devicePixelRatio;
  canvas.style.aspectRatio = `${game.width * CELL_W} / ${game.height * CELL_H}`;
  render();
}

function perform(action, draw = true) {
  if (game.act(action)) actions.push(action);
  if (draw) render();
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

function render() {
  drawBoard();
  drawPanel();
  drawLog();
  drawOverlay();
}

function drawBoard() {
  const dpr = devicePixelRatio;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, 0, game.width * CELL_W, game.height * CELL_H);
  ctx.font = glyphFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const { x: px, y: py } = game.player;
  for (let y = 0; y < game.height; y++) {
    for (let x = 0; x < game.width; x++) {
      if (!game.seen[y][x]) continue;
      const lit = game.visible[y][x];
      // Torchlight: full brightness at your feet, fading toward the edge of sight.
      const light = lit ? 1 - 0.55 * Math.min(1, Math.hypot(x - px, y - py) / (FOV_RADIUS + 1)) : 0.28;
      const tile = game.tiles[y][x];
      const cx = x * CELL_W, cy = y * CELL_H;
      ctx.globalAlpha = light;
      if (tile === TILE.WALL) {
        ctx.fillStyle = lit ? palette.stoneLit : palette.stone;
        ctx.fillRect(cx, cy, CELL_W, CELL_H);
      } else {
        ctx.fillStyle = palette.floor;
        ctx.fillRect(cx, cy, CELL_W, CELL_H);
        ctx.fillStyle = tile === TILE.STAIRS ? palette.torch : palette.dim;
        ctx.fillText(tile === TILE.STAIRS ? '>' : '·', cx + CELL_W / 2, cy + CELL_H / 2 + 1);
      }
    }
  }

  ctx.globalAlpha = 1;
  for (const item of game.items) {
    if (game.visible[item.y][item.x]) glyph(item.glyph, item.color, item.x, item.y);
  }
  for (const m of game.monsters) {
    if (!game.visible[m.y][m.x]) continue;
    glyph(m.glyph, m.color, m.x, m.y);
    if (m.hp < m.maxHp) {
      ctx.fillStyle = palette.ground;
      ctx.fillRect(m.x * CELL_W + 2, m.y * CELL_H + CELL_H - 3, CELL_W - 4, 2);
      ctx.fillStyle = color('--blood');
      ctx.fillRect(m.x * CELL_W + 2, m.y * CELL_H + CELL_H - 3, (CELL_W - 4) * (m.hp / m.maxHp), 2);
    }
  }
  glyph('@', palette.torch, px, py);
}

function glyph(ch, fill, x, y) {
  ctx.fillStyle = fill;
  ctx.fillText(ch, x * CELL_W + CELL_W / 2, y * CELL_H + CELL_H / 2 + 1);
}

function drawPanel() {
  const p = game.player;
  $('depth').textContent = `${game.depth} / ${MAX_DEPTH}`;
  $('hp-text').textContent = `${p.hp} / ${p.maxHp}`;
  $('hp-fill').style.width = `${Math.max(0, (p.hp / p.maxHp) * 100)}%`;
  $('hp-fill').dataset.low = String(p.hp <= p.maxHp * 0.3);
  $('xp-text').textContent = `${p.xp} / ${p.nextXp}`;
  $('xp-fill').style.width = `${(p.xp / p.nextXp) * 100}%`;
  $('level').textContent = p.level;
  $('atk').textContent = p.atk;
  $('def').textContent = p.def;
  $('potions').textContent = p.potions;
  $('turn').textContent = game.turn;
  $('kills').textContent = game.kills;
  $('seed').textContent = game.seed;
  $('quaff').disabled = p.potions === 0 || p.hp >= p.maxHp || game.status !== 'playing';
  $('descend').disabled = game.tileAt(p.x, p.y) !== TILE.STAIRS || game.status !== 'playing';
}

function drawLog() {
  const list = $('log');
  list.replaceChildren(...game.log.slice(-7).map((entry) => {
    const li = document.createElement('li');
    li.textContent = entry.text;
    li.dataset.kind = entry.kind;
    li.dataset.fresh = String(entry.turn >= game.turn - 1);
    return li;
  }));
}

function drawOverlay() {
  const over = $('overlay');
  over.hidden = game.status === 'playing';
  if (over.hidden) return;
  const won = game.status === 'won';
  $('overlay-title').textContent = won ? 'The amulet is yours' : 'You have fallen';
  $('overlay-body').textContent = won
    ? `You escaped the depths in ${game.turn} turns at level ${game.player.level}, with ${game.kills} foes behind you.`
    : `${game.log.at(-1).text} You reached level ${game.player.level} after ${game.turn} turns.`;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (game.status !== 'playing') {
    if (key === 'r' || key === 'Enter') { start(); e.preventDefault(); }
    return;
  }
  if (KEYS[key]) perform({ type: 'move', dx: KEYS[key][0], dy: KEYS[key][1] });
  else if (key === '.' || key === ' ' || key === '5') perform({ type: 'wait' });
  else if (e.key === '>') perform({ type: 'descend' });
  else if (key === 'q') perform({ type: 'quaff' });
  else return;
  e.preventDefault();
});

// Click or tap the board: step one cell toward that spot.
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * game.width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * game.height);
  const dx = Math.sign(x - game.player.x), dy = Math.sign(y - game.player.y);
  if (dx || dy) perform({ type: 'move', dx, dy });
  else if (game.tileAt(x, y) === TILE.STAIRS) perform({ type: 'descend' });
  else perform({ type: 'wait' });
});

for (const button of document.querySelectorAll('[data-dir]')) {
  button.addEventListener('click', () => {
    const [dx, dy] = button.dataset.dir.split(',').map(Number);
    perform(dx || dy ? { type: 'move', dx, dy } : { type: 'wait' });
  });
}
$('quaff').addEventListener('click', () => perform({ type: 'quaff' }));
$('descend').addEventListener('click', () => perform({ type: 'descend' }));
$('restart').addEventListener('click', () => start());
$('new-game').addEventListener('click', () => start());

// Keep the current run alive when the page is updated in place.
window.claude?.hot?.snapshot?.(() => ({ seed: game.seed, replay: actions }));
const boot = (data) => start(data && data.seed !== undefined ? data : {});
if (document.fonts?.ready) document.fonts.ready.then(() => (window.claude?.hot?.ready ? window.claude.hot.ready(boot) : boot(window.claude?.hot?.data ?? {})));
else boot({});
