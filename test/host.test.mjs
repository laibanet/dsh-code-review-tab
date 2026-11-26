import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

// Keep the persisted-turn files out of the real DSH home.
const historyDir = mkdtempSync(path.join(tmpdir(), 'crv-history-'))
process.env.DSH_CODE_REVIEW_HISTORY_DIR = historyDir
process.env.DSH_CODE_REVIEW_SETTINGS_FILE = path.join(historyDir, 'settings.json')

const { apply } = await import(new URL('../index.js', import.meta.url).href)

let handler = null
let sessionListener = null

const fakeSummary = {
  turn: 2,
  cwd: 'C:/repo',
  total: 1,
  added: 1,
  deleted: 1,
  files: [{ path: 'src/x.ts', display: 'src/x.ts', added: 1, deleted: 1 }],
}
const fakeWorkspaceChanges = {
  summary(sessionId, seq) {
    return sessionId === 's1' && seq === 7 ? fakeSummary : undefined
  },
  async diff(sessionId, seq, index) {
    if (sessionId !== 's1' || seq !== 7 || index !== 0) return undefined
    return {
      kind: 'text',
      path: 'src/x.ts',
      display: 'src/x.ts',
      before: true,
      after: true,
      coarse: false,
      hunks: [{ oldStart: 3, oldLines: 2, newStart: 3, newLines: 2, lines: [' same', '-old line', '+new line'] }],
    }
  },
}

const ctx = {
  effect(fn) { return fn() },
  on(name, listener) { if (name === 'session/event') sessionListener = listener; return () => {} },
  get(name) { return name === 'workspaceChanges' ? fakeWorkspaceChanges : undefined },
  webServer: {
    register(route) {
      handler = route.handler
      assert.equal(route.kind, 'prefix')
      assert.equal(route.path, '/api/code-review')
      return () => {}
    },
  },
}
apply(ctx)
assert.ok(handler, 'route registered')
assert.ok(sessionListener, 'session/event listener registered')

const dir = mkdtempSync(path.join(tmpdir(), 'crv-repo-'))
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
git('init', '-q')
git('config', 'user.email', 'a@b.c')
git('config', 'user.name', 'Tester')
writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n')
mkdirSync(path.join(dir, 'sub'))
writeFileSync(path.join(dir, 'sub', 'b.txt'), 'alpha\nbeta\n')
git('add', '.')
git('commit', '-q', '-m', 'first commit')
appendFileSync(path.join(dir, 'a.txt'), 'four\n')
writeFileSync(path.join(dir, 'sub', 'b.txt'), 'alpha\nBETA\n')
writeFileSync(path.join(dir, 'new.txt'), 'brand new\n')

async function call(action, params = {}) {
  const query = new URLSearchParams({ cwd: dir, ...params }).toString()
  let status = 0
  let headers = {}
  let body = ''
  const res = {
    writeHead(code, h) { status = code; headers = h || {} },
    end(payload) { if (payload !== undefined) body += payload },
  }
  await handler({ method: 'GET', url: `/api/code-review/${action}?${query}` }, res)
  return { status, headers, data: body ? JSON.parse(body) : null }
}

const snap = await call('snapshot')
assert.equal(snap.status, 200)
assert.equal(snap.data.ok, true)
assert.ok(snap.data.repo, 'repo resolved')
assert.ok(snap.data.commits.length >= 1, 'commit list')
assert.equal(snap.data.commits[0].subject, 'first commit')
assert.equal(snap.data.commits[0].author, 'Tester')
const paths = snap.data.changes.map(c => c.path).sort()
assert.deepEqual(paths, ['a.txt', 'new.txt', 'sub/b.txt'])
assert.equal(snap.data.counts.files, 3)
console.log('snapshot ok:', JSON.stringify({ branch: snap.data.repo.branch, files: paths, counts: snap.data.counts }))

// A user-chosen folder overrides a session cwd that is not a repository.
const override = await callDir(tmpdir(), 'snapshot', { root: dir })
assert.equal(override.ok, true)
assert.ok(override.repo, 'root override selects the chosen repository')
console.log('root override ok:', override.repo.root)

// The chosen folder is stored on the Host, per Session, so a restart keeps it.
const choice0 = await callDir(tmpdir(), 'repo', { sessionId: 's1' })
assert.equal(choice0.ok, true)
assert.equal(choice0.root, '')
const savedChoice = await post('repo', { sessionId: 's1' }, { root: dir })
assert.equal(savedChoice.ok, true)
const choice1 = await callDir(tmpdir(), 'repo', { sessionId: 's1' })
assert.equal(choice1.root, dir)
const clearedChoice = await post('repo', { sessionId: 's1' }, { root: '' })
assert.equal(clearedChoice.ok, true)
const choice2 = await callDir(tmpdir(), 'repo', { sessionId: 's1' })
assert.equal(choice2.root, '')
console.log('repo choice ok')

