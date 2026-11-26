# dsh-code-review-tab

[中文](#中文) · **English**

A DeepSeek Harness plugin that adds a line-level code review panel to the native
right sidebar: git commits, the working tree, and the changes the agent just made
in this conversation.

---

## 中文

一个 DeepSeek Harness 插件：在**原生右侧栏**里提供逐行代码审阅面板，覆盖 Git 提交、未提交工作区，以及本轮对话中 Agent 刚改过的代码。

### 功能

- **原生右侧栏标签页**：从输入框的 **代码改动** 按钮打开，右侧栏会占一列、让对话区自动变窄，而不是盖住界面。
- **未提交**：相对 `HEAD` 的所有未提交改动，也就是 Agent 改完还没提交的状态。
- **提交**：最近 40 个提交，含改动文件与完整 patch。
- **最近改动**：按时间倒序的最近几轮改动，**跨会话**（非当前会话会标注会话 id），来自各 Session 的 `workspace/changes` 事件；每轮会自动**落盘**到 `~/.dsh/code-review-history/`，重启后仍可查看（每会话保留最近 40 轮）。
- **子模块自动展开**：只 bump 了 `src/navigation` 的提交，会展开成子模块自己的提交和真实文件 diff，而不是两行 `Subproject commit` 指针。
- **右侧改动条**：左半绿色新增、右半红色删除，点击可跳转。
- **就地编辑**：双击任意 diff 行（或点 **编辑**）直接在面板里改文件——新增行保持绿色、删除行以红色只读行内联显示原文，行号和改动条都在。`Ctrl+S` 保存（带文件被外部修改的冲突保护），`Ctrl+滚轮` 缩放字号，编辑框还可浮窗拖动/改大小或全屏。
- **聊天代码块带来源**：如果代码块能推断出文件（diff 头、`path=` 元信息、或首行 `// 路径` 注释），上方会显示路径和 **打开** 按钮。

### 环境要求

- DeepSeek Harness **0.2.1-rc.1 或更新**（用到核心客户端服务 `locale`、`slots`、`sidebarRight` / `sidebarRightTabs`）。
- **不需要任何其他插件**，也没有 npm 运行时依赖（Host 端只用 Node 内置模块）。
- 可选：`dsh-better-sidebar`。装了它时，聊天代码块的 **打开** 会调用它的编辑器；没装则只显示推断出的来源路径。

### 安装

从 Git 安装（现在就能用）：

```sh
dsh plugin --profile web add git+https://github.com/laibanet/dsh-code-review-tab.git
```

或者在 [Releases](https://github.com/laibanet/dsh-code-review-tab/releases) 下载
`dsh-code-review-tab-2.5.0.tgz`，用插件管理器安装。

安装后硬刷新浏览器（`Ctrl+Shift+R`），输入框左侧会出现 **代码改动** 按钮。

### 使用

1. 点输入框左侧 **代码改动**，原生右侧栏打开审阅标签页；
2. 选 **未提交** / **提交** / **最近改动**，再选文件；
3. 双击 diff 行即可就地编辑，`Ctrl+S` 保存；点 **关闭**（或按 `Esc`）回到 diff。

### 开发与测试

```sh
node test/buffer.test.mjs        # 幽灵行缓冲 + 代码块来源推断
node test/host.test.mjs          # Host 路由（临时 git 仓库）
DSH_PROFILE_DIR=<profile> node test/client.test.mjs   # 工厂、槽位、locale
```

### 目录结构

```text
index.js            Host 端（只读 /api/code-review 路由 + 每轮改动记录）
client.js           浏览器端（原生标签页、编辑器、聊天代码块层）
cordis.patch.yml    bundle patch
locale/{en,zh}.json 插件管理器里的标题/描述
docs/DETAIL.md      行为、限制、git 命令
icon.svg            插件图标
```

### 许可证

MIT，见 [LICENSE](LICENSE)。

---

## English

### Features

- **Native right-sidebar tab** — opened from the composer's **代码改动 / Changes**
  button. The right column makes room for itself instead of covering the chat.
- **Working tree** — every uncommitted change against `HEAD`, i.e. what an agent
  edit leaves behind before anyone commits it.
- **Commits** — the 40 most recent commits, each with its changed files and full
  patch.
- **Recent changes** — the latest recorded turns in reverse order, **across
  sessions** (another session's short id is shown). Each turn is persisted to
  `~/.dsh/code-review-history/`, so the list survives a restart (last 40 turns
  per session).
- **Submodules are expanded** — a commit that only bumps `src/navigation` is
  shown as that submodule's own commits plus its real file/line diff, not as a
  two-line `Subproject commit` pointer.
- **Change bar (minimap)** — green additions on its left half, red deletions on
  its right half; click a mark to jump.
- **Edit in place** — double-click any diff line (or the **编辑 / Edit** button)
  to edit the file right in the panel: added lines stay green, deleted lines
  appear inline as red read-only rows with their original text, and line numbers
  and the change bar stay. `Ctrl+S` saves with a stale-write guard; `Ctrl+wheel`
  zooms; the editor can float as a draggable/resizable window or go fullscreen.
- **Chat code blocks carry their source** — fences that name a file (diff
  headers, `path=` metadata, or a leading `// path` comment) get a header with
  the inferred path and an **打开 / Open** action.

### Requirements

- DeepSeek Harness **0.2.1-rc.1 or newer** (uses the core client services
  `locale`, `slots` and `sidebarRight`/`sidebarRightTabs`).
- **No other plugin is required** and there are no npm runtime dependencies
  (the Host half uses Node built-ins only).
- Optional: `dsh-better-sidebar`. When installed, the chat-fence **Open** action
  opens the file in its editor; without it the inferred source path is still
  shown.

### Install

From Git (works today):

```sh
dsh plugin --profile web add git+https://github.com/laibanet/dsh-code-review-tab.git
```

Or download `dsh-code-review-tab-2.5.0.tgz` from
[Releases](https://github.com/laibanet/dsh-code-review-tab/releases) and install
it through the Plugin Manager.

Then hard-refresh the browser (`Cmd/Ctrl+Shift+R`). A **代码改动 / Changes**
button appears in the composer.

### Usage

1. Click **代码改动 / Changes** in the composer; the native right sidebar opens
   with the review tab.
2. Pick **未提交 / Working tree**, **提交 / Commits** or **最近改动 / Recent changes**,
   then a file.
3. Double-click a diff line to edit that file in place; `Ctrl+S` saves, **关闭 /
   Close** (or `Esc`) returns to the diff.

### Development

```sh
node test/buffer.test.mjs        # ghost-row buffer helpers + fence source inference
node test/host.test.mjs          # host route against a throwaway git repository
DSH_PROFILE_DIR=<profile> node test/client.test.mjs   # factory, slots, locale
```

### Layout

```text
index.js            host half (read-only /api/code-review route + per-turn feed)
client.js           browser half (native tab, editor, chat fence layer)
cordis.patch.yml    bundle patch
locale/{en,zh}.json plugin title/description for the Plugin Manager
docs/DETAIL.md      behavior, limits, git commands
icon.svg            plugin icon
```

### License

MIT — see [LICENSE](LICENSE).

