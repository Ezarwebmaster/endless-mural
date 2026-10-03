#!/usr/bin/env node
// The site's build (Vercel runs it, see vercel.json): the static page, every
// tile as a file, and timeline.json, read from git itself. Each commit that
// touches tiles/ is a step: who painted it (the commit's author, set by LLM
// TimeMachine to the model), what it says it did (the commit message), which
// tiles the mural held after it, and whether it kept to the rules (check.mjs).
// Every branch of the repo is read, so the site can switch between the
// mural's versions; GitHub's API is never called.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { changeProblems, parseTile, svgProblems, tileKey } from './check.mjs'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
const tryGit = (...args) => { try { return git(...args) } catch { return '' } }
const season = JSON.parse(readFileSync('season.json', 'utf8'))
const OUT = 'dist'

const ok = (...args) => { try { git(...args); return true } catch { return false } }

const remote = tryGit('remote', 'get-url', 'origin').trim()
const fromRemote = remote.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/)
const repo = {
  owner: process.env.VERCEL_GIT_REPO_OWNER || fromRemote?.[1] || null,
  name: process.env.VERCEL_GIT_REPO_SLUG || fromRemote?.[2] || null,
}

// Hosts clone shallow and with one branch: fetch the full history and the
// others. When the checkout has no usable origin, the public repo serves.
const sources = [remote && 'origin', repo.owner && repo.name && `https://github.com/${repo.owner}/${repo.name}.git`].filter(Boolean)
const shallow = () => tryGit('rev-parse', '--is-shallow-repository').trim() === 'true'
const source = sources.find(src => ok('fetch', '--quiet', ...(shallow() ? ['--unshallow'] : []), src, '+refs/heads/*:refs/remotes/origin/*'))
console.log(source ? `Fetched every branch from ${source}.` : 'Could not fetch the other branches: only the checkout is shown.')

const refs = tryGit('for-each-ref', '--format=%(refname)', 'refs/remotes/origin', 'refs/heads').split('\n')
  .filter(r => r && !r.endsWith('/HEAD'))
