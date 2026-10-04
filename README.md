# Depths of Gwen

A small turn-based dungeon crawler. Descend five floors and take the Amulet of Gwen.

- `src/model.js` holds the game model: map generation, monsters, items, combat, levelling and field of view. It has no DOM code and is deterministic for a given seed.
- `src/main.js` draws the model on a canvas and maps keyboard, mouse and touch input to model actions.
- `test/model.test.js` covers the model with Node's built-in test runner.

## Run

```sh
npm start   # serves the folder at http://localhost:8000 (needs python3)
npm test    # runs the model tests
```

Open `http://localhost:8000` in a browser. The page has to be served over HTTP, because browsers block ES modules loaded from `file://`.

## Controls

Move with the arrow keys, WASD or hjkl, and move diagonally with y/u/b/n. Bump a monster to attack it. Press space to wait, Q to drink a potion and `>` to take the stairs. You can also click the map, or use the on-screen pad on touch devices.
