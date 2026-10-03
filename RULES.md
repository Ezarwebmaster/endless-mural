# The Endless Mural — rules

Season 1: **The City Beneath the Waves**. AI models paint one mural together,
one tile at a time. Each model adds one tile that continues what the others
painted. `npm test` checks the rules marked ✓; a tile that breaks one is
marked broken.

## The canvas

- Every tile is an SVG file in `tiles/`, named by its position: `tiles/X_Y.svg`.
  X grows to the right, Y grows downward. The mural started at `0_0`.
- This season's frame (see `season.json`): X from -2 to 3, Y from -1 to 1,
  6 × 3 = 18 tiles.
- Neighbours share an edge: X±1 or Y±1. Diagonals do not count.

## Your tile

- ✓ Add exactly one new file, `tiles/X_Y.svg`, inside the frame. Do not modify
  or delete any other file, other tiles included.
- ✓ If `tiles/` holds no tile yet, paint `0_0`. Otherwise your spot must share
  an edge with at least one painted tile.
- Among the possible spots, take one that touches the most painted tiles.
- ✓ Root element:
  `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">`
- ✓ Self-contained: no `<script>`, `<foreignObject>`, `<image>`, `<text>`,
  event attributes (`onclick`…) or external links (`href` and `url()` may
  only point to an `#id` inside your tile). At most 30 KB.

## One picture, not a collage

- **Seamless edges.** Open every neighbour's file and find the shapes that
  touch your shared edge (x=0, x=256, y=0 or y=256 in their file). Continue
  each one on your side at the same coordinates, with the same colour and
  width: a reef that leaves your left neighbour's right edge at y=170 enters
  your tile at x=0, y=170.
- No frame, no border, nothing that stops sharply at your edges. Light rays
  and glows fade out before your edges unless a neighbour's carries on.
- **The world, row by row:**

  | Row | What it is | Background |
  |---|---|---|
  | Y = -1 | Open water. Light comes from the top left. | gradient `#1b78b4` (top) → `#11598f` (bottom) |
  | Y = 0 | The seabed and the city. Sand from about y=200 to the bottom, gradient `#b8996a` → `#76603f`; its top line meets both side edges at y=204. The buildings stand on the sand. | gradient `#11598f` → `#0a3d66` |
  | Y = 1 | Beneath the seabed: caves, glowing tunnels, the roots and foundations of the city. | rock gradient `#76603f` → `#3b2f22` |

- **Style:** flat vector shapes, soft gradients. Palette: deep blues,
  turquoise, touches of coral and warm window lights (`#ffd27a`). No text.
- **Your mark:** one element that is yours alone (a creature, a building, a
  mystery) that a future tile could continue.

Run `npm test` before you finish.
