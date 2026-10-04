// Game model for "Depths of Gwen", a small turn-based dungeon crawler.
//
// This module holds every rule of the game and nothing about rendering or
// input. It never touches the DOM, so it runs the same in a browser and in
// Node (see test/model.test.js). Given the same seed and the same actions,
// a game always plays out identically.

export const TILE = Object.freeze({ WALL: '#', FLOOR: '.', STAIRS: '>' });

export const MAX_DEPTH = 5;
export const FOV_RADIUS = 8;
export const LOG_LIMIT = 50;
export const REGEN_EVERY = 12; // turns per 1 HP of natural healing

export const MONSTERS = Object.freeze({
  rat:      { name: 'rat',      glyph: 'r', color: '#c9b79c', hp: 4,  atk: 2, def: 0, xp: 2,  minDepth: 1 },
  goblin:   { name: 'goblin',   glyph: 'g', color: '#8fcf5f', hp: 7,  atk: 3, def: 1, xp: 5,  minDepth: 1 },
  skeleton: { name: 'skeleton', glyph: 's', color: '#e6e1d3', hp: 10, atk: 4, def: 2, xp: 8,  minDepth: 2 },
  orc:      { name: 'orc',      glyph: 'o', color: '#d9824a', hp: 14, atk: 5, def: 2, xp: 12, minDepth: 3 },
  troll:    { name: 'troll',    glyph: 'T', color: '#6fb3a8', hp: 22, atk: 7, def: 3, xp: 25, minDepth: 4 },
});

export const ITEMS = Object.freeze({
  potion: { name: 'healing potion',  glyph: '!', color: '#e0566b', heal: 10 },
  sword:  { name: 'whetstone',       glyph: '/', color: '#9ec3e6', atk: 1 },
  shield: { name: 'iron buckler',    glyph: ']', color: '#b8a6d9', def: 1 },
  amulet: { name: 'Amulet of Gwen',  glyph: '"', color: '#f2c14e' },
});

// ---------------------------------------------------------------------------
// Seeded random numbers (mulberry32)
// ---------------------------------------------------------------------------

export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [min, max], both inclusive. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Chebyshev distance: the number of 8-way steps between two cells. */
export const distance = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

const roomCenter = (r) => ({ x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) });

const roomsOverlap = (a, b, margin) =>
  a.x - margin < b.x + b.w && b.x - margin < a.x + a.w &&
  a.y - margin < b.y + b.h && b.y - margin < a.y + a.h;

/** Cells on the straight line from (x0,y0) to (x1,y1), endpoints included. */
export function line(x0, y0, x1, y1) {
  const cells = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cells.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------------------------------------------------------------------------
// Level generation: rectangular rooms joined by L-shaped corridors
// ---------------------------------------------------------------------------

export function generateLevel(rng, width, height) {
  for (;;) {
    const tiles = Array.from({ length: height }, () => Array(width).fill(TILE.WALL));
    const rooms = [];
    for (let attempt = 0; attempt < 80 && rooms.length < 9; attempt++) {
      const w = rng.int(4, 9);
      const h = rng.int(3, 6);
      const room = { x: rng.int(1, width - w - 1), y: rng.int(1, height - h - 1), w, h };
      if (rooms.some((r) => roomsOverlap(r, room, 1))) continue;
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) tiles[y][x] = TILE.FLOOR;
      }
      if (rooms.length) carveCorridor(tiles, roomCenter(rooms[rooms.length - 1]), roomCenter(room), rng);
      rooms.push(room);
    }
    if (rooms.length >= 3) return { tiles, rooms };
  }
}

function carveCorridor(tiles, a, b, rng) {
  const horizontalFirst = rng.chance(0.5);
  const corner = horizontalFirst ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  for (const [from, to] of [[a, corner], [corner, b]]) {
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) tiles[from.y][x] = TILE.FLOOR;
    for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++) tiles[y][to.x] = TILE.FLOOR;
  }
}

// ---------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------

export class Game {
  constructor({ seed = (Math.random() * 2 ** 32) >>> 0, width = 40, height = 22 } = {}) {
    this.seed = seed >>> 0;
    this.rng = createRng(this.seed);
    this.width = width;
    this.height = height;
    this.turn = 0;
    this.depth = 0;
    this.status = 'playing'; // 'playing' | 'dead' | 'won'
    this.log = [];
    this.kills = 0;
    this.player = {
      name: 'you', glyph: '@', x: 0, y: 0,
      hp: 20, maxHp: 20, atk: 4, def: 1,
      level: 1, xp: 0, nextXp: 10, potions: 1,
    };
    this.descend();
    this.say('You enter the Depths of Gwen. Find the amulet on floor 5.', 'info');
  }

