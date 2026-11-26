# dsh-code-review-tab

A DeepSeek Harness bundle that adds a **Code changes** (代码改动) panel: a
button in the composer opens a review drawer with line-level git diffs for

- **未提交 / Working tree** — every uncommitted change against `HEAD`, which is
  what an agent edit leaves behind before anyone commits it;
- **提交 / Commits** — the 40 most recent commits, each with its changed files
  and full patch;
- **本会话 / This session** — the per-turn file changes the Host recorded for the
  current conversation, read from the Session's `workspace/changes` events.

Each changed file is drawn as hunks with old/new line numbers, green additions
and red deletions, using the host's theme tokens.

**Submodules are expanded**: a commit that only bumps `src/navigation` (or a
dirty submodule checkout) is shown as that submodule's own commits plus its
real file/line diff, not as a two-line `Subproject commit` pointer.

**Chat code blocks carry their source**: code fences that name a file (diff
headers, `path=` metadata, or a leading `// path` comment) get a header with the
inferred path and an Open action that jumps to that file in the sidebar editor.

Also: **double-click to edit in place**: double-click a diff line to open the file
right in the panel — added lines stay green, deleted lines appear inline as red
read-only rows with their original text, and the change bar stays on the right.
Ctrl+S saves (ghost rows are stripped, with a conflict guard); Esc or Close
returns to the diff. The editor can also **float** as a draggable, resizable
window or go **fullscreen**, then dock back with one click.

- Host half: a read-only `/api/code-review` JSON route over the Web carrier
  (`execFile` git, no shell).
- Browser half: a composer button (`conversation.input.left`) that opens a fixed
  review drawer, plus a language-agnostic Markdown-fence layer that adds each
  code block's inferred source.

See [docs/DETAIL.md](docs/DETAIL.md) for behavior, limits, and the exact git
commands used.

## Requirements

- DeepSeek Harness **0.2.1-rc.1 or newer** (uses the core client services
  `locale` and `slots`).
- **No other plugin is required** and there are no npm runtime dependencies
  (the Host half uses Node built-ins only).
- Optional: `dsh-better-sidebar`. When it is installed, the chat-fence **Open**
  action opens the file in its editor; without it the inferred source path is
  still shown.

## Install

```sh
dsh plugin --profile web add dsh-code-review-tab@2.1.0
```

Then hard-refresh the browser (Cmd/Ctrl+Shift+R). A **代码改动 / Changes**
button appears in the composer; it opens the review tab in DSH's native right
sidebar, which makes room for itself instead of covering the conversation. On a
host without the native right sidebar the button falls back to a floating
drawer.

Updating: re-run the add command with the new version and hard-refresh.

### Install from this checkout

```text
plugin_manager install_bundle  target: <absolute path to a packed .tgz of this directory>
```

The bundle is inserted as the Loader row `code-review-tab`. Refreshing the GUI
page loads the current browser half.

## Publish

`npm pack` produces the installable artifact; the `files` list keeps the package
small. For a public repository, set `private: false` (already set), pick a
license, and install from Git with:

```sh
dsh plugin --profile web add git+https://github.com/<you>/dsh-code-review-tab.git
```

If the package name must be scoped (`@you/dsh-code-review-tab`), also update the
factory id inside `client.js` (`window.__ModuleLoader__.load({ id: ... })`) to
match the package name.

## Layout

```text
index.js           host half (route + per-turn feed)
client.js          browser half (tab registration + UI)
cordis.patch.yml   bundle patch
locale/{en,zh}.json  plugin title/description for Plugin Manager
docs/DETAIL.md     behavior and limits
icon.svg           plugin icon
```
