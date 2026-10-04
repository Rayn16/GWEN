import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, TILE, MAX_DEPTH, createRng, distance } from '../src/model.js';

/** Breadth-first search over walkable tiles from the player's cell. */
function reachable(game) {
  const seen = new Set([`${game.player.x},${game.player.y}`]);
  const queue = [[game.player.x, game.player.y]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const key = `${x + dx},${y + dy}`;
      if (!seen.has(key) && game.isWalkable(x + dx, y + dy)) { seen.add(key); queue.push([x + dx, y + dy]); }
    }
  }
  return seen;
}

function findTile(game, tile) {
  for (let y = 0; y < game.height; y++) for (let x = 0; x < game.width; x++) if (game.tiles[y][x] === tile) return { x, y };
  return null;
}

/** Clear the level of monsters and items so a test controls everything. */
function emptyLevel(game) { game.monsters = []; game.items = []; }

test('the rng is deterministic for a seed', () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const r = createRng(7);
  for (let i = 0; i < 500; i++) { const n = r.int(-1, 1); assert.ok(n >= -1 && n <= 1); }
});

test('the same seed generates the same dungeon', () => {
  const a = new Game({ seed: 1234 }), b = new Game({ seed: 1234 });
  assert.deepEqual(a.tiles, b.tiles);
  assert.deepEqual(a.monsters, b.monsters);
  assert.deepEqual(a.items, b.items);
});

test('every floor 1-4 has reachable stairs and nothing spawns in walls', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const game = new Game({ seed });
    for (let depth = 1; depth < MAX_DEPTH; depth++) {
      const stairs = findTile(game, TILE.STAIRS);
      assert.ok(stairs, `seed ${seed} depth ${depth} has stairs`);
      assert.ok(reachable(game).has(`${stairs.x},${stairs.y}`), `seed ${seed} depth ${depth} stairs reachable`);
      for (const thing of [...game.monsters, ...game.items]) assert.ok(game.isWalkable(thing.x, thing.y));
      game.descend();
    }
    const amulet = game.items.find((i) => i.kind === 'amulet');
    assert.ok(amulet, `seed ${seed} has the amulet on the last floor`);
    assert.ok(reachable(game).has(`${amulet.x},${amulet.y}`));
  }
});

test('walking into a wall does not spend a turn', () => {
  const game = new Game({ seed: 5 });
  emptyLevel(game);
  const { x, y } = game.player;
  game.tiles[y][x + 1] = TILE.WALL;
  assert.equal(game.act({ type: 'move', dx: 1, dy: 0 }), false);
  assert.equal(game.turn, 0);
  assert.deepEqual([game.player.x, game.player.y], [x, y]);
});

test('bumping a monster attacks it and killing it grants xp', () => {
  const game = new Game({ seed: 9 });
  emptyLevel(game);
  const { x, y } = game.player;
  game.tiles[y][x + 1] = TILE.FLOOR;
  game.monsters.push({ name: 'rat', glyph: 'r', hp: 1, maxHp: 1, atk: 0, def: 0, xp: 3, x: x + 1, y, awake: true });
  assert.equal(game.act({ type: 'move', dx: 1, dy: 0 }), true);
  assert.equal(game.monsters.length, 0);
  assert.equal(game.player.xp, 3);
  assert.equal(game.kills, 1);
  assert.deepEqual([game.player.x, game.player.y], [x, y], 'attacking does not move you');
});

test('awake monsters close in and attack', () => {
  const game = new Game({ seed: 11 });
  emptyLevel(game);
  const { x, y } = game.player;
  for (let i = 1; i <= 3; i++) game.tiles[y][x + i] = TILE.FLOOR;
  game.monsters.push({ name: 'goblin', hp: 50, maxHp: 50, atk: 3, def: 0, xp: 0, x: x + 3, y, awake: true });
  game.act({ type: 'wait' });
  assert.equal(distance(game.monsters[0].x, game.monsters[0].y, x, y), 2);
  game.act({ type: 'wait' });
  const hpBefore = game.player.hp;
  game.act({ type: 'wait' });
  assert.ok(game.player.hp < hpBefore, 'adjacent monster dealt damage');
});

test('dying ends the game and rejects further actions', () => {
  const game = new Game({ seed: 3 });
  emptyLevel(game);
  const { x, y } = game.player;
  game.tiles[y][x + 1] = TILE.FLOOR;
  game.player.hp = 1;
  game.monsters.push({ name: 'troll', hp: 99, maxHp: 99, atk: 50, def: 0, xp: 0, x: x + 1, y, awake: true });
  game.act({ type: 'wait' });
  assert.equal(game.status, 'dead');
  assert.equal(game.act({ type: 'wait' }), false);
});

test('potions heal and are consumed', () => {
  const game = new Game({ seed: 4 });
  emptyLevel(game);
  assert.equal(game.act({ type: 'quaff' }), false, 'no drinking at full health');
  game.player.hp = 5;
  assert.equal(game.act({ type: 'quaff' }), true);
  assert.equal(game.player.hp, 15);
  assert.equal(game.player.potions, 0);
  game.player.hp = 5;
  assert.equal(game.act({ type: 'quaff' }), false, 'no potions left');
});

test('items are picked up by walking over them', () => {
  const game = new Game({ seed: 8 });
  emptyLevel(game);
  const { x, y } = game.player;
  game.tiles[y][x + 1] = TILE.FLOOR;
  game.tiles[y][x + 2] = TILE.FLOOR;
  game.items.push({ kind: 'sword', x: x + 1, y }, { kind: 'potion', x: x + 2, y });
  const atk = game.player.atk;
  game.act({ type: 'move', dx: 1, dy: 0 });
  game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(game.player.atk, atk + 1);
  assert.equal(game.player.potions, 2);
  assert.equal(game.items.length, 0);
});

test('levelling up raises stats and can chain', () => {
  const game = new Game({ seed: 2 });
  const before = { ...game.player };
  game.gainXp(10 + 16);
  assert.equal(game.player.level, 3);
  assert.equal(game.player.maxHp, before.maxHp + 10);
  assert.equal(game.player.atk, before.atk + 2);
  assert.equal(game.player.def, before.def + 1);
  assert.equal(game.player.xp, 0);
});

test('stairs take you down; taking the amulet wins', () => {
  const game = new Game({ seed: 21 });
  assert.equal(game.act({ type: 'descend' }), false, 'no stairs under you at the start');
  while (game.depth < MAX_DEPTH) {
    const stairs = findTile(game, TILE.STAIRS);
    game.player.x = stairs.x; game.player.y = stairs.y;
    emptyLevel(game);
    assert.equal(game.act({ type: 'descend' }), true);
  }
  emptyLevel(game);
  const { x, y } = game.player;
  game.tiles[y][x + 1] = TILE.FLOOR;
  game.items.push({ kind: 'amulet', x: x + 1, y });
  game.act({ type: 'move', dx: 1, dy: 0 });
  assert.equal(game.status, 'won');
});

test('walls block sight', () => {
  const game = new Game({ seed: 6 });
  const { x, y } = game.player;
  assert.equal(game.visible[y][x], true);
  for (let row = 0; row < game.height; row++) for (let col = 0; col < game.width; col++) {
    if (!game.visible[row][col]) continue;
    assert.ok(Math.hypot(col - x, row - y) <= 8.5);
  }
  // Fully enclose the player: only the ring of walls should be visible.
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) game.tiles[y + dy][x + dx] = TILE.WALL;
  game.computeFov();
  const count = game.visible.flat().filter(Boolean).length;
  assert.equal(count, 9);
});
