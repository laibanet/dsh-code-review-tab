import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const probe = path.join(tmpdir(), `crv-buffer-${process.pid}.mjs`)
writeFileSync(probe, `${source}\n;globalThis.__crvTest = { buildEditBuffer, stripGhostRows, GHOST_MARK, inferFenceSource }\n`, 'utf8')
globalThis.window = { __ModuleLoader__: { load() {} } }
await import(new URL(`file://${probe.replace(/\\/g, '/')}`).href)
rmSync(probe, { force: true })

const { buildEditBuffer, stripGhostRows, GHOST_MARK, inferFenceSource } = globalThis.__crvTest

assert.equal(inferFenceSource('diff', '', '--- a/x\n+++ b/src/demo.ts\n@@ -1 +1 @@\n-a\n+b'), 'src/demo.ts')
assert.equal(inferFenceSource('ts', 'path=src/app.ts', 'const a = 1'), 'src/app.ts')
assert.equal(inferFenceSource('ts', 'title="src/app.ts"', 'const a = 1'), 'src/app.ts')
assert.equal(inferFenceSource('ts', '', '// src/first.ts\nconst a = 1'), 'src/first.ts')
assert.equal(inferFenceSource('ts', '', 'const a = 1'), '')
assert.equal(inferFenceSource('ts', 'https://example.com/a.ts', 'x'), '')

const file = {
  hunks: [
    {
      lines: [
        { kind: 'ctx', text: 'a' },
        { kind: 'del', text: 'old-b', newCursor: 2 },
        { kind: 'add', text: 'new-b', new: 2 },
        { kind: 'ctx', text: 'c' },
      ],
    },
  ],
}
const buffer = buildEditBuffer('a\nb\nc\n', file)
const lines = buffer.split('\n')
assert.equal(lines[0], 'a')
assert.equal(lines[1], `${GHOST_MARK}old-b`)
assert.equal(lines[2], 'b')
assert.equal(lines[3], 'c')
assert.equal(stripGhostRows(buffer), 'a\nb\nc\n')

const fileEnd = { hunks: [{ lines: [{ kind: 'del', text: 'gone', newCursor: 4 }] }] }
const endBuffer = buildEditBuffer('a\nb\nc\n', fileEnd)
const endLines = endBuffer.split('\n')
assert.equal(endLines[3], `${GHOST_MARK}gone`)
assert.equal(stripGhostRows(endBuffer), 'a\nb\nc\n')

// Editing a real line keeps the ghost rows out of the saved text.
const edited = buffer.replace('c\n', 'c2\n')
assert.equal(stripGhostRows(edited), 'a\nb\nc2\n')

// Deleting a ghost row entirely is safe: it is not part of the content.
const withoutGhost = buffer.split('\n').filter((line) => !line.startsWith(GHOST_MARK)).join('\n')
assert.equal(withoutGhost, 'a\nb\nc\n')

console.log('BUFFER PASS')