  // ----- queries --------------------------------------------------------

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  tileAt(x, y) { return this.inBounds(x, y) ? this.tiles[y][x] : TILE.WALL; }
  isWalkable(x, y) { return this.tileAt(x, y) !== TILE.WALL; }
  monsterAt(x, y) { return this.monsters.find((m) => m.x === x && m.y === y); }
  itemAt(x, y) { return this.items.find((i) => i.x === x && i.y === y); }
  isOccupied(x, y) {
    return (this.player.x === x && this.player.y === y) || Boolean(this.monsterAt(x, y));
  }

  say(text, kind = 'info') {
    this.log.push({ text, kind, turn: this.turn });
    if (this.log.length > LOG_LIMIT) this.log.shift();
  }

  // ----- the one entry point for player input ----------------------------

  /**
   * Apply one player action. Returns true if it used up a turn (and the
   * monsters then got to act), false if it was rejected.
   *
   * Actions: { type: 'move', dx, dy } | { type: 'wait' } |
   *          { type: 'descend' }     | { type: 'quaff' }
   */
  act(action) {
    if (this.status !== 'playing') return false;
    let spent = false;
    switch (action.type) {
      case 'move': spent = this.playerMove(action.dx, action.dy); break;
      case 'wait': spent = true; break;
      case 'descend': spent = this.playerDescend(); break;
      case 'quaff': spent = this.playerQuaff(); break;
      default: throw new Error(`Unknown action: ${action.type}`);
    }
    if (!spent) return false;
    this.endTurn();
    return true;
  }

  // ----- player actions -------------------------------------------------

