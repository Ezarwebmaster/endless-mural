#!/usr/bin/env node
// The rules of the mural, run by `npm test`. LLM TimeMachine runs the
// project's tests before and after every model, so a tile that breaks a rule is
// marked broken there. These are exactly the rules of RULES.md, no more: one
// new tile, inside the season's frame, touching the mural, a self-contained
// 256 × 256 SVG without text. The build (build.mjs) uses the same functions to
// tell, commit by commit, which tiles kept to the rules.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const TILE_RE = /^tiles\/(-?\d+)_(-?\d+)\.svg$/
export const parseTile = (path) => {
  const m = path.match(TILE_RE)
  return m ? [Number(m[1]), Number(m[2])] : null
}
export const tileKey = ([x, y]) => `${x}_${y}`
const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]]

// What the change does to the mural. `changes`: [{ path, status: 'A'|'M'|'D' }]
// since the last commit; `painted`: the tiles already there, as [x, y].
export function changeProblems({ changes, painted, season }) {
  if (!changes.length) return []
  if (changes.length > 1) {
    return [`Change exactly one file. This change touches ${changes.length}: ${changes.map(c => c.path).slice(0, 6).join(', ')}${changes.length > 6 ? ', …' : ''}.`]
  }
  const [c] = changes
  if (c.status !== 'A') return [`Add a new tile; do not ${c.status === 'D' ? 'delete' : 'modify'} ${c.path}.`]
  const tile = parseTile(c.path)
  if (!tile) return [`The new file must be tiles/X_Y.svg, with X and Y whole numbers. Got ${c.path}.`]
  const { x0, x1, y0, y1 } = season.frame
  const [x, y] = tile
  if (x < x0 || x > x1 || y < y0 || y > y1) {
    return [`${tileKey(tile)} is outside this season's frame: X from ${x0} to ${x1}, Y from ${y0} to ${y1}.`]
  }
  const taken = new Set(painted.map(tileKey))
  if (!taken.size) return tileKey(tile) === '0_0' ? [] : [`The first tile of the mural is 0_0, not ${tileKey(tile)}.`]
  if (!NEIGHBOURS.some(([dx, dy]) => taken.has(tileKey([x + dx, y + dy])))) {
    return [`${tileKey(tile)} does not touch the mural: it must share an edge with a painted tile (X±1 or Y±1).`]
  }
  return []
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`))
  return m ? (m[2] ?? m[3]) : null
}

// What is wrong with the SVG itself: the root element, what it may not contain,
// its size, and whether its tags are balanced.
export function svgProblems(svg, season) {
  const out = []
  const bytes = Buffer.byteLength(svg, 'utf8')
  if (bytes > season.maxBytes) out.push(`The tile weighs ${(bytes / 1024).toFixed(1)} KB; the limit is ${season.maxBytes / 1024} KB.`)
  if (/<!DOCTYPE|<!ENTITY/i.test(svg)) out.push('No DOCTYPE or ENTITY declarations.')
  const body = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '')

  const rootTag = body.match(/^\s*<svg\b[^>]*>/)
  if (!rootTag) return [...out, 'The file must start with the <svg> element (an XML declaration and comments are allowed before it).']
  const t = rootTag[0]
  const s = season.tileSize
  if (attr(t, 'xmlns') !== 'http://www.w3.org/2000/svg') out.push('The <svg> element needs xmlns="http://www.w3.org/2000/svg".')
  if (attr(t, 'width') !== String(s) || attr(t, 'height') !== String(s)) out.push(`The <svg> element needs width="${s}" and height="${s}".`)
  const vb = (attr(t, 'viewBox') || '').trim().split(/[\s,]+/).map(Number)
  if (vb.length !== 4 || vb[0] !== 0 || vb[1] !== 0 || vb[2] !== s || vb[3] !== s) out.push(`The <svg> element needs viewBox="0 0 ${s} ${s}".`)

  const banned = [...new Set([...body.matchAll(/<(script|foreignObject|image|text|tspan|textPath|iframe|audio|video)\b/gi)].map(m => m[1]))]
  if (banned.length) out.push(`Not allowed in a tile: ${banned.map(b => `<${b}>`).join(', ')}.`)
  const events = [...new Set([...body.matchAll(/<[^>]*\s(on[a-z]+)\s*=/gi)].map(m => m[1].toLowerCase()))]
  if (events.length) out.push(`No event attributes (${events.join(', ')}).`)
  const links = [...body.matchAll(/\s(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi)].map(m => (m[2] ?? m[3]).trim()).filter(h => !h.startsWith('#'))
  const urls = [...body.matchAll(/url\(\s*['"]?([^'")\s]*)/gi)].map(m => m[1]).filter(u => !u.startsWith('#'))
  if (links.length || urls.length || /@import/i.test(body)) out.push(`No external links: href and url() may only point inside the tile (#id). Found: ${[...links, ...urls].slice(0, 3).join(', ') || '@import'}.`)

  // Balanced tags, one root, nothing after it.
  const stack = []
  let roots = 0
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = m
    if (closing) {
      if (stack.pop() !== name) { out.push(`The tags are not balanced near </${name}>.`); return out }
    } else if (!selfClosing) {
      if (!stack.length) roots++
      stack.push(name)
    } else if (!stack.length) roots++
  }
  if (stack.length) out.push(`<${stack.at(-1)}> is never closed.`)
  else if (roots !== 1) out.push('The file must hold a single <svg> element.')
  else if (!/<\/svg>\s*$/.test(body)) out.push('Nothing may follow the closing </svg>.')
  return out
}

// --- npm test --------------------------------------------------------------------

function main() {
  const season = JSON.parse(readFileSync('season.json', 'utf8'))
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
  // Everything changed since the last commit: staged, unstaged and new files.
  const changes = new Map()
  for (const line of git('diff', 'HEAD', '--name-status', '--no-renames').split('\n').filter(Boolean)) {
    const [status, ...path] = line.split('\t')
    changes.set(path.join('\t'), status[0])
  }
  for (const path of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) changes.set(path, 'A')
  const painted = git('ls-tree', '--name-only', 'HEAD', 'tiles/').split('\n').map(parseTile).filter(Boolean)
  const list = [...changes].map(([path, status]) => ({ path, status }))

  const problems = changeProblems({ changes: list, painted, season })
  if (!problems.length && list.length === 1) problems.push(...svgProblems(readFileSync(list[0].path, 'utf8'), season))

  if (!list.length) {
    console.log(`✓ Nothing to check yet: no tile added (${painted.length} painted).`)
  } else if (!problems.length) {
    console.log(`✓ ${list[0].path} keeps to the rules: a new tile, inside the frame, touching the mural, a clean ${season.tileSize}×${season.tileSize} SVG.`)
  } else {
    console.error('✗ The tile breaks the mural rules (see RULES.md):')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