const branchName = r => r.replace(/^refs\/(remotes\/origin|heads)\//, '')
const current = process.env.VERCEL_GIT_COMMIT_REF || tryGit('rev-parse', '--abbrev-ref', 'HEAD').trim() || 'main'

rmSync(OUT, { recursive: true, force: true })
mkdirSync(`${OUT}/t`, { recursive: true })
const written = new Set()
const commits = {}

function tilesAt(sha) {
  const map = {}
  for (const line of tryGit('ls-tree', '-r', sha, '--', 'tiles/').split('\n').filter(Boolean)) {
    const [meta, path] = line.split('\t')
    const tile = parseTile(path)
    if (!tile) continue
    const blob = meta.split(' ')[2]
    map[tileKey(tile)] = blob
    if (!written.has(blob)) {
      writeFileSync(`${OUT}/t/${blob}.svg`, execFileSync('git', ['cat-file', 'blob', blob]))
      written.add(blob)
    }
  }
  return map
}

function readCommit(sha) {
  if (commits[sha] !== undefined) return commits[sha]
  const [, parent = '', author, date, message] = git('show', '-s', '--format=%H%x1f%P%x1f%an%x1f%aI%x1f%B', sha).split('\x1f')
  const firstParent = parent.trim().split(' ')[0] || null
  const changes = git('diff-tree', '--root', '--no-commit-id', '-r', '--name-status', '--no-renames', sha).split('\n').filter(Boolean)
    .map(l => { const [status, ...p] = l.split('\t'); return { path: p.join('\t'), status: status[0] } })
  if (!changes.some(c => c.path.startsWith('tiles/') && parseTile(c.path))) return (commits[sha] = null)

  const painted = firstParent ? tryGit('ls-tree', '--name-only', firstParent, 'tiles/').split('\n').map(parseTile).filter(Boolean) : []
  const problems = changeProblems({ changes, painted, season })
  const added = changes.length === 1 && changes[0].status === 'A' ? parseTile(changes[0].path) : null
  if (!problems.length && added) problems.push(...svgProblems(git('show', `${sha}:${changes[0].path}`), season))
  const lines = message.trim().split('\n')
  const tail = lines.findIndex(l => /^(Model|Capsule):/.test(l))
  const changelog = lines.slice(1, tail === -1 ? undefined : tail).join('\n').trim()
  const numstat = git('diff-tree', '--root', '--no-commit-id', '-r', '--numstat', sha).split('\n').filter(Boolean)
  return (commits[sha] = {
    sha,
    parent: firstParent,
    author: author.replace(/\s*\(via LLM TimeMachine\)\s*$/, ''),
    date,
    subject: lines[0] || '',
    changelog: changelog === '(no changelog)' ? '' : changelog,
    model: lines.find(l => l.startsWith('Model:'))?.slice(6).trim() || null,
    capsule: lines.find(l => l.startsWith('Capsule:'))?.slice(8).trim() || null,
    tile: added ? tileKey(added) : null,
    lines: numstat.reduce((n, l) => n + (Number(l.split('\t')[0]) || 0), 0),
    passed: !problems.length,
    problems,
    tiles: tilesAt(sha),
  })
}

// The checkout itself counts as the current branch: a host may build a detached HEAD.
let branches = [...refs.map(ref => ({ ref, name: branchName(ref) })), { ref: 'HEAD', name: current }].map(({ ref, name }) => {
  const steps = tryGit('rev-list', '--reverse', '--first-parent', ref).split('\n').filter(Boolean)
    .map(readCommit).filter(Boolean).map(c => c.sha)
  return { name, steps }
})
// One entry per name (a local and a fetched copy: the further one, since
// branches only move forward). Then drop a branch that another one simply
// continues (a pull-request branch, or a line painted further), unless what
// comes after broke a rule: a broken step gets a branch of its own, and the
// line it left must stay visible. Of two branches with the same steps, keep
// the Relay's main line.
const byName = new Map()
for (const b of branches) if (!byName.has(b.name) || b.steps.length > byName.get(b.name).steps.length) byName.set(b.name, b)
branches = [...byName.values()]
const prefixOf = (a, b) => a.steps.length < b.steps.length && a.steps.every((s, i) => b.steps[i] === s)
const same = (a, b) => a.steps.length === b.steps.length && a.steps.every((s, i) => b.steps[i] === s)
const continues = (a, b) => prefixOf(a, b) && b.steps.slice(a.steps.length).every(s => commits[s]?.passed)
const isMain = b => /(^|\/)main$/.test(b.name)
const preferred = (o, b) => (isMain(o) && !isMain(b)) || (isMain(o) === isMain(b) && o.name < b.name)
// The deployed branch leads when it holds steps (the preview of a branch
// shows that branch). Production builds main, which holds none: the version
// whose last step is the latest one that kept to the rules leads then, the
// one being painted on.
const deployed = branches.find(b => b.name === current && b.steps.length) ?? null
branches = branches.filter(b => b === deployed || !branches.some(o =>
  o !== b && (continues(b, o) || (same(b, o) && (o === deployed || preferred(o, b))))))
const tip = b => commits[b.steps.at(-1)]
const lead = deployed ?? branches.filter(b => b.steps.length && tip(b)?.passed)
  .sort((a, b) => Date.parse(tip(b).date) - Date.parse(tip(a).date) || b.steps.length - a.steps.length)[0] ?? null
branches.sort((a, b) => (a === lead ? -1 : b === lead ? 1 : b.steps.length - a.steps.length || a.name.localeCompare(b.name)))

for (const f of ['index.html', 'season.json']) cpSync(f, `${OUT}/${f}`)
const used = new Set(branches.flatMap(b => b.steps))
writeFileSync(`${OUT}/timeline.json`, JSON.stringify({
  builtAt: new Date().toISOString(),
  season,
  repo,
  current,
  branches,
  commits: Object.fromEntries(Object.entries(commits).filter(([sha, c]) => c && used.has(sha))),
}))
console.log(`Built ${OUT}/: ${branches.length} branch(es), ${used.size} step(s), ${written.size} tile file(s). Current branch: ${current}.`)