const wt = await call('worktree')
assert.equal(wt.data.ok, true)
const files = wt.data.files
assert.equal(files.length, 3)
const a = files.find(f => f.path === 'a.txt')
assert.equal(a.status, 'M')
assert.equal(a.additions, 1)
assert.equal(a.deletions, 0)
const added = a.hunks.flatMap(h => h.lines).filter(l => l.kind === 'add')
assert.equal(added.length, 1)
assert.equal(added[0].text, 'four')
assert.equal(added[0].new, 4)
const ctxLine = a.hunks.flatMap(h => h.lines).find(l => l.kind === 'ctx')
assert.ok(ctxLine && typeof ctxLine.old === 'number' && typeof ctxLine.new === 'number')
const newFile = files.find(f => f.path === 'new.txt')
assert.equal(newFile.status, '?')
assert.equal(newFile.additions, 1)
assert.equal(newFile.hunks[0].lines[0].new, 1)
const b = files.find(f => f.path === 'sub/b.txt')
assert.equal(b.additions, 1)
assert.equal(b.deletions, 1)
console.log('worktree ok:', files.map(f => `${f.status} ${f.path} +${f.additions}-${f.deletions}`).join(', '))

const hash = snap.data.commits[0].hash
const det = await call('commit', { hash })
assert.equal(det.data.ok, true)
assert.equal(det.data.commit.subject, 'first commit')
assert.deepEqual(det.data.commit.parents, [])
assert.equal(det.data.files.length, 2)
const cA = det.data.files.find(f => f.path === 'a.txt')
assert.equal(cA.status, 'A')
assert.equal(cA.additions, 3)
assert.equal(cA.hunks[0].lines.filter(l => l.kind === 'add').length, 3)
console.log('commit ok:', det.data.files.map(f => `${f.status} ${f.path} +${f.additions}-${f.deletions}`).join(', '))

// Per-turn feed: one recorded workspace/changes event for session s1.
sessionListener({ id: 's1' }, { type: 'workspace/changes', seq: 7, data: { turn: 2 } })
const turns = await call('turns', { sessionId: 's1' })
assert.equal(turns.data.ok, true)
assert.equal(turns.data.turns.length, 1)
assert.equal(turns.data.turns[0].turn, 2)
assert.equal(turns.data.turns[0].files[0].index, 0)
assert.equal(turns.data.turns[0].files[0].path, 'src/x.ts')
const turnDiff = await call('turn', { sessionId: 's1', seq: 7, index: 0 })
assert.equal(turnDiff.data.ok, true)
const td = turnDiff.data.diff
assert.equal(td.status, 'M')
assert.equal(td.additions, 1)
assert.equal(td.deletions, 1)
assert.deepEqual(td.hunks[0].lines.map(l => [l.kind, l.old, l.new, l.text]), [
  ['ctx', 3, 3, 'same'],
  ['del', 4, null, 'old line'],
  ['add', null, 4, 'new line'],
])
const turnsOther = await call('turns', { sessionId: 'other' })
assert.equal(turnsOther.data.turns.length, 0)
const turnsAll = await call('turns', { scope: 'all' })
assert.equal(turnsAll.data.ok, true)
assert.equal(turnsAll.data.turns.length, 1)
assert.equal(turnsAll.data.turns[0].sessionId, 's1')
assert.equal(turnsAll.data.turns[0].seq, 7)
assert.equal(turnsAll.data.turns[0].cwd, 'C:/repo')
await new Promise((resolve) => setTimeout(resolve, 900))
assert.ok(
  readdirSync(historyDir).some((file) => file.endsWith('.json')),
  'the recorded turn is persisted for the next process',
)
rmSync(historyDir, { recursive: true, force: true })
console.log('turns ok:', JSON.stringify(turns.data.turns[0]))

const bad = await call('commit', { hash: 'zzzz' })
assert.equal(bad.data.ok, false)
const notRepo = await call('snapshot', { cwd: tmpdir() })
assert.equal(notRepo.data.ok, true)
assert.equal(notRepo.data.repo, null)
console.log('edge cases ok')

