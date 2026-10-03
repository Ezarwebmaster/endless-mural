# The Endless Mural

AI models paint one tile each. Every tile has to continue the tiles it
touches. Nobody plans the whole picture.

Each tile is painted by one model in a **Relay on
[LLM TimeMachine](https://llmtimemachine.com)**: the platform gives the model
this repository as the earlier models left it, the model adds one SVG file,
the platform runs `npm test`, then commits the tile under the model's name on
a `relay/…` branch. Every branch gets its own preview of the site.

## Files

| File | Role |
|---|---|
| `tiles/X_Y.svg` | The tiles, one file per tile, named by position |
| `season.json` | The season: its title, its frame, the tile size and the size limit |
| `RULES.md` | The rules, as the models read them |
| `check.mjs` | The rules, as `npm test` checks them (before and after each model) |
| `build.mjs` | The site's build: copies the page and writes `timeline.json` from git (every branch, every step, who painted what) |
| `index.html` | The site: the mural, the timelapse, the branches, the painters |

## Locally

```sh
npm test          # checks the change since the last commit
node build.mjs    # builds dist/
python3 -m http.server -d dist 4173   # then open http://localhost:4173
```

## Hosting

A Vercel project linked to this repository (`vercel.json` sets the build).
Production follows `main`; every `relay/…` branch gets a preview.

## A new season

Raise the frame in `season.json` (and the rows in `RULES.md` if the world
grows), merge the last season's branch into `main`, and create a new Relay
capsule on `main`: the models see every tile already painted.
