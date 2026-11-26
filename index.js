/**
 * Host half of the code-review bundle.
 *
 * Serves a small read-only JSON API over the Web carrier for the right-sidebar
 * tab. Everything it exposes comes from `git` read commands run inside the
 * Session's own working directory: recent commits, one commit's patch, and the
 * working tree's patch against HEAD (which is what an agent edit leaves
 * behind before anyone commits it).
 *
 * The browser half never runs git itself; it only renders the structures this
 * file returns.
 */
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export const name = 'code-review'
export const inject = ['webServer']

/** The one route prefix this plugin owns. */
const ROUTE = '/api/code-review'
const MAX_FILES = 400
const MAX_PATCH_BYTES = 4 * 1024 * 1024
const MAX_DIFF_LINES = 8000
const MAX_UNTRACKED_BYTES = 512 * 1024
const MAX_CONTENT_BYTES = 1024 * 1024
const MAX_CONTENT_LINES = 8000
const MAX_TURNS = 300
const GIT_TIMEOUT = 20000
const COMMIT_COUNT = 40

/**
 * Run one git command without a shell.
 * @param {string} cwd working directory for git.
 * @param {string[]} args arguments, one array element per argument.
 * @param {AbortSignal} [signal] cancels the child.
 * @returns {Promise<string>} stdout.
 */
function runGit(cwd, args, signal) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args],
      {
        cwd,
        windowsHide: true,
        timeout: GIT_TIMEOUT,
        maxBuffer: 16 * 1024 * 1024,
        signal,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
          GIT_PAGER: 'cat',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = new Error((stderr || '').trim() || error.message)
          failure.exitCode = typeof error.code === 'number' ? error.code : undefined
          reject(failure)
          return
        }
        resolve(stdout)
      },
    )
  })
}

/**
 * Run one git command, mapping any failure to `null`.
 * @param {string} cwd working directory for git.
 * @param {string[]} args arguments.
 * @returns {Promise<string | null>} stdout or null.
 */
async function gitOrNull(cwd, args) {
  try {
    return await runGit(cwd, args)
  } catch {
    return null
  }
}

/** One tab-separated/unit-separator split that keeps empty fields. */
function splitFields(line, separator) {
  return line.split(separator)
}

/** Whether a path is safe to hand to `git show <rev>:<path>` and to join. */
function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) return false
  if (value.includes('\0') || value.includes(':')) return false
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) return false
  const normalized = value.split('\\').join('/')
  const segments = normalized.split('/')
  if (segments.some(segment => segment === '..')) return false
  return true
}

/** Turn a `---`/`+++` header payload into a repo-relative path. */
function stripDiffPrefix(raw) {
  const value = raw.trim()
  if (value === '/dev/null') return null
  if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2)
  return value
}

/** Map one porcelain `XY` pair to a single display status letter. */
function statusLetter(xy) {
  if (xy === '??') return '?'
  const x = xy[0]
  const y = xy[1]
  if (x === 'R' || y === 'R') return 'R'
  if (x === 'C') return 'C'
  if (x === 'D' || y === 'D') return 'D'
  if (x === 'A') return 'A'
  if (x === 'U' || (x === 'D' && y === 'D')) return 'U'
  return 'M'
}

/**
 * Parse `git status --porcelain=v1 -z` output.
 * @param {string} text NUL-separated entries.
 * @returns {{xy: string, path: string, oldPath: string | null}[]} entries in git order.
 */
function parseStatusZ(text) {
  const tokens = text.split('\0')
  const entries = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token) continue
    const xy = token.slice(0, 2)
    const filePath = token.slice(3)
    if (!filePath) continue
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') {
      const oldPath = tokens[index + 1] || null
      if (oldPath) index += 1
      entries.push({ xy, path: filePath, oldPath })
      continue
    }
    entries.push({ xy, path: filePath, oldPath: null })
  }
  return entries
}

/**
 * Parse the unified diff body into per-file, per-hunk structures the panel can
 * render with old/new line numbers.
 * @param {string} text patch text from git.
 * @returns {{files: object[], truncated: boolean}} parsed files and whether the line budget cut them.
 */