const opt = await call('snapshot', { cwd: path.join(dir, 'does-not-exist') })
assert.equal(opt.data.ok, false)
assert.ok(opt.data.error)
console.log('missing dir ok:', opt.data.error)

// Renames, deletions and non-ASCII paths.
const dir2 = mkdtempSync(path.join(tmpdir(), 'crv-rename-'))
const git2 = (...args) => execFileSync('git', ['-C', dir2, ...args], { encoding: 'utf8' })
git2('init', '-q')
git2('config', 'user.email', 'a@b.c')
git2('config', 'user.name', 'Tester')
writeFileSync(path.join(dir2, 'old.txt'), 'rename me\n')
writeFileSync(path.join(dir2, 'gone.txt'), 'delete me\n')
writeFileSync(path.join(dir2, '\u4e2d\u6587.txt'), '\u4f60\u597d\n')
git2('add', '.')
git2('commit', '-q', '-m', 'base')
git2('mv', 'old.txt', 'renamed.txt')
execFileSync('git', ['-C', dir2, 'rm', '-q', 'gone.txt'])
writeFileSync(path.join(dir2, '\u4e2d\u6587 \u65b0.txt'), 'new\n')

async function callDir(dirPath, action, params = {}) {
  const query = new URLSearchParams({ cwd: dirPath, ...params }).toString()
  let body = ''
  const res = { writeHead() {}, end(p) { if (p !== undefined) body += p } }
  await handler({ method: 'GET', url: `/api/code-review/${action}?${query}` }, res)
  return JSON.parse(body)
}

const snap2 = await callDir(dir2, 'snapshot')
const byPath = new Map(snap2.changes.map(c => [c.path, c]))
assert.ok(byPath.has('renamed.txt'), 'rename listed by new path')
assert.equal(byPath.get('renamed.txt').status, 'R')
assert.equal(byPath.get('gone.txt').status, 'D')
assert.ok(byPath.has('\u4e2d\u6587 \u65b0.txt'), 'unicode untracked path listed')
const wt2 = await callDir(dir2, 'worktree')
const renamed = wt2.files.find(f => f.path === 'renamed.txt')
assert.ok(renamed, 'rename patch parsed')
assert.equal(renamed.status, 'R')
const deleted = wt2.files.find(f => f.path === 'gone.txt')
assert.equal(deleted.status, 'D')
assert.equal(deleted.deletions, 1)
const unicodeNew = wt2.files.find(f => f.path === '\u4e2d\u6587 \u65b0.txt')
assert.ok(unicodeNew, 'unicode untracked patch parsed')
assert.equal(unicodeNew.additions, 1)
console.log('rename/delete/unicode ok:', wt2.files.map(f => `${f.status} ${f.path}`).join(', '))