  playerMove(dx, dy) {
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) return false;
    const p = this.player;
    const x = p.x + dx, y = p.y + dy;
    const target = this.monsterAt(x, y);
    if (target) { this.attack(p, target); return true; }
    if (!this.isWalkable(x, y)) return false;
    p.x = x; p.y = y;
    this.pickUp();
    if (this.tileAt(x, y) === TILE.STAIRS) this.say('Stairs lead down. Press > to descend.', 'hint');
    return true;
  }

  playerDescend() {
    if (this.tileAt(this.player.x, this.player.y) !== TILE.STAIRS) {
      this.say('There are no stairs here.', 'hint');
      return false;
    }
    this.descend();
    return true;
  }

  playerQuaff() {
    const p = this.player;
    if (p.potions <= 0) { this.say('You have no potions.', 'hint'); return false; }
    if (p.hp >= p.maxHp) { this.say('You are already at full health.', 'hint'); return false; }
    p.potions--;
    const healed = Math.min(ITEMS.potion.heal, p.maxHp - p.hp);
    p.hp += healed;
    this.say(`You drink a potion and recover ${healed} HP.`, 'good');
    return true;
  }

  pickUp() {
    const p = this.player;
    const item = this.itemAt(p.x, p.y);
    if (!item) return;
    this.items = this.items.filter((i) => i !== item);
    switch (item.kind) {
      case 'potion': p.potions++; this.say('You pick up a healing potion.', 'good'); break;
      case 'sword': p.atk += ITEMS.sword.atk; this.say(`You hone your blade. Attack is now ${p.atk}.`, 'good'); break;
      case 'shield': p.def += ITEMS.shield.def; this.say(`You strap on a buckler. Defense is now ${p.def}.`, 'good'); break;
      case 'amulet':
        this.status = 'won';
        this.say('You lift the Amulet of Gwen. The depths fall silent. You win!', 'win');
        break;
    }
  }

  // ----- combat ---------------------------------------------------------

  attack(attacker, defender) {
    const damage = Math.max(1, attacker.atk - defender.def + this.rng.int(-1, 1));
    defender.hp -= damage;
    const isPlayer = attacker === this.player;
    if (isPlayer) this.say(`You hit the ${defender.name} for ${damage}.`, 'hit');
    else this.say(`The ${attacker.name} hits you for ${damage}.`, 'hurt');
    if (defender.hp > 0) return;
    if (defender === this.player) {
      this.status = 'dead';
      this.say(`You were slain by a ${attacker.name} on floor ${this.depth}.`, 'death');
    } else {
      this.monsters = this.monsters.filter((m) => m !== defender);
      this.kills++;
      this.say(`The ${defender.name} dies.`, 'kill');
      this.gainXp(defender.xp);
    }
  }

  gainXp(amount) {
    const p = this.player;
    p.xp += amount;
    while (p.xp >= p.nextXp) {
      p.xp -= p.nextXp;
      p.level++;
      p.nextXp = Math.floor(p.nextXp * 1.6);
      p.maxHp += 5;
      p.hp = Math.min(p.maxHp, p.hp + 5);
      p.atk += 1;
      if (p.level % 2 === 1) p.def += 1;
      this.say(`You reach level ${p.level}.`, 'level');
    }
  }

  // ----- turn loop ------------------------------------------------------

  endTurn() {
    if (this.status === 'playing') this.monstersAct();
    this.turn++;
    const p = this.player;
    if (this.status === 'playing' && this.turn % REGEN_EVERY === 0 && p.hp < p.maxHp) p.hp++;
    this.computeFov();
  }

  monstersAct() {
    const p = this.player;
    for (const m of [...this.monsters]) {
      if (this.status !== 'playing') return;
      const d = distance(m.x, m.y, p.x, p.y);
      if (d === 1) { this.attack(m, p); continue; }
      if (this.visible[m.y][m.x]) m.awake = true;
      if (!m.awake) continue;
      this.stepToward(m, p.x, p.y);
    }
  }

  stepToward(m, tx, ty) {
    let best = null;
    let bestScore = distance(m.x, m.y, tx, ty) * 100;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = m.x + dx, y = m.y + dy;
        if ((dx === 0 && dy === 0) || !this.isWalkable(x, y) || this.isOccupied(x, y)) continue;
        // Prefer fewer steps, then the straighter line, so chases look natural.
        const score = distance(x, y, tx, ty) * 100 + Math.hypot(x - tx, y - ty);
        if (score < bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    if (best) { m.x = best.x; m.y = best.y; }
  }

  // ----- levels ---------------------------------------------------------

  descend() {
    this.depth++;
    const { tiles, rooms } = generateLevel(this.rng, this.width, this.height);
    this.tiles = tiles;
    this.rooms = rooms;
    this.monsters = [];
    this.items = [];
    this.seen = tiles.map((row) => row.map(() => false));

    const start = roomCenter(rooms[0]);
    this.player.x = start.x;
    this.player.y = start.y;

    const last = roomCenter(rooms[rooms.length - 1]);
    if (this.depth < MAX_DEPTH) this.tiles[last.y][last.x] = TILE.STAIRS;
    else this.items.push({ kind: 'amulet', ...ITEMS.amulet, x: last.x, y: last.y });

    const roster = Object.values(MONSTERS).filter((t) => t.minDepth <= this.depth);
    for (const room of rooms.slice(1)) {
      const count = this.rng.int(0, 1 + Math.floor(this.depth / 2));
      for (let i = 0; i < count; i++) {
        const spot = this.freeSpotIn(room);
        if (!spot) continue;
        const type = this.rng.pick(roster);
        this.monsters.push({ ...type, maxHp: type.hp, ...spot, awake: false });
      }
      if (this.rng.chance(0.45)) {
        const spot = this.freeSpotIn(room);
        const kind = this.rng.chance(0.6) ? 'potion' : this.rng.pick(['sword', 'shield']);
        if (spot) this.items.push({ kind, ...ITEMS[kind], ...spot });
      }
    }

    if (this.depth > 1) {
      this.say(this.depth === MAX_DEPTH
        ? `Floor ${this.depth}. The amulet glints somewhere nearby.`
        : `You descend to floor ${this.depth}.`, 'info');
    }
    this.computeFov();
  }

  freeSpotIn(room) {
    for (let tries = 0; tries < 20; tries++) {
      const x = this.rng.int(room.x, room.x + room.w - 1);
      const y = this.rng.int(room.y, room.y + room.h - 1);
      if (this.tiles[y][x] === TILE.FLOOR && !this.isOccupied(x, y) && !this.itemAt(x, y)) return { x, y };
    }
    return null;
  }

  // ----- field of view --------------------------------------------------

  computeFov() {
    const { x: px, y: py } = this.player;
    this.visible = this.tiles.map((row) => row.map(() => false));
    for (let y = py - FOV_RADIUS; y <= py + FOV_RADIUS; y++) {
      for (let x = px - FOV_RADIUS; x <= px + FOV_RADIUS; x++) {
        if (!this.inBounds(x, y) || Math.hypot(x - px, y - py) > FOV_RADIUS + 0.5) continue;
        const path = line(px, py, x, y);
        // Every cell before the target must be open; the target itself may be a wall.
        if (path.slice(1, -1).every(([cx, cy]) => this.tiles[cy][cx] !== TILE.WALL)) {
          this.visible[y][x] = true;
          this.seen[y][x] = true;
        }
      }
    }
  }
}
