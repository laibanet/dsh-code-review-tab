# Code changes

A review panel that answers two questions without leaving the conversation:

1. **What did this git commit change, line by line?**
2. **What did the agent (or anyone) just change in my working tree?**

It offers three views: **未提交** (the working tree against `HEAD`), **提交**
(recent commits) and **本会话** (the per-turn changes the Host recorded for this
conversation).

## Where it lives

The browser half registers a **代码改动 / Changes** button in the composer
(`conversation.input.left`, a core client slot). Clicking it opens a tab in
DSH's **native right Sidebar** (`ctx.sidebarRight.openTab`), registered through
the native tab-type registry (`ctx.sidebarRightTabs`) plus the
`sidebar.right.pane.tab` body slot. The right column therefore makes room for
itself and shrinks the conversation instead of covering it, and the tab strip's
own close control closes it.

When the host has no native right Sidebar (a build without `sidebarRight`), the
button falls back to a fixed drawer rendered in `shell.overlay`; that drawer has
its own close button.

## This-session view

The Host subscribes to the Session log's `workspace/changes` events and keeps,
per Session, one entry per Turn that edited files. The view lists those entries
newest first as **第 N 轮** headers with their file count and total `+`/`-`.

Selecting a file asks the Host for that Turn's recorded comparison
(`workspaceChanges.diff`) and renders it with the same diff renderer as the git
views. The comparison is the file at turn start versus turn end, so it shows
exactly what the agent changed in that Turn, independently of later commits.

Recording starts when this plugin loads: Turns that ran before the Host started
are not in the list. The working-tree and commit views still cover those files.

## Working tree view

Shows every path `git status` reports with its status letter (`M` modified,
`A` added, `D` deleted, `R` renamed, `?` untracked) and its added/deleted line
counts.

Selecting a file renders that file's full diff against `HEAD` — staged and
unstaged changes together, which is exactly the state an agent edit leaves
behind before you commit it. Untracked files are shown as all-added patches.

Submodule checkouts are expanded too: a moved pointer shows the submodule's
commits and inner file diffs, and a submodule whose pointer did not move but
whose working tree has edits (the usual case when an agent edits code inside
`src/navigation`-style submodules) appears as its own group with those files.

While the tab is visible it refreshes the working-tree diff every 8 seconds and
the commit/branch header every 24 seconds, so agent edits appear on their own.
It stops refreshing when the tab is not visible.

## Commit view

The **提交 / Commits** list shows the 40 most recent commits with short hash,
subject, author, date and ref decorations.

Selecting a commit loads its full patch and lists that commit's changed files
with per-file counts. Selecting a file renders its hunks. A merge commit is
shown against its first parent, so it does not appear empty.

**Submodule changes are expanded.** When a commit moves a submodule pointer,
the tab reads the submodule repository itself and shows a group header (path +
commit count) with that submodule's own commits and its real file-level diff,
so a pointer-only commit still reveals which file and which line changed.

## Edit in place