// Binaries and empty new files must still carry a path.
const dir3 = mkdtempSync(path.join(tmpdir(), 'crv-binary-'))
const git3 = (...args) => execFileSync('git', ['-C', dir3, ...args], { encoding: 'utf8' })
git3('init', '-q')
git3('config', 'user.email', 'a@b.c')
git3('config', 'user.name', 'Tester')
writeFileSync(path.join(dir3, 'blob.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
writeFileSync(path.join(dir3, 'empty.txt'), '')
git3('add', '.')
git3('commit', '-q', '-m', 'base')
writeFileSync(path.join(dir3, 'blob.bin'), Buffer.from([0, 9, 8, 7, 0, 254]))
writeFileSync(path.join(dir3, 'empty2.txt'), '')
const wt3 = await callDir(dir3, 'worktree')
const blob = wt3.files.find(f => f.path === 'blob.bin')
assert.ok(blob, 'binary patch carries its path')
assert.equal(blob.binary, true)
const empty2 = wt3.files.find(f => f.path === 'empty2.txt')
assert.ok(empty2, 'empty new file carries its path')
console.log('binary/empty ok:', wt3.files.map(f => `${f.path}${f.binary ? ' (binary)' : ''}`).join(', '))

// Merge commits diff against their first parent instead of appearing empty.
const dir4 = mkdtempSync(path.join(tmpdir(), 'crv-merge-'))
const git4 = (...args) => execFileSync('git', ['-C', dir4, ...args], { encoding: 'utf8' })
git4('init', '-q')
git4('config', 'user.email', 'a@b.c')
git4('config', 'user.name', 'Tester')
writeFileSync(path.join(dir4, 'base.txt'), 'base\n')
git4('add', '.')
git4('commit', '-q', '-m', 'base')
git4('checkout', '-q', '-b', 'feature')
writeFileSync(path.join(dir4, 'feature.txt'), 'feature\n')
git4('add', '.')
git4('commit', '-q', '-m', 'feature work')
git4('checkout', '-q', 'master')
writeFileSync(path.join(dir4, 'main.txt'), 'main\n')
git4('add', '.')
git4('commit', '-q', '-m', 'main work')
git4('merge', '-q', '--no-ff', '-m', 'merge feature', 'feature')
const mergeHash = git4('rev-parse', 'HEAD').trim()
const merge = await callDir(dir4, 'commit', { hash: mergeHash })
assert.equal(merge.ok, true)
assert.equal(merge.commit.parents.length, 2)
assert.ok(merge.files.some(f => f.path === 'feature.txt'), 'merge patch includes the side branch file')
console.log('merge ok:', merge.files.map(f => f.path).join(', '))

// An unborn branch still reports staged working-tree changes.
const dir5 = mkdtempSync(path.join(tmpdir(), 'crv-unborn-'))
const git5 = (...args) => execFileSync('git', ['-C', dir5, ...args], { encoding: 'utf8' })
git5('init', '-q')
git5('config', 'user.email', 'a@b.c')
git5('config', 'user.name', 'Tester')
writeFileSync(path.join(dir5, 'first.txt'), 'first\nsecond\n')
git5('add', '.')
const unborn = await callDir(dir5, 'worktree')
assert.equal(unborn.ok, true)
assert.ok(unborn.files.some(f => f.path === 'first.txt'), 'staged file visible without HEAD')
const unbornSnap = await callDir(dir5, 'snapshot')
assert.equal(unbornSnap.ok, true)
assert.equal(unbornSnap.commits.length, 0)
console.log('unborn HEAD ok:', unborn.files.map(f => f.path).join(', '))

// The expanded file view reads working-tree text and revision text.
const contentNow = await call('content', { path: 'a.txt' })
assert.equal(contentNow.data.ok, true)
assert.ok(contentNow.data.text.includes('four'), 'working-tree content')
const contentThen = await call('content', { path: 'a.txt', hash })
assert.equal(contentThen.data.ok, true)
assert.ok(!contentThen.data.text.includes('four'), 'revision content is the committed version')
const contentMissing = await call('content', { path: 'nope.txt' })
assert.equal(contentMissing.data.ok, false)
console.log('file content ok')

// A session workspace without git still reads working-tree files (turn paths are cwd-relative).
const plainDir = mkdtempSync(path.join(tmpdir(), 'crv-plain-'))
writeFileSync(path.join(plainDir, 'note.txt'), 'plain text\n', 'utf8')
const plainContent = await callDir(plainDir, 'content', { path: 'note.txt' })
assert.equal(plainContent.ok, true)
assert.ok(plainContent.text.includes('plain'))
console.log('non-git content ok')

// The in-panel editor saves through a guarded write endpoint.
function mockRequest(body) {
  const listeners = {}
  let ready = false
  const fire = () => {
    if (!listeners.end) return
    listeners.data?.(Buffer.from(body, 'utf8'))
    listeners.end()
  }
  return {
    method: 'POST',
    url: '',
    on(event, cb) {
      listeners[event] = cb
      if (event === 'end' && ready) setImmediate(fire)
      return this
    },
    start() {
      ready = true
      if (listeners.end) setImmediate(fire)
    },
  }
}

async function post(action, params, body) {
  const request = mockRequest(JSON.stringify(body))
  request.url = `/api/code-review/${action}?${new URLSearchParams({ cwd: dir, ...params })}`
  let payload = ''
  const res = { writeHead() {}, end(p) { if (p !== undefined) payload += p } }
  const pending = handler(request, res)
  request.start()
  await pending
  return JSON.parse(payload)
}

const before = await call('content', { path: 'a.txt' })
assert.equal(before.data.ok, true)
const saved = await post('write', { path: 'a.txt' }, { text: 'one\ntwo\nthree\nfour\nfive\n', expectedMtimeMs: before.data.mtimeMs })
assert.equal(saved.ok, true)
const after = await call('content', { path: 'a.txt' })
assert.ok(after.data.text.includes('five'))
const stale = await post('write', { path: 'a.txt' }, { text: 'stale', expectedMtimeMs: before.data.mtimeMs })
assert.equal(stale.ok, false)
assert.equal(stale.conflict, true)
console.log('write ok, conflict guard ok')

// The editor handoff resolves repository-relative paths and refuses traversal.
const fileInfo = await call('file', { path: 'a.txt' })
assert.equal(fileInfo.data.ok, true)
assert.equal(fileInfo.data.exists, true)
assert.ok(fileInfo.data.absolute.replace(/\\/g, '/').endsWith('/a.txt'))
const missingFile = await call('file', { path: 'missing.txt' })
assert.equal(missingFile.data.ok, true)
assert.equal(missingFile.data.exists, false)
const traversal = await call('file', { path: '../secret.txt' })
assert.equal(traversal.data.ok, false)
console.log('file info ok:', fileInfo.data.absolute)

// Submodule pointer changes expand into the submodule's own files and commits.
const subDir = mkdtempSync(path.join(tmpdir(), 'crv-sub-'))
const gitSub = (...args) => execFileSync('git', ['-C', subDir, ...args], { encoding: 'utf8' })
gitSub('init', '-q')
gitSub('config', 'user.email', 'a@b.c')
gitSub('config', 'user.name', 'Tester')
writeFileSync(path.join(subDir, 'code.cpp'), 'line1\n')
gitSub('add', '.')
gitSub('commit', '-q', '-m', 'sub base')
const subBase = gitSub('rev-parse', 'HEAD').trim()
writeFileSync(path.join(subDir, 'code.cpp'), 'line1\nline2\n')
gitSub('add', '.')
gitSub('commit', '-q', '-m', 'sub change')
const subHead = gitSub('rev-parse', 'HEAD').trim()

const superDir = mkdtempSync(path.join(tmpdir(), 'crv-super-'))
const gitSuper = (...args) => execFileSync('git', ['-C', superDir, ...args], { encoding: 'utf8' })
gitSuper('init', '-q')
gitSuper('config', 'user.email', 'a@b.c')
gitSuper('config', 'user.name', 'Tester')
writeFileSync(path.join(superDir, 'root.txt'), 'root\n')
execFileSync('git', ['-c', 'protocol.file.allow=always', '-C', superDir, 'submodule', 'add', subDir, 'sub'], { encoding: 'utf8' })
gitSuper('add', '.')
gitSuper('commit', '-q', '-m', 'add submodule')
execFileSync('git', ['-C', path.join(superDir, 'sub'), 'checkout', '-q', subBase], { encoding: 'utf8' })
gitSuper('add', 'sub')
gitSuper('commit', '-q', '-m', 'bump down')
execFileSync('git', ['-C', path.join(superDir, 'sub'), 'checkout', '-q', subHead], { encoding: 'utf8' })
gitSuper('add', 'sub')
gitSuper('commit', '-q', '-m', 'bump up')
const bumpHash = gitSuper('rev-parse', 'HEAD').trim()

const bump = await callDir(superDir, 'commit', { hash: bumpHash })
assert.equal(bump.ok, true)
assert.equal(bump.groups.length, 1, 'submodule bump expands into one group')
const bumpGroup = bump.groups[0]
assert.equal(bumpGroup.path, 'sub')
assert.equal(bumpGroup.oldSha, subBase)
assert.equal(bumpGroup.newSha, subHead)
assert.equal(bumpGroup.commits.length, 1, 'submodule commits listed')
assert.equal(bumpGroup.files.length, 1, 'submodule file diff listed')
assert.equal(bumpGroup.files[0].path, 'sub/code.cpp')
assert.equal(bumpGroup.files[0].additions, 1)
assert.ok(bump.files.some(f => f.path === 'sub/code.cpp'), 'flat file list carries the submodule file')
const subContent = await callDir(superDir, 'content', { path: 'sub/code.cpp', sub: 'sub', subSha: subHead })
assert.equal(subContent.ok, true)
assert.ok(subContent.text.includes('line2'), 'submodule revision content read')
console.log('submodule commit ok:', JSON.stringify({ path: bumpGroup.path, commits: bumpGroup.commits.map(c => c.subject), files: bumpGroup.files.map(f => f.path) }))

// A dirty submodule checkout (pointer unchanged) still shows its uncommitted file.
appendFileSync(path.join(superDir, 'sub', 'code.cpp'), 'line3\n')
const dirtyTree = await callDir(superDir, 'worktree')
const dirtyGroup = (dirtyTree.groups || []).find(g => g.path === 'sub')
assert.ok(dirtyGroup, 'dirty submodule group present')
assert.ok(dirtyGroup.files.some(f => f.path === 'sub/code.cpp'), 'dirty submodule file listed')
console.log('submodule worktree ok:', dirtyGroup.files.map(f => `${f.path} +${f.additions}-${f.deletions}`).join(', '))

console.log('ALL PASS')