function parsePatch(text) {
  const files = []
  const lines = text.split('\n')
  let current = null
  let hunk = null
  let oldLine = 0
  let newLine = 0
  let lineBudget = MAX_DIFF_LINES
  let truncated = false

  const finish = () => {
    if (!current) return
    if (!current.path) current.path = current.renamedTo || current.oldPath || ''
    if (!current.gitlink && (current.gitlinkOld || current.gitlinkNew)) {
      current.gitlink = { old: current.gitlinkOld || '', new: current.gitlinkNew || '' }
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    let raw = lines[index]
    if (raw.endsWith('\r')) raw = raw.slice(0, -1)

    if (raw.startsWith('diff --git ')) {
      finish()
      const body = raw.slice('diff --git '.length)
      const separator = body.lastIndexOf(' b/')
      const oldGuess = body.startsWith('a/') && separator > 2 ? body.slice(2, separator) : null
      const newGuess = separator >= 0 ? body.slice(separator + 3) : null
      current = {
        path: newGuess || oldGuess || '',
        oldPath: oldGuess && oldGuess !== newGuess ? oldGuess : null,
        status: 'M',
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
        renamedTo: null,
      }
      files.push(current)
      hunk = null
      if (files.length > MAX_FILES) {
        files.pop()
        truncated = true
        break
      }
      continue
    }
    if (!current) continue

    if (hunk === null && raw.startsWith('new file mode')) { current.status = 'A'; continue }
    if (hunk === null && raw.startsWith('deleted file mode')) { current.status = 'D'; continue }
    if (hunk === null && raw.startsWith('rename from ')) { current.oldPath = raw.slice('rename from '.length); current.status = 'R'; continue }
    if (hunk === null && raw.startsWith('rename to ')) { current.renamedTo = raw.slice('rename to '.length); continue }
    if (hunk === null && (raw.startsWith('Binary files ') || raw === 'GIT binary patch' || raw.startsWith('Binary file '))) {
      current.binary = true
      continue
    }
    if (hunk === null && raw.startsWith('--- ')) {
      const value = stripDiffPrefix(raw.slice(4))
      if (value) current.oldPath = value
      continue
    }
    if (hunk === null && raw.startsWith('+++ ')) {
      const value = stripDiffPrefix(raw.slice(4))
      if (value) current.path = value
      continue
    }
    if (hunk === null) {
      const gitlinkIndex = /^index ([0-9a-f]{7,40})\.\.([0-9a-f]{7,40}) 160000$/i.exec(raw)
      if (gitlinkIndex) {
        current.gitlink = { old: gitlinkIndex[1], new: gitlinkIndex[2] }
        continue
      }
    }
    if (raw.startsWith('-Subproject commit ')) {
      current.gitlinkOld = raw.slice('-Subproject commit '.length).trim()
      // Fall through: the pointer line stays in the diff so an unexpandable
      // submodule still shows why.
    } else if (raw.startsWith('+Subproject commit ')) {
      current.gitlinkNew = raw.slice('+Subproject commit '.length).trim()
    }
    if (raw.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(raw)
      if (!match) continue
      hunk = {
        header: raw,
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        section: (match[5] || '').trim(),
        lines: [],
      }
      current.hunks.push(hunk)
      oldLine = hunk.oldStart
      newLine = hunk.newStart
      continue
    }
    if (!hunk) continue
    if (raw.startsWith('\\')) {
      hunk.lines.push({ kind: 'meta', old: null, new: null, text: raw })
      continue
    }
    if (lineBudget <= 0) {
      truncated = true
      break
    }
    const marker = raw[0]
    if (marker === '+') {
      hunk.lines.push({ kind: 'add', old: null, new: newLine, text: raw.slice(1) })
      newLine += 1
      current.additions += 1
      lineBudget -= 1
    } else if (marker === '-') {
      hunk.lines.push({ kind: 'del', old: oldLine, new: null, newCursor: newLine, text: raw.slice(1) })
      oldLine += 1
      current.deletions += 1
      lineBudget -= 1
    } else if (marker === ' ') {
      hunk.lines.push({ kind: 'ctx', old: oldLine, new: newLine, text: raw.slice(1) })
      oldLine += 1
      newLine += 1
      lineBudget -= 1
    } else if (raw !== '') {
      // Headers such as `index abc..def 100644` or `similarity index 91%`.
      hunk.lines.push({ kind: 'meta', old: null, new: null, text: raw })
    }
  }
  finish()
  return { files, truncated }
}

/** Normalize one gitlink SHA, dropping git's `-dirty` suffix. */
function gitlinkSha(value) {
  if (typeof value !== 'string') return ''
  const sha = value.replace(/-dirty$/i, '').trim()
  return /^[0-9a-f]{7,40}$/i.test(sha) && !/^0+$/.test(sha) ? sha : ''
}

/** Prefix one submodule file with its repository path and tag the group. */
function prefixSubmoduleFile(file, subPath) {
  const prefix = `${subPath.replace(/\\/g, '/')}/`
  file.oldPath = file.oldPath ? prefix + file.oldPath : null
  file.path = prefix + file.path
  file.group = subPath
  delete file.gitlink
  delete file.gitlinkOld
  delete file.gitlinkNew
  return file
}

/** Parse and cap one submodule patch, tagging every file with its group. */
function submodulePatch(text, subPath) {
  const capped = capPatch(text)
  const parsed = parsePatch(capped.text)
  for (const file of parsed.files) prefixSubmoduleFile(file, subPath)
  return { files: parsed.files, truncated: capped.truncated || parsed.truncated }
}

/** Merge one submodule patch's files into a group, folding duplicate paths. */
function mergeSubmoduleFiles(target, incoming) {
  const byPath = new Map(target.map(file => [file.path, file]))
  for (const file of incoming) {
    const existing = byPath.get(file.path)
    if (!existing) {
      target.push(file)
      byPath.set(file.path, file)
      continue
    }
    existing.hunks.push(...file.hunks)
    existing.additions += file.additions
    existing.deletions += file.deletions
    existing.dirty = Boolean(existing.dirty || file.dirty)
    if (file.binary) existing.binary = true
  }
}

/** Read the submodule's own uncommitted files. */
async function submoduleDirtyFiles(root, subPath) {
  const dir = path.join(root, subPath)
  const patch = await gitOrNull(dir, ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--patch', '--find-renames', '--'])
  if (!patch || !patch.trim()) return null
  const parsedGroup = submodulePatch(patch, subPath)
  for (const file of parsedGroup.files) file.dirty = true
  return parsedGroup
}

/** Read the submodule's commit subjects in one range. */
async function submoduleCommits(dir, oldSha, newSha) {
  const log = await gitOrNull(dir, ['log', '--format=%h%x1f%s%x1f%an', `${oldSha}..${newSha}`])
  if (!log) return []
  return log
    .split('\n')
    .filter(Boolean)
    .slice(0, 40)
    .map((line) => {
      const fields = line.split('\x1f')
      return { short: fields[0] || '', subject: fields[1] || '', author: fields[2] || '' }
    })
}

/**
 * Expand one gitlink change into the submodule's own files and commits.
 * @param {string} root repository root.
 * @param {object} file parsed gitlink file entry.
 * @returns {Promise<object | null>} a group, or null when nothing can be expanded.
 */
async function expandSubmodule(root, file) {
  const subPath = file.path
  let oldSha = gitlinkSha(file.gitlink && file.gitlink.old)
  let newSha = gitlinkSha(file.gitlink && file.gitlink.new)
  if (!oldSha && !newSha) return null

  const group = {
    path: subPath,
    oldSha,
    newSha,
    commits: [],
    files: [],
    truncated: false,
    dirty: false,
  }

  const dir = path.join(root, subPath)
  let initialized = null
  try {
    initialized = await fs.stat(path.join(dir, '.git'))
  } catch {
    initialized = null
  }
  if (!initialized) {
    group.error = 'This submodule is not initialized in this checkout.'
    return group
  }

  if (oldSha) oldSha = ((await gitOrNull(dir, ['rev-parse', '--verify', '--quiet', oldSha])) || oldSha).trim()
  if (newSha) newSha = ((await gitOrNull(dir, ['rev-parse', '--verify', '--quiet', newSha])) || newSha).trim()
  group.oldSha = oldSha
  group.newSha = newSha

  let patch = null
  if (oldSha && newSha) patch = await gitOrNull(dir, ['diff', '--no-color', '--no-ext-diff', '--patch', '--find-renames', oldSha, newSha, '--'])
  else if (oldSha) patch = await gitOrNull(dir, ['diff', '--no-color', '--no-ext-diff', '--patch', '--find-renames', oldSha, EMPTY_TREE, '--'])
  else patch = await gitOrNull(dir, ['diff', '--no-color', '--no-ext-diff', '--patch', '--find-renames', EMPTY_TREE, newSha, '--'])
  if (patch === null) {
    group.error = 'This submodule revision is not available locally (its commits were not fetched).'
    return group
  }
  const parsedGroup = submodulePatch(patch, subPath)
  group.files = parsedGroup.files
  group.truncated = parsedGroup.truncated
  if (oldSha && newSha) group.commits = await submoduleCommits(dir, oldSha, newSha)
  return group
}

/** Split one patch into direct files and expanded submodule groups (commit view). */
async function expandCommitFiles(root, files) {
  const direct = []
  const groups = []
  for (const file of files) {
    if (!file.gitlink) {
      direct.push(file)
      continue
    }
    const group = await expandSubmodule(root, file)
    if (group) groups.push(group)
    else direct.push(file)
  }
  return { direct, groups }
}

/** Read one submodule whose pointer did not move but whose checkout is dirty. */
async function worktreeSubmoduleGroup(root, subPath) {
  const dir = path.join(root, subPath)
  let initialized = null
  try {
    initialized = await fs.stat(path.join(dir, '.git'))
  } catch {
    initialized = null
  }
  if (!initialized) return null

  const group = { path: subPath, oldSha: '', newSha: '', commits: [], files: [], truncated: false, dirty: false }

  const tree = await gitOrNull(root, ['ls-tree', 'HEAD', '--', subPath])
  if (tree) {
    const meta = tree.trim().split('\t')[0] || ''
    const parts = meta.split(/\s+/)
    if (parts.length >= 3) group.oldSha = gitlinkSha(parts[2])
  }
  const head = ((await gitOrNull(dir, ['rev-parse', 'HEAD'])) || '').trim()
  group.newSha = gitlinkSha(head)

  if (group.oldSha && group.newSha && group.oldSha !== group.newSha) {
    const committed = await gitOrNull(dir, ['diff', '--no-color', '--no-ext-diff', '--patch', '--find-renames', group.oldSha, group.newSha, '--'])
    if (committed) {
      const parsedGroup = submodulePatch(committed, subPath)
      mergeSubmoduleFiles(group.files, parsedGroup.files)
      group.truncated = group.truncated || parsedGroup.truncated
      group.dirty = true
    }
    group.commits = await submoduleCommits(dir, group.oldSha, group.newSha)
  }

  const dirty = await submoduleDirtyFiles(root, subPath)
  if (dirty) {
    mergeSubmoduleFiles(group.files, dirty.files)
    group.truncated = group.truncated || dirty.truncated
    group.dirty = true
  }

  if (group.files.length === 0 && group.commits.length === 0) return null
  return group
}

/** Build the working-tree groups: pointer moves plus dirty submodule checkouts. */
async function worktreeGroups(root, files, entries) {
  const direct = []
  const groups = []
  for (const file of files) {
    if (!file.gitlink) {
      direct.push(file)
      continue
    }
    const group = await expandSubmodule(root, file)
    if (group) groups.push(group)
    else direct.push(file)
  }

  for (const entry of entries) {
    const existing = groups.find(group => group.path === entry.path)
    if (existing) {
      const dirty = await submoduleDirtyFiles(root, entry.path)
      if (dirty) {
        mergeSubmoduleFiles(existing.files, dirty.files)
        existing.truncated = existing.truncated || dirty.truncated
        existing.dirty = true
      }
      continue
    }
    const group = await worktreeSubmoduleGroup(root, entry.path)
    if (group) groups.push(group)
  }

  return { direct, groups }
}

/**
 * Count the lines of one untracked file, or mark it binary/oversized.
 * @param {string} root repository root.
 * @param {string} relative repository-relative path.
 * @returns {Promise<object | null>} a pseudo patch for the new file.
 */
async function untrackedPatch(root, relative) {
  if (!isSafeRelativePath(relative)) return null
  const absolute = path.join(root, relative)
  let stat
  try {
    stat = await fs.stat(absolute)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return { path: relative, oldPath: null, status: '?', binary: false, additions: 0, deletions: 0, hunks: [], oversized: true }
  }
  let buffer
  try {
    buffer = await fs.readFile(absolute)
  } catch {
    return null
  }
  if (buffer.includes(0)) {
    return { path: relative, oldPath: null, status: '?', binary: true, additions: 0, deletions: 0, hunks: [] }
  }
  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const contentLines = text.split(/\r?\n/)
  if (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') contentLines.pop()
  const total = contentLines.length
  if (total > MAX_DIFF_LINES) {
    return { path: relative, oldPath: null, status: '?', binary: false, additions: total, deletions: 0, hunks: [], oversized: true }
  }
  return {
    path: relative,
    oldPath: null,
    status: '?',
    binary: false,
    additions: total,
    deletions: 0,
    hunks: [{
      header: `@@ -0,0 +1,${total} @@`,
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: total,
      section: '',
      lines: contentLines.map((line, index) => ({ kind: 'add', old: null, new: index + 1, text: line })),
    }],
  }
}

/**
 * Resolve the Session's checkout: the effective working directory, then its
 * git top level.
 * @param {object} ctx plugin context.
 * @param {URLSearchParams} query request parameters.
 * @returns {Promise<{root: string | null, cwd: string}>} resolved locations.
 */
async function resolveCheckout(ctx, query) {
  const sessionId = query.get('sessionId') || ''
  let cwd = ''

  if (sessionId) {
    const agents = ctx.get('agents')
    const workingDirectory = ctx.get('workingDirectory')
    const agent = agents && typeof agents.get === 'function' ? agents.get(sessionId) : undefined
    if (agent && workingDirectory && typeof workingDirectory.ensure === 'function') {
      try {
        cwd = await workingDirectory.ensure(agent)
      } catch {
        cwd = ''
      }
    }
  }
  if (!cwd) cwd = query.get('cwd') || ''
  if (!cwd) {
    const error = new Error('This session has no working directory yet.')
    error.statusCode = 409
    throw error
  }

  let stat
  try {
    stat = await fs.stat(cwd)
  } catch {
    const error = new Error(`Working directory does not exist: ${cwd}`)
    error.statusCode = 404
    throw error
  }
  if (!stat.isDirectory()) {
    const error = new Error(`Working directory is not a directory: ${cwd}`)
    error.statusCode = 400
    throw error
  }

  const toplevel = await gitOrNull(cwd, ['rev-parse', '--show-toplevel'])
  if (!toplevel) return { root: null, cwd }
  const root = toplevel.trim() || cwd
  return { root, cwd }
}

/**
 * Read the repository overview: branch, HEAD, recent commits and the working
 * tree's changed files with line counts.
 * @param {object} ctx plugin context.
 * @param {URLSearchParams} query request parameters.
 * @returns {Promise<object>} the snapshot payload.
 */
async function snapshot(ctx, query) {
  const { root, cwd } = await resolveCheckout(ctx, query)
  if (!root) {
    return { ok: true, repo: null, cwd, commits: [], changes: [], counts: { files: 0, additions: 0, deletions: 0 } }
  }

  const base = await diffBase(root)
  const [branchOut, headOut, logOut, statusOut, numstatOut] = await Promise.all([
    gitOrNull(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
    gitOrNull(root, ['log', '-1', '--format=%H%x1f%h%x1f%an%x1f%ai%x1f%s']),
    gitOrNull(root, ['log', '-n', String(COMMIT_COUNT), '--format=%H%x1f%h%x1f%an%x1f%ai%x1f%D%x1f%s']),
    gitOrNull(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    gitOrNull(root, ['diff', base, '--numstat', '-z', '--no-color']),
  ])

  const commits = []
  if (logOut) {
    for (const line of logOut.split('\n')) {
      if (!line) continue
      const fields = splitFields(line, '\x1f')
      if (fields.length < 6) continue
      commits.push({
        hash: fields[0],
        short: fields[1],
        author: fields[2],
        date: fields[3],
        refs: fields[4],
        subject: fields[5],
      })
    }
  }

  let head = null
  if (headOut) {
    const fields = splitFields(headOut.trim(), '\x1f')
    if (fields.length >= 5) head = { hash: fields[0], short: fields[1], author: fields[2], date: fields[3], subject: fields[4] }
  }

  const countsByPath = new Map()
  if (numstatOut) {
    const tokens = numstatOut.split('\0')
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]
      if (!token) continue
      const parts = token.split('\t')
      if (parts.length < 3) continue
      const additions = parts[0] === '-' ? null : Number(parts[0])
      const deletions = parts[1] === '-' ? null : Number(parts[1])
      let filePath = parts[2]
      if (!filePath) {
        const oldPath = tokens[index + 1] || ''
        const newPath = tokens[index + 2] || ''
        index += 2
        filePath = newPath || oldPath
      }
      if (!filePath) continue
      countsByPath.set(filePath, additions === null
        ? { binary: true }
        : { additions, deletions })
    }
  }

  const entries = statusOut ? parseStatusZ(statusOut) : []
  const changes = []
  let totalAdditions = 0
  let totalDeletions = 0
  for (const entry of entries.slice(0, MAX_FILES)) {
    if (!isSafeRelativePath(entry.path)) continue
    let counts = countsByPath.get(entry.path)
    if (!counts && entry.xy === '??') {
      try {
        const stat = await fs.stat(path.join(root, entry.path))
        if (stat.isFile() && stat.size <= MAX_UNTRACKED_BYTES) {
          const buffer = await fs.readFile(path.join(root, entry.path))
          if (buffer.includes(0)) counts = { binary: true }
          else {
            const text = buffer.toString('utf8')
            const length = text.length === 0 ? 0 : text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0)
            counts = { additions: length, deletions: 0 }
          }
        } else {
          counts = { additions: 0, deletions: 0 }
        }
      } catch {
        counts = { additions: 0, deletions: 0 }
      }
    }
    if (!counts) counts = { additions: 0, deletions: 0 }
    if (typeof counts.additions === 'number') {
      totalAdditions += counts.additions
      totalDeletions += counts.deletions
    }
    changes.push({
      path: entry.path,
      oldPath: entry.oldPath || null,
      status: statusLetter(entry.xy),
      xy: entry.xy,
      untracked: entry.xy === '??',
      counts,
    })
  }

  return {
    ok: true,
    repo: {
      root,
      name: path.basename(root),
      branch: branchOut && !branchOut.startsWith('HEAD') ? branchOut.trim() : null,
      detached: Boolean(branchOut && branchOut.startsWith('HEAD')),
      head,
    },
    commits,
    changes,
    counts: {
      files: entries.length,
      additions: totalAdditions,
      deletions: totalDeletions,
    },
    truncated: entries.length > MAX_FILES,
    cwd,
  }
}

/**
 * Read one commit's patch.
 * @param {object} ctx plugin context.
 * @param {URLSearchParams} query request parameters.
 * @returns {Promise<object>} the commit payload.
 */
async function commitDetail(ctx, query) {
  const hash = query.get('hash') || ''
  if (!/^[0-9a-f]{4,40}$/i.test(hash)) {
    return { ok: false, error: 'Invalid commit id.' }
  }
  const { root } = await resolveCheckout(ctx, query)
  if (!root) return { ok: false, error: 'Not a git repository.' }

  const metaOut = await gitOrNull(root, ['show', '-s', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%ai%x1f%D%x1f%P%x1f%s%x1f%B', hash])
  if (!metaOut) return { ok: false, error: `Commit ${hash} was not found.` }
  const fields = splitFields(metaOut, '\x1f')
  if (fields.length < 9) return { ok: false, error: `Commit ${hash} was not readable.` }

  const parents = fields[6].split(' ').filter(Boolean)
  const patchCommand = parents.length > 1
    ? ['diff', '--no-color', '--no-ext-diff', '--patch', '--find-renames', parents[0], hash, '--']
    : ['show', '--no-color', '--no-ext-diff', '--patch', '--find-renames', '--format=', hash, '--']
  const patch = await gitOrNull(root, patchCommand)
  if (patch === null) return { ok: false, error: 'git could not read this commit\'s patch.' }
  const capped = capPatch(patch)
  const parsed = parsePatch(capped.text)
  const expanded = await expandCommitFiles(root, parsed.files)
  const files = [...expanded.direct, ...expanded.groups.flatMap((group) => group.files)]
  const truncated = capped.truncated || parsed.truncated || expanded.groups.some((group) => group.truncated)

  return {
    ok: true,
    commit: {
      hash: fields[0],
      short: fields[1],
      author: fields[2],
      email: fields[3],
      date: fields[4],
      refs: fields[5],
      parents,
      subject: fields[7],
      body: fields.slice(8).join('\x1f').trim(),
    },
    files,
    groups: expanded.groups,
    truncated,
  }
}

/**
 * Read the working tree's whole change against HEAD, plus untracked files as
 * additions.
 * @param {object} ctx plugin context.
 * @param {URLSearchParams} query request parameters.
 * @returns {Promise<object>} the working-tree payload.
 */
async function worktreeDetail(ctx, query) {
  const { root } = await resolveCheckout(ctx, query)
  if (!root) return { ok: false, error: 'Not a git repository.' }

  const base = await diffBase(root)
  const [patch, statusOut] = await Promise.all([
    gitOrNull(root, ['diff', base, '--no-color', '--no-ext-diff', '--patch', '--find-renames', '--']),
    gitOrNull(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  if (patch === null) return { ok: false, error: 'git could not read the working-tree diff.' }

  const capped = capPatch(patch)
  const parsed = parsePatch(capped.text)

  const entries = statusOut ? parseStatusZ(statusOut) : []
  const expanded = await worktreeGroups(root, parsed.files, entries)
  const files = [...expanded.direct, ...expanded.groups.flatMap((group) => group.files)]
  let truncated = capped.truncated || parsed.truncated || expanded.groups.some((group) => group.truncated)

  const untracked = entries.filter(entry => entry.xy === '??' && isSafeRelativePath(entry.path))
  for (const entry of untracked.slice(0, MAX_FILES)) {
    const pseudo = await untrackedPatch(root, entry.path)
    if (pseudo) files.push(pseudo)
    else truncated = true
  }
  if (untracked.length > MAX_FILES) truncated = true

  return { ok: true, files, groups: expanded.groups, truncated }
}

/** The empty tree object: the diff base of a repository with no first commit. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * Cut one patch to the byte budget without breaking the UTF-8 stream.
 * @param {string} text patch text.
 * @returns {{text: string, truncated: boolean}} capped text.
 */
function capPatch(text) {
  if (Buffer.byteLength(text) <= MAX_PATCH_BYTES) return { text, truncated: false }
  return { text: Buffer.from(text, 'utf8').subarray(0, MAX_PATCH_BYTES).toString('utf8'), truncated: true }
}

/** Resolve the diff base: `HEAD`, or the empty tree on an unborn branch. */
async function diffBase(root) {
  const head = await gitOrNull(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  return head ? 'HEAD' : EMPTY_TREE
}

/**
 * Read one file's text for the expanded in-panel view: the file at a commit
 * (including a submodule revision) or the current working-tree file.
 * @param {object} ctx plugin context.
 * @param {URLSearchParams} query request parameters.
 * @returns {Promise<object>} the file text, or why it cannot be read.
 */
async function fileContent(ctx, query) {
  const { root } = await resolveCheckout(ctx, query)
  if (!root) return { ok: false, error: 'Not a git repository.' }
  const relative = query.get('path') || ''
  if (!isSafeRelativePath(relative)) return { ok: false, error: 'Invalid file path.' }

  const sub = query.get('sub') || ''
  const subSha = query.get('subSha') || ''
  const hash = query.get('hash') || ''
  const base = query.get('base') || ''

  let dir = root
  let rel = relative.split('\\').join('/')
  const subPath = sub.split('\\').join('/')
  if (subPath && isSafeRelativePath(subPath) && rel.startsWith(`${subPath}/`)) {
    dir = path.join(root, subPath)
    rel = rel.slice(subPath.length + 1)
  } else if (base) {
    let baseStat = null
    try {
      baseStat = await fs.stat(base)
    } catch {
      baseStat = null
    }
    if (baseStat && baseStat.isDirectory()) dir = base
  }

  const rev = gitlinkSha(subSha) || (/^[0-9a-f]{4,40}$/i.test(hash) ? hash : '')
  if (rev) {
    const out = await gitOrNull(dir, ['show', `${rev}:${rel}`])
    if (out === null) return { ok: false, error: 'This file does not exist in that revision.' }
    if (Buffer.byteLength(out) > MAX_CONTENT_BYTES) {
      return { ok: true, text: out.slice(0, MAX_CONTENT_BYTES), truncated: true, binary: false, tooLarge: true }
    }
    return { ok: true, text: out, truncated: false, binary: false }
  }

  const absolute = path.join(dir, rel)
  let stat = null
  try {
    stat = await fs.stat(absolute)
  } catch {
    stat = null
  }
  if (!stat || !stat.isFile()) return { ok: false, error: 'This file is not in the working tree.' }
  if (stat.size > MAX_CONTENT_BYTES) return { ok: true, text: '', truncated: true, binary: false, tooLarge: true }
  const buffer = await fs.readFile(absolute)
  if (buffer.includes(0)) return { ok: true, text: '', truncated: false, binary: true }
  let text = buffer.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  return { ok: true, text, truncated: false, binary: false, mtimeMs: stat.mtimeMs }
}

/** Read one request body as text, bounded. */
function readRequestBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('Request body too large.'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

/**
 * Save one working-tree file for the in-panel editor, refusing a stale write.
 * @param {object} ctx plugin context.
 * @param {import('node:http').IncomingMessage} request inbound request.
 * @param {URLSearchParams} query request parameters.
 * @returns {Promise<object>} the saved mtime, or the failure reason.
 */
async function writeWorkingFile(ctx, request, query) {
  const { root } = await resolveCheckout(ctx, query)
  if (!root) return { ok: false, error: 'Not a git repository.' }
  const relative = query.get('path') || ''
  if (!isSafeRelativePath(relative)) return { ok: false, error: 'Invalid file path.' }

  const base = query.get('base') || ''
  let dir = root
  if (base) {
    let baseStat = null
    try {
      baseStat = await fs.stat(base)
    } catch {
      baseStat = null
    }
    if (baseStat && baseStat.isDirectory()) dir = base
  }
  const absolute = path.join(dir, relative)

  let body
  try {
    body = JSON.parse(await readRequestBody(request, 8 * 1024 * 1024))
  } catch (error) {
    return { ok: false, error: 'Invalid request body.' }
  }
  if (!body || typeof body.text !== 'string') return { ok: false, error: 'Missing file content.' }

  let stat = null
  try {
    stat = await fs.stat(absolute)
  } catch {
    stat = null
  }
  if (typeof body.expectedMtimeMs === 'number' && stat && Math.abs(stat.mtimeMs - body.expectedMtimeMs) > 1) {
    return { ok: false, conflict: true, error: 'The file changed on disk since it was loaded.' }
  }

  const temp = `${absolute}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temp, body.text, 'utf8')
    await fs.rename(temp, absolute)
  } catch (error) {
    try {
      await fs.unlink(temp)
    } catch {
      /* best effort */
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  const next = await fs.stat(absolute)
  return { ok: true, mtimeMs: next.mtimeMs }
}

/**
 * Resolve one repository-relative path for the editor handoff.
 * @param {object} ctx plugin context.
 * @param {URLSearchParams} query request parameters.
 * @returns {Promise<object>} existence and absolute path.
 */
async function fileInfo(ctx, query) {
  const { root } = await resolveCheckout(ctx, query)
  if (!root) return { ok: false, error: 'Not a git repository.' }
  const relative = query.get('path') || ''
  if (!isSafeRelativePath(relative)) return { ok: false, error: 'Invalid file path.' }
  const base = query.get('base') || ''
  let origin = root
  if (base) {
    let baseStat = null
    try {
      baseStat = await fs.stat(base)
    } catch {
      baseStat = null
    }
    if (baseStat && baseStat.isDirectory()) origin = base
  }
  const absolute = path.join(origin, relative)
  let stat = null
  try {
    stat = await fs.stat(absolute)
  } catch {
    stat = null
  }
  const isFile = Boolean(stat && stat.isFile())
  return {
    ok: true,
    exists: isFile,
    absolute,
    size: isFile ? stat.size : 0,
  }
}

/** Send one JSON response. */
function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

/**
 * Fold one recorded turn comparison into the same per-file shape the git
 * views use, computing old/new line numbers from the raw hunk lines.
 * @param {object} diff `WorkspaceFileDiff` from the recorder.
 * @returns {object} a FilePatch-shaped value.
 */
function normalizeWorkspaceDiff(diff) {
  if (!diff) return null
  if (diff.kind === 'binary') {
    return { path: diff.path, oldPath: null, status: 'M', binary: true, additions: 0, deletions: 0, hunks: [] }
  }
  if (diff.kind === 'oversized') {
    return { path: diff.path, oldPath: null, status: 'M', binary: false, oversized: true, additions: 0, deletions: 0, hunks: [] }
  }

  let additions = 0
  let deletions = 0
  const hunks = (diff.hunks || []).map((hunk) => {
    const lines = []
    let oldLine = Number(hunk.oldStart) || 0
    let newLine = Number(hunk.newStart) || 0
    for (const raw of hunk.lines || []) {
      const text = String(raw)
      const marker = text[0]
      if (marker === '+') {
        lines.push({ kind: 'add', old: null, new: newLine, text: text.slice(1) })
        newLine += 1
        additions += 1
      } else if (marker === '-') {
        lines.push({ kind: 'del', old: oldLine, new: null, newCursor: newLine, text: text.slice(1) })
        oldLine += 1
        deletions += 1
      } else if (marker === ' ') {
        lines.push({ kind: 'ctx', old: oldLine, new: newLine, text: text.slice(1) })
        oldLine += 1
        newLine += 1
      } else if (marker === '\\') {
        lines.push({ kind: 'meta', old: null, new: null, text })
      } else {
        lines.push({ kind: 'ctx', old: oldLine, new: newLine, text })
        oldLine += 1
        newLine += 1
      }
    }
    return {
      header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      section: '',
      lines,
    }
  })

  return {
    path: diff.path,
    oldPath: null,
    status: diff.after ? (diff.before ? 'M' : 'A') : 'D',
    binary: false,
    additions,
    deletions,
    hunks,
  }
}

/**
 * List the recorded per-turn change summaries for one Session.
 * @param {object} ctx plugin context.
 * @param {URLSearchParams} query request parameters.
 * @param {{turns: Map<string, {seq: number, turn?: number}[]>}} state plugin state.
 * @returns {Promise<object>} the turns payload.
 */
async function turnsList(ctx, query, state) {
  const sessionId = query.get('sessionId') || ''
  if (!sessionId) return { ok: true, turns: [], unavailable: false }
  const service = ctx.get('workspaceChanges')
  if (!service) return { ok: true, turns: [], unavailable: true }

  const stored = state.turns.get(sessionId) || []
  const turns = []
  for (const entry of stored) {
    let summary
    try {
      summary = service.summary(sessionId, entry.seq)
    } catch {
      summary = undefined
    }
    if (!summary) continue
    turns.push({
      seq: entry.seq,
      turn: summary.turn,
      total: summary.total,
      added: summary.added,
      deleted: summary.deleted,
      files: (summary.files || []).map((file, index) => ({
        index,
        path: file.path,
        display: file.display || file.path,
        added: file.added || 0,
        deleted: file.deleted || 0,
        binary: Boolean(file.binary),
        oversized: Boolean(file.oversized),
      })),
    })
  }
  return { ok: true, turns, unavailable: false }
}

/**
 * Read one recorded file comparison from one turn.
 * @param {object} ctx plugin context.
 * @param {URLSearchParams} query request parameters.
 * @returns {Promise<object>} the comparison payload.
 */
async function turnDiff(ctx, query) {
  const sessionId = query.get('sessionId') || ''
  const seq = Number(query.get('seq'))
  const index = Number(query.get('index'))
  if (!sessionId || !Number.isSafeInteger(seq) || !Number.isSafeInteger(index) || index < 0) {
    return { ok: false, error: 'Invalid turn coordinates.' }
  }
  const service = ctx.get('workspaceChanges')
  if (!service) return { ok: false, error: 'Workspace change recording is unavailable in this Host.' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const diff = await service.diff(sessionId, seq, index, controller.signal)
    if (!diff) return { ok: false, error: 'This recorded change is no longer available.' }
    return { ok: true, diff: normalizeWorkspaceDiff(diff) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Dispatch one request for this plugin's route prefix.
 * @param {object} ctx plugin context.
 * @param {{turns: Map<string, {seq: number, turn?: number}[]>}} state plugin state.
 * @param {import('node:http').IncomingMessage} request inbound request.
 * @param {import('node:http').ServerResponse} response outbound response.
 * @returns {Promise<void>} resolution after the response ends.
 */
async function handle(ctx, state, request, response) {
  const method = request.method || 'GET'

  let url
  try {
    url = new URL(request.url || '/', 'http://localhost')
  } catch {
    sendJson(response, 400, { ok: false, error: 'Malformed request URL.' })
    return
  }
  const action = url.pathname.slice(ROUTE.length).replace(/^\/+/, '')

  if (method === 'POST') {
    let payload
    try {
      if (action === 'write') payload = await writeWorkingFile(ctx, request, url.searchParams)
      else payload = { ok: false, error: `Unsupported action: ${action || '(none)'}` }
    } catch (error) {
      payload = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    sendJson(response, 200, payload)
    return
  }

  if (method !== 'GET' && method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD, POST' })
    response.end()
    return
  }
  if (method === 'HEAD') {
    response.writeHead(200, { 'cache-control': 'no-store' })
    response.end()
    return
  }

  let payload
  try {
    if (action === 'snapshot') payload = await snapshot(ctx, url.searchParams)
    else if (action === 'commit') payload = await commitDetail(ctx, url.searchParams)
    else if (action === 'worktree') payload = await worktreeDetail(ctx, url.searchParams)
    else if (action === 'turns') payload = await turnsList(ctx, url.searchParams, state)
    else if (action === 'turn') payload = await turnDiff(ctx, url.searchParams)
    else if (action === 'file') payload = await fileInfo(ctx, url.searchParams)
    else if (action === 'content') payload = await fileContent(ctx, url.searchParams)
    else payload = { ok: false, error: `Unknown action: ${action || '(none)'}` }
  } catch (error) {
    payload = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  sendJson(response, 200, payload)
}

/**
 * Activate the Host half: the read-only route plus the per-turn change feed.
 * @param {object} ctx plugin context.
 */
export function apply(ctx) {
  const state = { turns: new Map() }

  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        if (!event || event.type !== 'workspace/changes') return
        const seq = typeof event.seq === 'number' ? event.seq : undefined
        const sessionId = session && session.id
        if (seq === undefined || !sessionId) return
        const data = event.data || {}
        const turn = Number.isSafeInteger(data.turn) ? data.turn : undefined
        const list = state.turns.get(sessionId) || []
        if (list.some((entry) => entry.seq === seq)) return
        list.unshift({ seq, turn })
        if (list.length > MAX_TURNS) list.length = MAX_TURNS
        state.turns.set(sessionId, list)
        if (state.turns.size > 64) {
          const oldest = state.turns.keys().next().value
          if (oldest !== sessionId) state.turns.delete(oldest)
        }
      }),
    'code-review: per-turn change feed',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: (request, response) => handle(ctx, state, request, response),
      }),
    'code-review: git route',
  )
}