**Double-click any diff line** (or the file header's **编辑 / Edit** button) to
open that file right here in an editable view: the changed lines keep their
green highlight, deleted lines appear **inline as red read-only rows** exactly
where they were removed (with the original text), the line numbers run down the
left, and a slim **change bar** on the right maps every changed line onto the
whole file (click a mark, or anywhere on the bar, to scroll there). It scrolls
to the line you double-clicked and puts the caret there.

Those red rows are display-only: they are stripped from the buffer before it is
written, so saving never re-adds deleted code. The change bar marks additions in
green on its left half and deletions in red on its right half. Hold **Ctrl** and
scroll to zoom the editor text (or use **A− / A+** in the status bar); the zoom
keeps the top line in place. Type directly in the panel;
**Ctrl+S** (or **保存 / Save**) writes the file. The write is refused when the
file changed on disk since it was loaded, and a conflict message explains why. The editable view always loads the
**working-tree** file, so opening a line from a historical commit edits the
current file at the corresponding line (the highlight still follows that
commit's line numbers). Binary and oversized files are not editable and say so.
Leave editing with the header **关闭 / Close** button or **Escape**; unsaved
changes ask for confirmation first.

### Float, fullscreen and resize

The edit header also offers **浮窗 / Float** and **全屏 / Fullscreen**. Both move
the editor into a **non-modal** window above the app, so the rest of DeepSeek
Harness stays usable while it is open. Float mode is dragged by its title bar
and resized from the right edge, the bottom edge or the bottom-right grip;
fullscreen expands to the app content with a small top gap, leaving the app's
title bar reachable. Every window has a **最小化 / Minimize** button that
collapses it to a small floating bar, and **Escape** docks it. The change bar
and its marks stay inside the window, so the green highlights never disappear.

The window lives inside the DeepSeek Harness page; a plugin cannot detach it
into a separate operating-system window. The header's **展开 / Expand**
button is a separate read-only preview toggle, so the two controls never do the
same thing.

The read-only **展开 / Expand** preview (whole file with ghosts for deleted
lines) remains available next to it.

## Diff rendering

Each hunk is a header row (`@@ -a,b +c,d @@`) followed by lines rendered in
three states:

- **added** — green tint, `+` marker, new line number only;
- **deleted** — red tint, `-` marker, old line number only;
- **context** — unchanged, both line numbers.

Colors are derived from the host's `--dsw-alias-state-success-primary` and
`--dsw-alias-state-error-primary` theme tokens with `color-mix`, so the panel
follows light and dark themes.

## How the data is read

The browser half never runs git. The Host half registers one read-only route
(`/api/code-review`) on the Web carrier and answers five actions:

- `snapshot` — branch, HEAD, recent commits, changed files, totals;
- `commit&hash=` — one commit's metadata and parsed patch;
- `worktree` — the working tree's parsed patch against `HEAD`;
- `turns&sessionId=` — this Session's recorded per-turn summaries;
- `turn&sessionId=&seq=&index=` — one recorded file comparison from one turn;
- `file&path=&base=` — whether a path exists in the working tree and its
  absolute location for the editor handoff;
- `content&path=&base=&hash=&sub=&subSha=` — one file's text, from the working
  tree or from a commit/submodule revision.

Git is invoked with `execFile` (no shell), read-only commands only
(`rev-parse`, `log`, `status`, `show`, `diff`, `submodule status`, `ls-tree`),
`core.quotepath=false` so non-ASCII paths render as-is, and a 20-second timeout
per command. Submodule expansion runs the same read-only commands inside the
submodule's own checkout.

## Chat code blocks

The tab also registers a language-agnostic layer around every Markdown fence in
the conversation flow. When the fence names a file — a `path=` / `file=` /
`title=` metadata token, a `+++ b/...` header inside a diff, or a first-line
comment such as `// src/file.ts` — the fence grows a slim header with the
language, the inferred path, and an **打开 / Open** button that opens the file in
`dsh-better-sidebar`'s editor at line 1 when that plugin is installed. Without
it the path is still shown, and the button reports that the editor is
unavailable.

## Limits

- **Read-only.** This tab never stages, commits, reverts, or writes files.
- **Per-turn records are live-process only.** The Host keeps at most 300 turns
  per Session and drops them when the Host restarts; it does not re-read
  historical `workspace/changes` events.
- **Working tree is against `HEAD`.** It shows the cumulative uncommitted
  state, not one turn's slice; use the this-session view for per-turn changes.
- **Bounded output.** At most 400 changed files, 4 MiB of patch text and 8 000
  diff lines are returned; beyond that the panel says the result was truncated.
  Untracked files above 512 KiB are summarized instead of line-diffed. The same
  caps apply per submodule expansion.
- **Submodule expansion needs local data.** The submodule must be initialized
  in the checkout and the pointer's commits must exist in its local object
  database; otherwise the group header explains why its files are unavailable.
  Submodule paths must be directories this process can read.
- **Binary files** show a notice instead of a diff.
- **Requires** `git` on `PATH` and a session whose working directory is inside
  a git repository. Outside a repository the git views explain the state
  instead of failing; the this-session view still works from the recorder.
- **Requires `dsh-better-sidebar`.** This bundle injects that plugin's client
  service; without it the tab is not registered.
- **Same-origin and read-only.** The route is served by the same Web carrier as
  the GUI and sits behind its Host-header trust fence. It exposes no write
  operation and no credential; it only reports git state of the session's
  working directory. Like other sidebar plugins it does not add an extra
  workspace-containment check on the path it is asked about.
