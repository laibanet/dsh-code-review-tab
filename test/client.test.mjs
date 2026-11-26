import { createRequire } from 'node:module'
import path from 'node:path'
import assert from 'node:assert/strict'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      captured = registration
    },
  },
}

const profileDir = process.env.DSH_PROFILE_DIR || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'profiles', 'desktop')
const require = createRequire(path.join(profileDir, 'node_modules', 'noop.js'))
const React = require('react')

await import(new URL('../client.js', import.meta.url).href)

assert.ok(captured, 'client bundle registered a factory')
assert.equal(captured.id, 'dsh-code-review-tab')
assert.equal(typeof captured.factory, 'function')

const plugin = captured.factory((spec) => {
  assert.equal(spec, 'react')
  return React
})
assert.ok(plugin && typeof plugin.apply === 'function', 'factory returns a plugin')
assert.deepEqual(plugin.inject, ['locale', 'slots'])

const dictionaries = {}
const zh = {}
const en = {}
const locale = {
  register(ns, id, dict) {
    dictionaries[`${ns}:${id}`] = dict
    if (id === 'zh') Object.assign(zh, dict)
    else Object.assign(en, dict)
    return () => {}
  },
  bind() {
    return (key) => zh[key] || en[key] || key
  },
}
const registered = []
const nativeTabs = {
  register() {
    return () => {}
  },
}
const ctx = {
  effect(fn) {
    return fn()
  },
  get(name) {
    if (name === 'locale') return locale
    if (name === 'sidebarRightTabs') return nativeTabs
    return undefined
  },
  slots: {
    inject(name, factory) {
      return factory()
    },
    register(value, component) {
      registered.push({ value, component })
      return () => {}
    },
  },
}
plugin.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 350))

assert.equal(registered.length, 5, 'fence, launcher, drawer and the two native tab slots are registered')
const fence = registered.find((entry) => entry.value.name === 'conversation.chat.markdown.fence')
const launcher = registered.find((entry) => entry.value.name === 'conversation.input.left')
const drawer = registered.find((entry) => entry.value.name === 'shell.overlay')
const nativeBody = registered.find((entry) => entry.value.name === 'sidebar.right.pane.tab')
const nativeTitle = registered.find((entry) => entry.value.name === 'sidebar.right.pane.tab.title')
assert.ok(fence, 'fence layer registered')
assert.equal(fence.value.id, 'dsh-code-review:fence-source')
assert.equal(fence.value.order, -100)
assert.ok(launcher, 'composer launcher registered')
assert.equal(launcher.value.id, 'dsh-code-review:launcher')
assert.equal(typeof launcher.component, 'function')
assert.ok(drawer, 'overlay drawer registered')
assert.equal(drawer.value.id, 'dsh-code-review:drawer')
assert.equal(typeof drawer.component, 'function')
assert.ok(nativeBody, 'native right-sidebar body registered')
assert.equal(nativeBody.value.key, 'dsh-code-review-tab')
assert.equal(typeof nativeBody.value.inject, 'function')
assert.deepEqual(nativeBody.value.inject('s1'), { sessionId: 's1' })
assert.ok(nativeTitle, 'native right-sidebar chip title registered')
assert.equal(nativeTitle.value.key, 'dsh-code-review-tab')

assert.ok(dictionaries['dsh-code-review:zh'], 'zh dictionary registered')
assert.ok(dictionaries['dsh-code-review:en'], 'en dictionary registered')
assert.equal(zh['tab.title'], '\u4ee3\u7801\u6539\u52a8')
assert.equal(zh['launcher.label'], '\u4ee3\u7801\u6539\u52a8')

console.log('CLIENT PASS', JSON.stringify({ fences: fence.value.id, launcher: launcher.value.id }))
