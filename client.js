/**
 * Browser half: registers the "Code changes" tab into the right sidebar
 * (through the better-sidebar service) and renders git diffs fetched from this
 * package's own Host route.
 */

const NS = 'dsh-code-review'
const PLUGIN_VERSION = '2.1.0'
/** Zero-width marker that prefixes a read-only deleted-line row in the editor buffer. */
const GHOST_MARK = '\u200B'

/** Build the editable buffer: the file text with deleted lines inserted as ghost rows. */
function buildEditBuffer(text, file) {
  const lines = text.split('\n')
  const insertions = new Map()
  for (const hunk of file.hunks || []) {
    for (const line of hunk.lines || []) {
      if (line.kind !== 'del' || line.newCursor === null || line.newCursor === undefined) continue
      const at = Math.max(1, line.newCursor)
      if (!insertions.has(at)) insertions.set(at, [])
      insertions.get(at).push(line.text)
    }
  }
  const output = []
  for (let number = 1; number <= lines.length; number += 1) {
    const deleted = insertions.get(number)
    if (deleted) deleted.forEach((value) => output.push(GHOST_MARK + value))
    output.push(lines[number - 1])
  }
  const tail = insertions.get(lines.length + 1)
  if (tail) tail.forEach((value) => output.push(GHOST_MARK + value))
  return output.join('\n')
}

/** Remove the read-only ghost rows before writing the file. */
function stripGhostRows(text) {
  return text
    .split('\n')
    .filter((line) => !line.startsWith(GHOST_MARK))
    .join('\n')
}

/** How many content (non-ghost) lines precede one draft row. */
function contentLinesBefore(lines, rowIndex) {
  let count = 0
  for (let index = 0; index < rowIndex && index < lines.length; index += 1) {
    if (!lines[index].startsWith(GHOST_MARK)) count += 1
  }
  return count
}

const DICT_ZH = {
  'tab.title': '代码改动',
  'tab.description': '逐行查看 Git 提交与未提交改动',
  'mode.worktree': '未提交',
  'mode.commits': '提交',
  'mode.turns': '本会话',
  'action.refresh': '刷新',
  'action.back': '返回',
  'action.retry': '重试',
  'action.edit': '编辑',
  'action.editAt': '在第 {n} 行编辑',
  'action.dblclickEdit': '双击编辑',
  'action.expand': '展开',
  'action.collapse': '收起',
  'action.dblclickExpand': '双击展开',
  'action.dblclickCollapse': '双击收起',
  'action.save': '保存',
  'action.saving': '保存中…',
  'action.exitEdit': '退出编辑',
  'action.closeEdit': '关闭',
  'action.float': '浮窗',
  'action.dock': '停靠',
  'action.minimize': '最小化',
  'action.fullscreen': '全屏',
  'action.restore': '还原',
  'fence.open': '打开',
  'fence.missing': '工作区里没有这个文件',
  'fence.unavailable': '编辑器不可用',
  'launcher.label': '代码改动',
  'action.resize': '拖动调整大小',
  'state.loading': '正在读取…',
  'state.emptyWorktree': '工作区没有未提交的改动',
  'state.emptyWorktreeHint': 'DSH 修改文件后，改动会出现在这里。',
  'state.emptyCommits': '没有提交记录',
  'state.commitsLimit': '只显示最近 {n} 个提交',
  'state.emptyTurns': '本会话还没有记录到改动',
  'state.emptyTurnsHint': 'DSH 每改完一轮文件，这里会出现一条记录。',
  'state.turnsUnavailable': '当前 Host 没有提供改动记录',
  'state.noRepo': '当前目录不是 Git 仓库',
  'state.noRepoHint': '打开一个 Git 仓库中的会话后再查看。',
  'state.selectFile': '选择一个文件查看逐行差异',
  'state.binary': '二进制文件，无法显示逐行差异',
  'state.oversized': '文件过大，已省略逐行差异',
  'state.truncated': '结果已截断，请在终端查看完整差异',
  'state.commitMissing': '没有找到这次提交的改动',
  'state.fileMissing': '该文件在当前工作区不存在（可能已删除或未检出）',
  'state.editorUnavailable': '当前环境没有可用的编辑器标签页',
  'state.editorDisabled': '右侧栏的「编辑器」标签已禁用，请在侧栏设置中启用',
  'state.openedInEditor': '已发送到编辑器：{path} 第 {n} 行',
  'state.fileTooLarge': '文件过大，无法在面板内展开',
  'state.unsaved': '未保存',
  'state.saved': '已保存',
  'state.editing': '编辑中',
  'state.editorDetached': '编辑窗口已浮出，使用浮窗中的按钮停靠或关闭',
  'state.savedFile': '已保存改动',
  'state.confirmDiscard': '有未保存的修改，确定退出编辑吗？',
  'state.editAlignNote': '按提交行号高亮；当前工作区文件可能已变化',
  'label.detached': '分离头指针',
  'label.files': '个文件',
  'label.filesOne': '个文件',
  'label.turn': '第 {n} 轮',
  'label.turnFiles': '{n} 个文件',
  'label.submoduleCommits': '{n} 个提交',
  'label.submoduleFiles': '{n} 个文件',
  'label.dirtySubmodule': '子模块内有未提交修改',
  'label.expandLegend': '绿色=本次新增行，红色=被删除的行；双击某行可在编辑器中打开',
  'label.minimap': '右侧色条标出改动位置，点击跳转',}

const DICT_EN = {
  'tab.title': 'Code changes',
  'tab.description': 'Review line-level diffs of commits and uncommitted edits',
  'mode.worktree': 'Working tree',
  'mode.commits': 'Commits',
  'mode.turns': 'This session',
  'action.refresh': 'Refresh',
  'action.back': 'Back',
  'action.retry': 'Retry',
  'action.edit': 'Edit',
  'action.editAt': 'Edit at line {n}',
  'action.dblclickEdit': 'Double-click to edit',
  'action.expand': 'Expand',
  'action.collapse': 'Collapse',
  'action.dblclickExpand': 'Double-click to expand',
  'action.dblclickCollapse': 'Double-click to collapse',
  'action.save': 'Save',
  'action.saving': 'Saving…',
  'action.exitEdit': 'Exit editing',
  'action.closeEdit': 'Close',
  'action.float': 'Float',
  'action.dock': 'Dock',
  'action.minimize': 'Minimize',
  'action.fullscreen': 'Fullscreen',
  'action.restore': 'Restore',
  'fence.open': 'Open',
  'fence.missing': 'This file is not in the workspace',
  'fence.unavailable': 'The editor is unavailable',
  'launcher.label': 'Changes',
  'action.resize': 'Drag to resize',
  'state.loading': 'Loading…',
  'state.emptyWorktree': 'No uncommitted changes',
  'state.emptyWorktreeHint': 'Edits the agent makes appear here until they are committed.',
  'state.emptyCommits': 'No commits yet',
  'state.commitsLimit': 'Showing the latest {n} commits',
  'state.emptyTurns': 'No recorded changes in this session yet',
  'state.emptyTurnsHint': 'Each turn that edits files adds one entry here.',
  'state.turnsUnavailable': 'Change recording is not available on this Host',
  'state.noRepo': 'This directory is not a git repository',
  'state.noRepoHint': 'Open a session whose working directory is inside a git repository.',
  'state.selectFile': 'Pick a file to see its line-level diff',
  'state.binary': 'Binary file — no line-level diff to show',
  'state.oversized': 'File too large — the line-level diff was omitted',
  'state.truncated': 'Result truncated — use a terminal for the full diff',
  'state.commitMissing': 'No changes recorded for this commit',
  'state.fileMissing': 'This file is not in the working tree (deleted or not checked out).',
  'state.editorUnavailable': 'No editor tab is available in this environment.',
  'state.editorDisabled': 'The editor tab is disabled — enable it in the sidebar settings.',
  'state.openedInEditor': 'Sent to the editor: {path} line {n}',
  'state.fileTooLarge': 'File too large to expand in the panel',
  'state.unsaved': 'Unsaved',
  'state.saved': 'Saved',
  'state.editing': 'Editing',
  'state.editorDetached': 'The editor is floating; use its toolbar to dock or close it',
  'state.savedFile': 'Changes saved',
  'state.confirmDiscard': 'You have unsaved changes. Exit editing anyway?',
  'state.editAlignNote': 'Highlighted by commit line numbers; the working file may have changed',
  'label.detached': 'detached HEAD',
  'label.files': 'files',
  'label.filesOne': 'file',
  'label.turn': 'Turn {n}',
  'label.turnFiles': '{n} files',
  'label.submoduleCommits': '{n} commits',
  'label.submoduleFiles': '{n} files',
  'label.dirtySubmodule': 'Uncommitted changes inside this submodule',
  'label.expandLegend': 'Green = added lines, red = deleted lines; double-click a line to edit it',
  'label.minimap': 'Change marks on the right; click one to jump',
}

const STYLE = `
.crv-root{display:flex;flex-direction:column;height:100%;min-height:0;max-height:100%;overflow:hidden;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
.crv-head{flex:0 0 auto;display:flex;flex-direction:column;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}
.crv-row{display:flex;align-items:center;gap:6px;min-width:0}
.crv-grow{flex:1 1 auto;min-width:0}
.crv-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);gap:2px}
.crv-seg button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;padding:3px 10px;border-radius:6px;cursor:pointer;white-space:nowrap}
.crv-seg button[data-active="true"]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 0 0 1px var(--dsw-alias-border-l1)}
.crv-seg button:not([data-active="true"]):hover{color:var(--dsw-alias-label-primary)}
.crv-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11.5px;padding:3px 8px;border-radius:6px;cursor:pointer}
.crv-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.crv-btn:disabled{opacity:.5;cursor:default}
.crv-meta{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);min-width:0}
.crv-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.crv-branch{display:inline-flex;align-items:center;padding:0 6px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crv-plus{color:var(--dsw-alias-state-success-primary);font-variant-numeric:tabular-nums}
.crv-minus{color:var(--dsw-alias-state-error-primary);font-variant-numeric:tabular-nums}
.crv-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.crv-list{flex:0 0 auto;max-height:38%;overflow:auto;border-bottom:1px solid var(--dsw-alias-border-l1);padding:4px}
.crv-list.crv-flat{max-height:none;flex:1 1 auto;border-bottom:0}
.crv-turn{border-bottom:1px solid var(--dsw-alias-border-l1)}
.crv-turn:last-child{border-bottom:0}
.crv-turnhead{display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.crv-turnhead b{font-weight:600;color:var(--dsw-alias-label-primary);font-size:11.5px}
.crv-turn .crv-item{padding-left:16px}
.crv-grouphead{display:flex;align-items:center;gap:6px;padding:5px 8px;margin:2px 0;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-primary)}
.crv-grouphead:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
.crv-grouphead .crv-path{font-weight:600}
.crv-caret{width:12px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:10px}
.crv-subcommit{display:flex;gap:6px;padding:1px 8px 1px 26px;font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;white-space:nowrap}
.crv-subcommit .crv-hash{flex:0 0 auto}
.crv-subcommit .crv-subject{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.crv-dirtydot{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}
.crv-item{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;cursor:pointer;min-width:0}
.crv-item:hover{background:var(--dsw-alias-bg-layer-2)}
.crv-item[data-active="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.crv-item:focus-visible,.crv-commit:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.crv-badge{flex:0 0 auto;min-width:16px;padding:0 3px;text-align:center;font:600 10px/16px ui-monospace,Consolas,monospace;border-radius:4px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.crv-badge[data-s="A"]{color:var(--dsw-alias-state-success-primary)}
.crv-badge[data-s="D"]{color:var(--dsw-alias-state-error-primary)}
.crv-badge[data-s="R"],.crv-badge[data-s="C"]{color:var(--dsw-alias-brand-primary)}
.crv-badge[data-s="?"]{color:var(--dsw-alias-state-warn-primary)}
.crv-path{flex:1 1 auto;min-width:0;font:11.5px/1.6 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crv-num{flex:0 0 auto;font:11px ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums}
.crv-commit{display:flex;flex-direction:column;gap:1px;padding:5px 6px;border-radius:6px;cursor:pointer;min-width:0}
.crv-commit:hover{background:var(--dsw-alias-bg-layer-2)}
.crv-subject{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crv-cmeta{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);min-width:0}
.crv-hash{font:10.5px ui-monospace,Consolas,monospace;color:var(--dsw-alias-brand-primary);flex:0 0 auto}
.crv-diff{flex:1 1 auto;min-height:0;overflow:auto;position:relative}
.crv-diffwrap{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:row}
.crv-minimap{flex:0 0 12px;position:relative;background:var(--dsw-alias-bg-layer-2);border-left:1px solid var(--dsw-alias-border-l1);cursor:pointer}
.crv-minimap i{position:absolute;height:3px;border-radius:2px;display:block}
.crv-minimap i[data-k="add"]{left:2px;width:5px;background:rgba(46,160,67,.95)}
.crv-minimap i[data-k="del"]{right:2px;width:5px;background:rgba(248,81,73,.95)}
.crv-file.crv-file-edit{height:100%;display:flex;flex-direction:column;min-height:0}
.crv-editwrap{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
.crv-editrow{display:flex;flex:1 1 auto;min-height:0}
.crv-editgutter{flex:0 0 44px;overflow:hidden;padding:6px 4px 6px 0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--crv-fs,12px);line-height:var(--crv-lh,19px);text-align:right;user-select:none}
.crv-editno{height:var(--crv-lh,19px);line-height:var(--crv-lh,19px)}
.crv-editmain{position:relative;flex:1 1 auto;min-width:0}
.crv-edithl{position:absolute;inset:0;margin:0;overflow:hidden;padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--crv-fs,12px);line-height:var(--crv-lh,19px);white-space:pre;tab-size:2;pointer-events:none;color:var(--dsw-alias-label-primary)}
.crv-edithline{height:var(--crv-lh,19px);line-height:var(--crv-lh,19px);white-space:pre}
.crv-edithline[data-add="1"]{background:rgba(46,160,67,.18);box-shadow:inset 2px 0 0 rgba(46,160,67,.85)}
.crv-eghost{background:rgba(248,81,73,.13);box-shadow:inset 2px 0 0 rgba(248,81,73,.85);color:rgba(248,81,73,.92)}
.crv-editinput{position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;resize:none;border:0;outline:none;background:transparent;color:transparent;caret-color:var(--dsw-alias-label-primary);padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:var(--crv-fs,12px);line-height:var(--crv-lh,19px);white-space:pre;tab-size:2;overflow:auto}
.crv-editbar{display:flex;align-items:center;gap:8px;padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary);position:sticky;bottom:0;background:var(--dsw-alias-bg-base);z-index:2}
.crv-dirtytext{color:var(--dsw-alias-state-warn-primary)}
.crv-errortext{color:var(--dsw-alias-state-error-primary)}
.crv-zoom{display:flex;align-items:center;gap:4px}
.crv-zoomvalue{min-width:34px;text-align:center;font-variant-numeric:tabular-nums}
.crv-fence{margin:8px 0}
.crv-fencebar{display:flex;align-items:center;gap:8px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px 8px 0 0;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.crv-fencekey{font-weight:600;text-transform:lowercase}
.crv-fencesrc{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;text-decoration:underline dotted;color:var(--dsw-alias-label-link, var(--dsw-alias-label-primary))}
.crv-fenceopen{padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:11px;cursor:pointer}
.crv-fenceopen:disabled{opacity:.6;cursor:default}
.crv-launch{display:inline-flex;align-items:center}
.crv-launchbtn{padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:11px;cursor:pointer}
.crv-launchbtn:hover{background:var(--dsw-alias-bg-layer-3)}
.crv-drawer{position:fixed;pointer-events:auto;top:8px;right:8px;bottom:8px;width:min(640px,calc(100vw - 16px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.35);z-index:2147482000;overflow:hidden}
.crv-drawerbar{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.crv-drawerbody{flex:1 1 auto;min-height:0;display:flex}
.crv-drawerbody > .crv-root{flex:1 1 auto;min-height:0;height:100%}
.crv-dialog{position:fixed;z-index:2147483000;margin:0;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);box-shadow:0 16px 48px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;max-width:calc(100vw - 12px);max-height:calc(100vh - 12px)}
.crv-dialog-full{inset:44px 10px 10px 10px;width:auto;height:auto;max-width:none;max-height:none;border-radius:12px}
.crv-dialog-min{right:16px;bottom:16px;width:auto;height:auto;max-width:calc(100vw - 32px);flex-direction:row;align-items:center;gap:8px;padding:8px 10px;border-radius:10px}
.crv-dlgbar{position:relative;z-index:5;display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:move;user-select:none;flex-wrap:wrap}
.crv-dialog-full .crv-dlgbar{cursor:default}
.crv-dlgtitle{font-size:12px;font-weight:600;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crv-dlgbody{flex:1 1 auto;min-height:0;display:flex;flex-direction:column}
.crv-dlgcontent{display:flex;flex:1 1 auto;min-height:0}
.crv-dlgcontent .crv-editwrap{flex:1 1 auto;min-height:0}
.crv-resize-r{position:absolute;top:0;right:0;width:6px;height:100%;cursor:ew-resize;z-index:3}
.crv-resize-b{position:absolute;left:0;bottom:0;width:100%;height:6px;cursor:ns-resize;z-index:3}
.crv-resize{position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:4;background:linear-gradient(135deg,transparent 50%,var(--dsw-alias-border-l2) 50%);border-bottom-right-radius:10px}
.crv-file{border-bottom:1px solid var(--dsw-alias-border-l1)}
.crv-filehead{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.crv-hunk{padding:2px 8px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 9%,transparent);color:var(--dsw-alias-brand-primary);font:11px/1.7 ui-monospace,Consolas,monospace;white-space:pre;overflow:hidden;text-overflow:ellipsis}
.crv-line{display:grid;grid-template-columns:34px 34px 12px minmax(0,1fr);font:11.5px/1.6 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
.crv-line[data-k="add"]{background:rgba(46,160,67,.16);box-shadow:inset 2px 0 0 rgba(46,160,67,.85);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.crv-line[data-k="del"]{background:rgba(248,81,73,.16);box-shadow:inset 2px 0 0 rgba(248,81,73,.85);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent)}
.crv-line[data-k="meta"]{color:var(--dsw-alias-label-secondary);font-style:italic}
.crv-full{display:flex;flex-direction:column}
.crv-legend{padding:4px 8px;font-size:10.5px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-bottom:1px solid var(--dsw-alias-border-l1)}
.crv-ghost{background:rgba(248,81,73,.12);box-shadow:inset 2px 0 0 rgba(248,81,73,.85);color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 13%,transparent)}
.crv-full .crv-line{cursor:default}
.crv-no{text-align:right;padding-right:6px;color:var(--dsw-alias-label-secondary);opacity:.65;user-select:none;font-size:10px}
.crv-mark{text-align:center;user-select:none;color:var(--dsw-alias-label-secondary)}
.crv-line[data-k="add"] .crv-mark{color:var(--dsw-alias-state-success-primary)}
.crv-line[data-k="del"] .crv-mark{color:var(--dsw-alias-state-error-primary)}
.crv-text{white-space:pre-wrap;word-break:break-word;padding-right:8px;min-width:0}
.crv-note{padding:8px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.crv-line[data-edit="true"]{cursor:pointer}
.crv-line[data-edit="true"]:hover{outline:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);outline-offset:-1px}
.crv-editbtn{margin-left:4px;flex:0 0 auto}
.crv-hint{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.7}
.crv-ver{flex:0 0 auto;font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.5}
.crv-notice{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:11px;color:var(--dsw-alias-state-warn-primary);border-bottom:1px solid var(--dsw-alias-border-l1)}
.crv-error{margin:8px;padding:8px 10px;border-radius:8px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11.5px;word-break:break-word}
.crv-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:24px 16px;text-align:center;color:var(--dsw-alias-label-secondary)}
.crv-empty strong{color:var(--dsw-alias-label-primary);font-weight:500;font-size:12px}
.crv-empty span{font-size:11px;opacity:.85}
.crv-pulse{flex:0 0 auto;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:crv-pulse 1.1s ease-in-out infinite}
@keyframes crv-pulse{0%,100%{opacity:.2}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){.crv-pulse{animation:none;opacity:.7}}
`

/** Build a URL for one Host endpoint, relative to the page's own base. */
function apiUrl(action, params) {
  let base = ''
  try {
    base = new URL('api/code-review/', document.baseURI || location.href).href
  } catch {
    base = '/api/code-review/'
  }
  const url = new URL(action, base)
  for (const key of Object.keys(params || {})) {
    const value = params[key]
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(key, String(value))
  }
  return url.href
}

/** Send one JSON body to an endpoint and read the JSON answer. */
async function postJson(action, params, body, signal) {
  const response = await fetch(apiUrl(action, params), {
    method: 'POST',
    signal,
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Host route answered ${response.status}.`)
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('The code-review host route returned an unexpected response.')
  }
  if (!payload || payload.ok === false) throw new Error((payload && payload.error) || 'The code-review request failed.')
  return payload
}

/** Fetch one endpoint, retried against the origin root when the base-relative URL misses. */
async function getJson(action, params, signal) {
  const request = { signal, credentials: 'same-origin', headers: { accept: 'application/json' } }
  let response = null
  try {
    response = await fetch(apiUrl(action, params), request)
  } catch (error) {
    if (error && error.name === 'AbortError') throw error
  }

  if (!response || response.status === 404) {
    let direct = null
    try {
      direct = new URL('/api/code-review/' + action, location.origin)
    } catch {
      direct = null
    }
    if (!direct) throw new Error('The code-review host route is unreachable from this page.')
    for (const key of Object.keys(params || {})) {
      const value = params[key]
      if (value === undefined || value === null || value === '') continue
      direct.searchParams.set(key, String(value))
    }
    response = await fetch(direct.href, request)
  }
  if (!response.ok) throw new Error(`Host route answered ${response.status}.`)

  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('The code-review host route returned an unexpected response.')
  }
  if (!payload || payload.ok === false) throw new Error((payload && payload.error) || 'The code-review request failed.')
  return payload
}

/** Build the translate function for this plugin's namespace. */
function makeTranslate(ctx) {
  let bound = null
  try {
    const locale = ctx.get('locale')
    if (locale && typeof locale.bind === 'function') bound = locale.bind(NS)
  } catch {
    bound = null
  }
  return (key) => {
    if (bound) {
      try {
        const value = bound(key)
        if (typeof value === 'string' && value && value !== key) return value
      } catch {
        /* fall through to the built-in dictionary */
      }
    }
    return DICT_EN[key] || key
  }
}

function formatCount(value) {
  if (value === null || value === undefined) return '0'
  if (value >= 10000) return `${Math.round(value / 1000)}k`
  return String(value)
}

/** Pick a plausible repository-relative file path out of a Markdown fence. */
function looksLikeFilePath(value) {
  if (!value || value.length > 240) return false
  if (value.includes('://') || /\s/.test(value)) return false
  return /^[\w./\\@-]+$/.test(value) && /\.[A-Za-z0-9]{1,8}$/.test(value)
}

function inferFenceSource(lang, meta, code) {
  const candidates = []
  const language = String(lang || '').toLowerCase()
  if (meta) {
    const labelled = /(?:path|file|title)\s*=\s*["']?([^"'\s]+)/i.exec(meta)
    if (labelled) candidates.push(labelled[1])
    else if (looksLikeFilePath(meta.trim())) candidates.push(meta.trim())
  }
  if (language === 'diff' || language === 'patch') {
    const added = /^\+\+\+\s+b\/(.+)$/m.exec(code || '')
    if (added) candidates.push(added[1].trim())
    else {
      const git = /^diff --git a\/.+? b\/(.+)$/m.exec(code || '')
      if (git) candidates.push(git[1].trim())
    }
  }
  const firstLine = String(code || '').split('\n')[0] || ''
  const named = /^(?:\/\/|#|--|<!--|\/\*)\s*(?:file|path)\s*[:=]\s*([^\s*]+)/i.exec(firstLine)
  if (named) candidates.push(named[1])
  else {
    const bare = /^(?:\/\/|#|--|<!--|\/\*)\s*([\w./\\@-]+\.[A-Za-z0-9]{1,8})\s*(?:\*\/|-->)?\s*$/.exec(firstLine)
    if (bare) candidates.push(bare[1])
  }
  return candidates.find((value) => looksLikeFilePath(value)) || ''
}

function splitPath(value) {
  const index = value.lastIndexOf('/')
  if (index < 0) return { dir: '', name: value }
  return { dir: value.slice(0, index + 1), name: value.slice(index + 1) }
}

/** The first line this change touches in the new file. */
function firstChangeLine(file) {
  for (const hunk of file.hunks || []) {
    const added = (hunk.lines || []).find((line) => line.kind === 'add')
    if (added && added.new) return added.new
    if (hunk.newLines > 0) return hunk.newStart
  }
  return 1
}

/** One entry per changed position in the new file, for the minimap. */
function changeMarks(file) {
  const marks = []
  const seen = new Set()
  for (const hunk of file.hunks || []) {
    for (const line of hunk.lines || []) {
      const at = line.kind === 'add' ? line.new : line.kind === 'del' ? line.newCursor : null
      if (at === null || at === undefined) continue
      const key = `${line.kind}:${at}`
      if (seen.has(key)) continue
      seen.add(key)
      marks.push({ line: at, kind: line.kind })
    }
  }
  return marks
}

window.__ModuleLoader__.load({
  id: 'dsh-code-review-tab',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback } = React

    /** Layers one chat code fence with its inferred source and an edit action. */
    function FenceSource(props) {
      const source = inferFenceSource(props.lang, props.meta, props.code)
      const [busy, setBusy] = useState(false)
      const [failed, setFailed] = useState('')
      if (!source) return props.children
      const open = async () => {
        if (busy) return
        setBusy(true)
        setFailed('')
        try {
          const isAbsolute = /^[A-Za-z]:[\\/]/.test(source) || source.startsWith('/')
          let absolute = source
          if (!isAbsolute) {
            const info = await getJson('file', { sessionId: props.sessionId || '', path: source })
            if (!info.exists) throw new Error(props.t('fence.missing'))
            absolute = info.absolute
          }
          const sidebar = props.ctx.get('betterSidebar')
          if (!sidebar || typeof sidebar.openTab !== 'function') throw new Error(props.t('fence.unavailable'))
          sidebar.openTab({ type: 'editor', path: absolute, line: 1, title: source.split('/').pop() })
        } catch (error) {
          setFailed(error && error.message ? error.message : String(error))
        } finally {
          setBusy(false)
        }
      }
      return h(
        'div',
        { className: 'crv-fence' },
        h(
          'div',
          { className: 'crv-fencebar' },
          h('span', { className: 'crv-fencekey' }, props.lang || 'code'),
          h('a', { className: 'crv-fencesrc', title: source, onClick: open }, source),
          h('span', { className: 'crv-grow' }),
          failed ? h('span', { className: 'crv-errortext' }, failed) : null,
          h('button', { className: 'crv-fenceopen', onClick: open, disabled: busy }, busy ? '…' : props.t('fence.open')),
        ),
        props.children,
      )
    }

    /** Shared drawer state: the composer button opens it, the overlay slot draws it. */
    const drawer = { open: false, sessionId: '', listeners: new Set() }

    function setDrawer(next) {
      Object.assign(drawer, next)
      for (const listener of drawer.listeners) listener()
    }

    /** Core-only entry: a composer button that opens the review drawer. */
    function ReviewLauncher(props) {
      const sessionId = props.sessionId || ''
      if (!sessionId) return null
      return h(
        'div',
        { className: 'crv-launch' },
        h('style', null, STYLE),
        h(
          'button',
          {
            className: 'crv-launchbtn',
            title: props.t('tab.title'),
            onClick: () => {
              const sidebar = props.ctx.get('sidebarRight')
              if (sidebar && typeof sidebar.openTab === 'function') {
                try {
                  sidebar.openTab('code-review-tab', { revealIfOpened: true })
                  return
                } catch {
                  /* fall through to the drawer */
                }
              }
              setDrawer({ open: !(drawer.open && drawer.sessionId === sessionId), sessionId })
            },
          },
          props.t('launcher.label'),
        ),
      )
    }

    /** Frame-level drawer host, so the panel is never clipped by the composer. */
    function ReviewDrawer(props) {
      const [, setVersion] = useState(0)
      useEffect(() => {
        const listener = () => setVersion((value) => value + 1)
        drawer.listeners.add(listener)
        return () => drawer.listeners.delete(listener)
      }, [])
      if (!drawer.open || !drawer.sessionId) return null
      return h(
        'div',
        { className: 'crv-drawer', role: 'dialog', 'aria-label': props.t('tab.title') },
        h('style', null, STYLE),
        h(
          'div',
          { className: 'crv-drawerbar' },
          h('b', null, props.t('tab.title')),
          h('span', { className: 'crv-grow' }),
          h('button', { className: 'crv-btn', onClick: () => setDrawer({ open: false }) }, '×'),
        ),
        h('div', { className: 'crv-drawerbody' }, h(CodeReviewTab, { ctx: props.ctx, scope: { sessionId: drawer.sessionId }, visible: true })),
      )
    }

    function LineRow(props) {
      const marker = props.kind === 'add' ? '+' : props.kind === 'del' ? '-' : props.kind === 'meta' ? '\\' : ''
      const oldNo = props.old === null || props.old === undefined ? '' : String(props.old)
      const newNo = props.new === null || props.new === undefined ? '' : String(props.new)
      const target = props.new !== null && props.new !== undefined
        ? props.new
        : props.newCursor !== null && props.newCursor !== undefined
          ? props.newCursor
          : null
      return h(
        'div',
        {
          className: 'crv-line',
          'data-k': props.kind,
          onDoubleClick: props.onLineEdit && target
            ? (event) => {
                event.preventDefault()
                event.stopPropagation()
                props.onLineEdit(target)
              }
            : undefined,
        },
        h('span', { className: 'crv-no' }, oldNo),
        h('span', { className: 'crv-no' }, newNo),
        h('span', { className: 'crv-mark' }, marker),
        h('span', { className: 'crv-text' }, props.text === '' ? ' ' : props.text),
      )
    }

    function Minimap(props) {
      const total = Math.max(1, props.total)
      return h(
        'div',
        {
          className: 'crv-minimap',
          title: props.t('label.minimap'),
          onClick: (event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            if (rect.height <= 0) return
            const ratio = (event.clientY - rect.top) / rect.height
            props.onJump(Math.min(total, Math.max(1, Math.round(ratio * total))))
          },
        },
        props.marks.map((mark, index) =>
          h('i', {
            key: index,
            'data-k': mark.kind,
            style: { top: `${Math.min(99.7, ((mark.line - 1) / total) * 100)}%` },
            onClick: (event) => {
              event.stopPropagation()
              props.onJump(mark.line)
            },
          }),
        ),
      )
    }

    function FileCard(props) {
      const file = props.file
      const parts = splitPath(file.path || '')
      const hunks = file.hunks || []
      let firstLine = 1
      for (const hunk of hunks) {
        const added = (hunk.lines || []).find((line) => line.kind === 'add')
        if (added) {
          firstLine = added.new
          break
        }
        if (hunk.newLines > 0) {
          firstLine = hunk.newStart
          break
        }
      }
      const editing = Boolean(props.editing)
      const added = new Set()
      for (const hunk of hunks) {
        for (const line of hunk.lines || []) {
          if (line.kind === 'add' && line.new !== null && line.new !== undefined) added.add(line.new)
        }
      }
      return h(
        'section',
        {
          className: editing ? 'crv-file crv-file-edit' : 'crv-file',
          onDoubleClick:
            !editing && props.onEdit
              ? (event) => {
                  event.preventDefault()
                  props.onEdit(firstLine)
                }
              : undefined,
        },
        h(
          'div',
          { className: 'crv-filehead' },
          h('span', { className: 'crv-badge', 'data-s': file.status || 'M' }, file.status || 'M'),
          h(
            'span',
            { className: 'crv-path', title: file.path },
            parts.dir ? h('span', { style: { opacity: 0.55 } }, parts.dir) : null,
            parts.name,
          ),
          h('span', { className: 'crv-grow' }),
          !file.binary
            ? h('span', { className: 'crv-hint' }, props.t(editing ? 'state.editing' : 'action.dblclickEdit'))
            : null,
          h('span', { className: 'crv-plus crv-num' }, `+${formatCount(file.additions)}`),
          h('span', { className: 'crv-minus crv-num' }, `-${formatCount(file.deletions)}`),
          !editing && props.onEdit && !file.binary
            ? h(
                'button',
                {
                  className: 'crv-btn crv-editbtn',
                  title: props.editLabel.replace('{n}', String(firstLine)),
                  onClick: () => props.onEdit(firstLine),
                },
                props.t('action.edit'),
              )
            : null,
          editing
            ? h(
                'button',
                {
                  className: 'crv-btn crv-editbtn',
                  title: props.t('action.exitEdit'),
                  onClick: props.onExitEdit,
                },
                props.t('action.closeEdit'),
              )
            : null,
          editing && props.editorMode === 'inline' && !file.binary
            ? h(
                'button',
                { className: 'crv-btn crv-editbtn', title: props.t('action.float'), onClick: props.onFloat },
                props.t('action.float'),
              )
            : null,
          editing && props.editorMode === 'inline' && !file.binary
            ? h(
                'button',
                { className: 'crv-btn crv-editbtn', title: props.t('action.fullscreen'), onClick: props.onFull },
                props.t('action.fullscreen'),
              )
            : null,
        ),
        file.binary
          ? h('div', { className: 'crv-note' }, props.t('state.binary'))
          : file.oversized
            ? h('div', { className: 'crv-note' }, props.t('state.oversized'))
            : editing
              ? props.editorMode && props.editorMode !== 'inline'
                ? h('div', { className: 'crv-note' }, props.t('state.editorDetached'))
                : h(EditableFileView, {
                  t: props.t,
                  draft: props.draft,
                  added,
                  editing: true,
                  editLine: props.editLine,
                  draftVersion: props.draftVersion,
                  dirty: props.dirty,
                  saving: props.saving,
                  saveError: props.saveError,
                  onDraft: props.onDraft,
                  onSave: props.onSave,
                  onExit: props.onExitEdit,
                  onRegisterArea: props.onRegisterArea,
                  fontSize: props.fontSize,
                  onZoom: props.onZoom,
                })
              : hunks.map((hunk, index) =>
                  h(
                    'div',
                    { key: `hunk-${index}` },
                    h('div', { className: 'crv-hunk' }, hunk.header),
                    (hunk.lines || []).map((line, lineIndex) =>
                      h(LineRow, { key: lineIndex, ...line, onLineEdit: props.onEditAt, editLabel: props.editLabel }),
                    ),
                  ),
                ),
      )
    }

    function FullFileView(props) {
      const fullFile = props.fullFile
      if (fullFile.loading) return h('div', { className: 'crv-note' }, props.t('state.loading'))
      if (fullFile.error) return h('div', { className: 'crv-error' }, fullFile.error)
      if (fullFile.tooLarge) return h('div', { className: 'crv-note' }, props.t('state.fileTooLarge'))
      if (fullFile.binary) return h('div', { className: 'crv-note' }, props.t('state.binary'))

      const lines = (fullFile.text || '').split(/\r?\n/)
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      const shown = lines.slice(0, 8000)

      const added = new Set()
      const removed = new Map()
      for (const hunk of props.file.hunks || []) {
        for (const line of hunk.lines || []) {
          if (line.kind === 'add' && line.new !== null && line.new !== undefined) {
            added.add(line.new)
          } else if (line.kind === 'del' && line.newCursor !== null && line.newCursor !== undefined) {
            if (!removed.has(line.newCursor)) removed.set(line.newCursor, [])
            removed.get(line.newCursor).push(line.text)
          }
        }
      }

      const rows = []
      const ghost = (text, key) =>
        h(
          'div',
          { className: 'crv-line crv-ghost', 'data-k': 'del', key },
          h('span', { className: 'crv-no' }),
          h('span', { className: 'crv-no' }),
          h('span', { className: 'crv-mark' }, '-'),
          h('span', { className: 'crv-text' }, text === '' ? ' ' : text),
        )
      for (let number = 1; number <= shown.length; number += 1) {
        const deleted = removed.get(number)
        if (deleted) deleted.forEach((text, index) => rows.push(ghost(text, `d-${number}-${index}`)))
        const kind = added.has(number) ? 'add' : 'ctx'
        rows.push(
          h(
            'div',
            {
              className: 'crv-line',
              'data-k': kind,
              'data-ln': number,
              key: `l-${number}`,
              title: props.editLabel.replace('{n}', String(number)),
              onDoubleClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                if (props.onEdit) props.onEdit(number)
              },
            },
            h('span', { className: 'crv-no' }),
            h('span', { className: 'crv-no' }, String(number)),
            h('span', { className: 'crv-mark' }, kind === 'add' ? '+' : ''),
            h('span', { className: 'crv-text' }, shown[number - 1] === '' ? ' ' : shown[number - 1]),
          ),
        )
      }      const tail = removed.get(shown.length + 1)
      if (tail) tail.forEach((text, index) => rows.push(ghost(text, `t-${index}`)))

      return h(
        'div',
        { className: 'crv-full' },
        h('div', { className: 'crv-legend' }, props.t('label.expandLegend')),
        fullFile.truncated || lines.length > shown.length ? h('div', { className: 'crv-note' }, props.t('state.truncated')) : null,
        rows,
      )
    }

    function EditorDialog(props) {
      const [minimized, setMinimized] = useState(false)
      const [rect, setRect] = useState(() => {
        const viewWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
        const viewHeight = typeof window !== 'undefined' ? window.innerHeight : 860
        const width = Math.min(1000, Math.max(480, Math.round(viewWidth * 0.72)))
        const height = Math.min(760, Math.max(360, Math.round(viewHeight * 0.72)))
        return { x: Math.round((viewWidth - width) / 2), y: Math.round((viewHeight - height) / 3), width, height }
      })

      const startDrag = (event) => {
        if (event.button !== 0 || event.target.closest('button')) return
        event.preventDefault()
        const startX = event.clientX
        const startY = event.clientY
        const base = { ...rect }
        const move = (moveEvent) => {
          const maxX = Math.max(0, window.innerWidth - 240)
          const maxY = Math.max(0, window.innerHeight - 120)
          setRect({
            ...base,
            x: Math.max(0, Math.min(maxX, base.x + moveEvent.clientX - startX)),
            y: Math.max(0, Math.min(maxY, base.y + moveEvent.clientY - startY)),
          })
        }
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
      }

      const startResize = (event, axis) => {
        event.preventDefault()
        event.stopPropagation()
        const startX = event.clientX
        const startY = event.clientY
        const base = { ...rect }
        const move = (moveEvent) => {
          const next = { ...base }
          if (axis.includes('x')) {
            next.width = Math.max(360, Math.min(window.innerWidth - base.x - 8, base.width + moveEvent.clientX - startX))
          }
          if (axis.includes('y')) {
            next.height = Math.max(240, Math.min(window.innerHeight - base.y - 8, base.height + moveEvent.clientY - startY))
          }
          setRect(next)
        }
        const stop = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
      }

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          setMinimized(false)
          props.onDock()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [props.onDock])

      const full = Boolean(props.full)
      if (minimized) {
        return h(
          'div',
          { className: 'crv-dialog crv-dialog-min', role: 'dialog', 'aria-label': props.title },
          h('span', { className: 'crv-dlgtitle', title: props.title }, props.title),
          h('button', { className: 'crv-btn', onClick: () => setMinimized(false) }, props.t('action.restore')),
          h('button', { className: 'crv-btn', onClick: props.onDock }, props.t('action.dock')),
          h('button', { className: 'crv-btn', onClick: props.onClose }, props.t('action.closeEdit')),
        )
      }
      return h(
        'div',
        {
          className: full ? 'crv-dialog crv-dialog-full' : 'crv-dialog',
          role: 'dialog',
          'aria-label': props.title,
          style: full ? undefined : { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` },
        },
        h(
          'div',
          { className: 'crv-dlgbar', onPointerDown: full ? undefined : startDrag },
          h('span', { className: 'crv-dlgtitle', title: props.title }, props.title),
          h('span', { className: 'crv-grow' }),
          h('button', { className: 'crv-btn', title: props.t('action.minimize'), onClick: () => setMinimized(true) }, '—'),
          h('button', { className: 'crv-btn', onClick: props.onDock }, props.t('action.dock')),
          h('button', { className: 'crv-btn', onClick: props.onToggleFull }, full ? props.t('action.restore') : props.t('action.fullscreen')),
          h('button', { className: 'crv-btn', onClick: props.onSave, disabled: props.saving }, props.saving ? props.t('action.saving') : props.t('action.save')),
          h('button', { className: 'crv-btn', onClick: props.onClose }, props.t('action.closeEdit')),
        ),
        h('div', { className: 'crv-dlgbody' }, props.children),
        full
          ? null
          : [
              h('div', { key: 'right', className: 'crv-resize-r', onPointerDown: (event) => startResize(event, 'x') }),
              h('div', { key: 'bottom', className: 'crv-resize-b', onPointerDown: (event) => startResize(event, 'y') }),
              h('div', {
                key: 'corner',
                className: 'crv-resize',
                title: props.t('action.resize'),
                onPointerDown: (event) => startResize(event, 'xy'),
              }),
            ],
      )
    }

    function EditableFileView(props) {
      const { t, draft, added, editLine } = props
      const areaRef = useRef(null)
      const preRef = useRef(null)
      const gutterRef = useRef(null)
      const fontSize = props.fontSize || 12
      const lineHeight = Math.round(fontSize * 1.6)
      const previousFontSize = useRef(fontSize)

      const lines = draft.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

      const rows = []
      let contentNumber = 0
      for (const line of lines) {
        if (line.startsWith(GHOST_MARK)) {
          rows.push({ kind: 'ghost', text: line.slice(1), number: 0 })
        } else {
          contentNumber += 1
          rows.push({ kind: 'content', text: line, number: contentNumber })
        }
      }

      const sync = () => {
        const area = areaRef.current
        if (!area) return
        if (preRef.current) {
          preRef.current.scrollTop = area.scrollTop
          preRef.current.scrollLeft = area.scrollLeft
        }
        if (gutterRef.current) gutterRef.current.scrollTop = area.scrollTop
      }

      useEffect(() => {
        const area = areaRef.current
        if (!area || !draft) return
        props.onRegisterArea?.(area)
        const target = Math.max(1, editLine || 1)
        let row = 0
        let offset = 0
        let seen = 0
        for (let index = 0; index < lines.length; index += 1) {
          const ghost = lines[index].startsWith(GHOST_MARK)
          if (!ghost) seen += 1
          if (!ghost && seen >= target) {
            row = index
            break
          }
          offset += lines[index].length + 1
        }
        area.focus()
        try {
          area.setSelectionRange(offset, offset)
        } catch {
          /* ignore */
        }
        area.scrollTop = Math.max(0, (row + 1 - 4) * lineHeight)
        sync()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [props.editing, editLine, props.draftVersion])

      useEffect(() => {
        const area = areaRef.current
        if (!area) return undefined
        if (typeof props.onZoom !== 'function') return undefined
        const onWheel = (event) => {
          if (!event.ctrlKey && !event.metaKey) return
          event.preventDefault()
          props.onZoom(event.deltaY < 0 ? 1 : -1)
        }
        area.addEventListener('wheel', onWheel, { passive: false })
        return () => area.removeEventListener('wheel', onWheel)
      }, [props.onZoom])

      useEffect(() => {
        const area = areaRef.current
        if (!area) return
        const before = Math.round(previousFontSize.current * 1.6)
        if (before !== lineHeight) {
          const topRow = area.scrollTop / before
          area.scrollTop = Math.max(0, topRow * lineHeight)
          sync()
        }
        previousFontSize.current = fontSize
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [fontSize])

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          props.onExit()
          return
        }
        if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 's') {
          event.preventDefault()
          props.onSave()
          return
        }
        const area = event.currentTarget
        const lineStart = draft.lastIndexOf('\n', area.selectionStart - 1) + 1
        const onGhostRow = draft.startsWith(GHOST_MARK, lineStart)
        if (onGhostRow) {
          const navigation = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Escape']
          if (!navigation.includes(event.key) && !event.ctrlKey && !event.metaKey) {
            event.preventDefault()
            return
          }
        }
        if (event.key === 'Tab') {
          event.preventDefault()
          const start = area.selectionStart
          const end = area.selectionEnd
          const next = draft.slice(0, start) + '  ' + draft.slice(end)
          props.onDraft(next)
          requestAnimationFrame(() => {
            const element = areaRef.current
            if (element) element.setSelectionRange(start + 2, start + 2)
          })
        }
      }

      return h(
        'div',
        {
          className: 'crv-editwrap',
          style: { '--crv-fs': `${fontSize}px`, '--crv-lh': `${lineHeight}px` },
        },
        h(
          'div',
          { className: 'crv-editrow' },
          h(
            'div',
            { className: 'crv-editgutter', ref: gutterRef },
            rows.map((row, index) =>
              h('div', { key: index, className: 'crv-editno' }, row.kind === 'ghost' ? '' : String(row.number)),
            ),
          ),
          h(
            'div',
            { className: 'crv-editmain' },
            h(
              'pre',
              { className: 'crv-edithl', ref: preRef, 'aria-hidden': true },
              rows.map((row, index) =>
                h(
                  'div',
                  {
                    key: index,
                    className: `crv-edithline${row.kind === 'ghost' ? ' crv-eghost' : ''}`,
                    'data-add': row.kind === 'content' && added.has(row.number) ? '1' : '0',
                  },
                  row.kind === 'ghost' ? `- ${row.text === '' ? ' ' : row.text}` : row.text === '' ? ' ' : row.text,
                ),
              ),
            ),
            h('textarea', {
              className: 'crv-editinput',
              ref: areaRef,
              value: draft,
              spellCheck: false,
              wrap: 'off',
              onChange: (event) => props.onDraft(event.target.value),
              onScroll: sync,
              onKeyDown,
            }),
          ),
        ),
        h(
          'div',
          { className: 'crv-editbar' },
          props.dirty ? h('span', { className: 'crv-dirtytext' }, t('state.unsaved')) : h('span', null, t('state.saved')),
          props.saveError ? h('span', { className: 'crv-errortext' }, props.saveError) : null,
          h('span', { className: 'crv-grow' }),
          h(
            'span',
            { className: 'crv-zoom' },
            h('button', { className: 'crv-btn', onClick: () => typeof props.onZoom === 'function' && props.onZoom(-1) }, 'A−'),
            h('span', { className: 'crv-zoomvalue' }, `${fontSize}px`),
            h('button', { className: 'crv-btn', onClick: () => typeof props.onZoom === 'function' && props.onZoom(1) }, 'A+'),
          ),
          h('button', { className: 'crv-btn', onClick: props.onSave, disabled: props.saving }, props.saving ? t('action.saving') : t('action.save')),
        ),
      )
    }

    function FileRow(props) {
      const file = props.file
      const parts = splitPath(file.path)
      const counts = file.counts || { additions: file.additions, deletions: file.deletions, binary: file.binary }
      return h(
        'div',
        {
          className: 'crv-item',
          'data-active': props.active ? 'true' : 'false',
          title: file.path,
          onClick: () => props.onSelect(file.path),
          role: 'button',
          tabIndex: 0,
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            props.onSelect(file.path)
          },
        },
        h('span', { className: 'crv-badge', 'data-s': file.status }, file.status),
        h('span', { className: 'crv-path' }, parts.dir ? h('span', { style: { opacity: 0.55 } }, parts.dir) : null, parts.name),
        counts.binary
          ? h('span', { className: 'crv-num', style: { opacity: 0.6 } }, 'bin')
          : h(
              'span',
              { className: 'crv-num' },
              h('span', { className: 'crv-plus' }, `+${formatCount(counts.additions)}`),
              ' ',
              h('span', { className: 'crv-minus' }, `-${formatCount(counts.deletions)}`),
            ),
      )
    }

    function TurnFileRow(props) {
      const file = props.file
      const parts = splitPath(file.display || file.path)
      const badge = file.oversized || file.binary ? 'bin' : file.deleted > 0 && file.added === 0 ? '-' : file.added > 0 && file.deleted === 0 ? '+' : '±'
      const badgeStatus = badge === '+' ? 'A' : badge === '-' ? 'D' : 'M'
      const open = () => props.onSelect()
      return h(
        'div',
        {
          className: 'crv-item',
          'data-active': props.active ? 'true' : 'false',
          title: file.path,
          onClick: open,
          role: 'button',
          tabIndex: 0,
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            open()
          },
        },
        h('span', { className: 'crv-badge', 'data-s': badgeStatus }, badge),
        h('span', { className: 'crv-path' }, parts.dir ? h('span', { style: { opacity: 0.55 } }, parts.dir) : null, parts.name),
        h(
          'span',
          { className: 'crv-num' },
          h('span', { className: 'crv-plus' }, `+${formatCount(file.added)}`),
          ' ',
          h('span', { className: 'crv-minus' }, `-${formatCount(file.deleted)}`),
        ),
      )
    }

    function GroupHeader(props) {
      const group = props.group
      const commits = group.commits || []
      const files = group.files || []
      return h(
        'div',
        {
          className: 'crv-grouphead',
          title: group.path,
          role: 'button',
          tabIndex: 0,
          onClick: props.onToggle,
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            props.onToggle()
          },
        },
        h('span', { className: 'crv-caret' }, props.collapsed ? '▸' : '▾'),
        h('span', { className: 'crv-path' }, group.path),
        h('span', { className: 'crv-grow' }),
        commits.length > 0 ? h('span', null, props.t('label.submoduleCommits').replace('{n}', String(commits.length))) : null,
        h('span', null, props.t('label.submoduleFiles').replace('{n}', String(files.length))),
        group.dirty ? h('span', { className: 'crv-dirtydot', title: props.t('label.dirtySubmodule') }) : null,
      )
    }

    function CommitRow(props) {
      const commit = props.commit
      return h(
        'div',
        {
          className: 'crv-commit',
          onClick: () => props.onSelect(commit),
          role: 'button',
          tabIndex: 0,
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            props.onSelect(commit)
          },
        },
        h('div', { className: 'crv-subject', title: commit.subject }, commit.subject || '(no subject)'),
        h(
          'div',
          { className: 'crv-cmeta' },
          h('span', { className: 'crv-hash' }, commit.short),
          h('span', { className: 'crv-ellipsis' }, commit.author || ''),
          h('span', { className: 'crv-ellipsis' }, (commit.date || '').slice(0, 16)),
          commit.refs ? h('span', { className: 'crv-ellipsis', style: { opacity: 0.7 } }, commit.refs) : null,
        ),
      )
    }

    function Empty(props) {
      return h(
        'div',
        { className: 'crv-empty' },
        h('strong', null, props.title),
        props.hint ? h('span', null, props.hint) : null,
        props.action || null,
      )
    }

    function ErrorBox(props) {
      return h(
        'div',
        null,
        h('div', { className: 'crv-error' }, props.message),
        props.onRetry
          ? h('div', { style: { padding: '0 10px 10px' } }, h('button', { className: 'crv-btn', onClick: props.onRetry }, props.retryLabel))
          : null,
      )
    }

    function CodeReviewTab(props) {
      const ctx = props.ctx
      const scope = props.scope || {}
      const visible = props.visible !== false
      const t = useMemo(() => makeTranslate(ctx), [ctx])
      const scopeKey = `${scope.sessionId || ''}|${scope.repoRoot || scope.cwd || ''}`
      const scopeRef = useRef(scope)
      scopeRef.current = scope

      const [mode, setMode] = useState('worktree')
      const [snapshot, setSnapshot] = useState(null)
      const [snapshotError, setSnapshotError] = useState('')
      const [worktree, setWorktree] = useState(null)
      const [worktreeError, setWorktreeError] = useState('')
      const [selectedPath, setSelectedPath] = useState(null)
      const [selectedCommit, setSelectedCommit] = useState(null)
      const [commitDetail, setCommitDetail] = useState(null)
      const [commitError, setCommitError] = useState('')
      const [turns, setTurns] = useState(null)
      const [turnsError, setTurnsError] = useState('')
      const [turnsUnavailable, setTurnsUnavailable] = useState(false)
      const [turnFile, setTurnFile] = useState(null)
      const [turnDiff, setTurnDiff] = useState(null)
      const [turnDiffError, setTurnDiffError] = useState('')
      const [collapsedGroups, setCollapsedGroups] = useState({})
      const [notice, setNotice] = useState('')
      const [expandedPath, setExpandedPath] = useState(null)
      const [expandTarget, setExpandTarget] = useState(1)
      const [fullFile, setFullFile] = useState(null)
      const [editingPath, setEditingPath] = useState(null)
      const [editTargetLine, setEditTargetLine] = useState(1)
      const [draft, setDraft] = useState('')
      const [draftBaseline, setDraftBaseline] = useState('')
      const [draftMtime, setDraftMtime] = useState(0)
      const [draftVersion, setDraftVersion] = useState(0)
      const [editorMode, setEditorMode] = useState('inline')
      const [editorFontSize, setEditorFontSize] = useState(12)
      const [saving, setSaving] = useState(false)
      const [saveError, setSaveError] = useState('')
      const [loading, setLoading] = useState(false)
      const tickRef = useRef(0)
      const diffRef = useRef(null)
      const editorAreaRef = useRef(null)
      const noticeTimer = useRef(0)

      const showNotice = useCallback((message, autoClear) => {
        setNotice(message)
        if (noticeTimer.current) {
          clearTimeout(noticeTimer.current)
          noticeTimer.current = 0
        }
        if (autoClear) {
          noticeTimer.current = setTimeout(() => {
            setNotice('')
            noticeTimer.current = 0
          }, 4000)
        }
      }, [])

      useEffect(() => () => {
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
      }, [])

      useEffect(() => {
        setExpandedPath(null)
        setExpandTarget(1)
        setFullFile(null)
        setEditingPath(null)
        setDraft('')
        setDraftBaseline('')
        setSaveError('')
        setEditorMode('inline')
      }, [selectedPath, selectedCommit, mode, scopeKey])

      useEffect(() => {
        if (!expandedPath || !fullFile || fullFile.loading || fullFile.error || !fullFile.text) return undefined
        const container = diffRef.current
        if (!container) return undefined
        const frame = requestAnimationFrame(() => {
          const node = container.querySelector(`[data-ln="${expandTarget}"]`)
          if (node) container.scrollTop = Math.max(0, node.offsetTop - Math.round(container.clientHeight / 3))
        })
        return () => cancelAnimationFrame(frame)
      }, [expandedPath, fullFile, expandTarget])

      const jumpToLine = useCallback((line) => {
        const container = diffRef.current
        if (!container) return
        const node = container.querySelector(`[data-ln="${line}"]`)
        if (node) container.scrollTop = Math.max(0, node.offsetTop - Math.round(container.clientHeight / 3))
      }, [])

      const params = useCallback(() => {
        const current = scopeRef.current || {}
        return { sessionId: current.sessionId || '', cwd: current.repoRoot || current.cwd || '' }
      }, [])

      const loadSnapshot = useCallback(
        async (signal) => {
          try {
            const data = await getJson('snapshot', params(), signal)
            if (signal && signal.aborted) return
            setSnapshot(data)
            setSnapshotError('')
          } catch (error) {
            if (signal && signal.aborted) return
            if (error && error.name === 'AbortError') return
            setSnapshotError(error.message || String(error))
          }
        },
        [params, scopeKey],
      )

      const loadWorktree = useCallback(
        async (signal) => {
          try {
            const data = await getJson('worktree', params(), signal)
            if (signal && signal.aborted) return
            const files = data.files || []
            setWorktree({ files, groups: data.groups || [], truncated: Boolean(data.truncated) })
            setWorktreeError('')
            setSelectedPath((previous) => {
              if (previous && files.some((file) => file.path === previous)) return previous
              return files.length > 0 ? files[0].path : null
            })
          } catch (error) {
            if (signal && signal.aborted) return
            if (error && error.name === 'AbortError') return
            setWorktreeError(error.message || String(error))
          }
        },
        [params, scopeKey],
      )

      useEffect(() => {
        const controller = new AbortController()
        setSnapshot(null)
        setSnapshotError('')
        setWorktree(null)
        setWorktreeError('')
        setSelectedPath(null)
        setSelectedCommit(null)
        setCommitDetail(null)
        setCommitError('')
        setTurns(null)
        setTurnsError('')
        setTurnsUnavailable(false)
        setTurnFile(null)
        setTurnDiff(null)
        setTurnDiffError('')
        setLoading(true)
        Promise.all([loadSnapshot(controller.signal), loadWorktree(controller.signal)]).finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
        return () => controller.abort()
      }, [scopeKey])

      useEffect(() => {
        if (mode !== 'worktree' || !visible) return undefined
        const controller = new AbortController()
        let pending = false
        const tick = async () => {
          if (pending) return
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          pending = true
          try {
            tickRef.current += 1
            await loadWorktree(controller.signal)
            if (tickRef.current % 3 === 0) await loadSnapshot(controller.signal)
          } finally {
            pending = false
          }
        }
        tick()
        const timer = setInterval(tick, 8000)
        return () => {
          controller.abort()
          clearInterval(timer)
        }
      }, [mode, visible, scopeKey, loadWorktree, loadSnapshot])

      useEffect(() => {
        const element = diffRef.current
        if (element) element.scrollTop = 0
      }, [selectedPath, selectedCommit, mode, turnFile, scopeKey])

      useEffect(() => {
        if (mode !== 'turns' || !visible) return undefined
        const controller = new AbortController()
        const load = async () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          try {
            const data = await getJson('turns', { sessionId: scopeRef.current.sessionId || '' }, controller.signal)
            if (controller.signal.aborted) return
            setTurns(data.turns || [])
            setTurnsUnavailable(Boolean(data.unavailable))
            setTurnsError('')
          } catch (error) {
            if (controller.signal.aborted || (error && error.name === 'AbortError')) return
            setTurnsError(error.message || String(error))
          }
        }
        load()
        const timer = setInterval(load, 10000)
        return () => {
          controller.abort()
          clearInterval(timer)
        }
      }, [mode, visible, scopeKey])

      useEffect(() => {
        if (!turnFile) {
          setTurnDiff(null)
          setTurnDiffError('')
          return undefined
        }
        const controller = new AbortController()
        setTurnDiff(null)
        setTurnDiffError('')
        getJson('turn', { sessionId: scopeRef.current.sessionId || '', seq: turnFile.seq, index: turnFile.index }, controller.signal)
          .then((data) => {
            if (controller.signal.aborted) return
            setTurnDiff(data.diff || null)
            setTurnDiffError('')
          })
          .catch((error) => {
            if (controller.signal.aborted || (error && error.name === 'AbortError')) return
            setTurnDiffError(error.message || String(error))
          })
        return () => controller.abort()
      }, [turnFile, scopeKey])

      useEffect(() => {
        if (!selectedCommit) {
          setCommitDetail(null)
          setCommitError('')
          return undefined
        }
        const controller = new AbortController()
        setLoading(true)
        getJson('commit', { ...params(), hash: selectedCommit.hash }, controller.signal)
          .then((data) => {
            if (controller.signal.aborted) return
            setCommitDetail(data)
            setCommitError('')
            const files = data.files || []
            setSelectedPath(files.length > 0 ? files[0].path : null)
          })
          .catch((error) => {
            if (controller.signal.aborted || (error && error.name === 'AbortError')) return
            setCommitError(error.message || String(error))
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false)
          })
        return () => controller.abort()
      }, [selectedCommit, scopeKey])

      const refresh = useCallback(async () => {
        setLoading(true)
        const controller = new AbortController()
        if (selectedCommit) {
          try {
            const data = await getJson('commit', { ...params(), hash: selectedCommit.hash }, controller.signal)
            setCommitDetail(data)
            setCommitError('')
          } catch (error) {
            setCommitError(error.message || String(error))
          } finally {
            setLoading(false)
          }
          return
        }
        await Promise.all([loadSnapshot(controller.signal), loadWorktree(controller.signal)])
        if (mode === 'turns') {
          try {
            const data = await getJson('turns', { sessionId: scopeRef.current.sessionId || '' }, controller.signal)
            setTurns(data.turns || [])
            setTurnsUnavailable(Boolean(data.unavailable))
            setTurnsError('')
          } catch (error) {
            setTurnsError(error.message || String(error))
          }
        }
        setLoading(false)
      }, [selectedCommit, mode, loadSnapshot, loadWorktree, params])

      const goBack = () => {
        setSelectedCommit(null)
        setCommitDetail(null)
        setCommitError('')
        setSelectedPath(null)
      }

      const toggleGroup = (groupPath) => {
        setCollapsedGroups((previous) => ({ ...previous, [groupPath]: !previous[groupPath] }))
      }

      const expandFile = useCallback(
        async (file, context, focusLine) => {
          if (!file || file.binary) return
          if (expandedPath === file.path) {
            setExpandedPath(null)
            setFullFile(null)
            return
          }
          setExpandedPath(file.path)
          setExpandTarget(focusLine || firstChangeLine(file))
          setFullFile({ loading: true })
          try {
            const data = await getJson('content', { ...params(), path: file.path, ...(context || {}) })
            setFullFile({
              loading: false,
              text: data.text || '',
              truncated: Boolean(data.truncated),
              binary: Boolean(data.binary),
              tooLarge: Boolean(data.tooLarge),
            })
          } catch (error) {
            setFullFile({ loading: false, error: error.message || String(error) })
          }
        },
        [expandedPath, params],
      )

      const zoomEditor = useCallback((delta) => {
        setEditorFontSize((size) => Math.max(9, Math.min(28, size + delta)))
      }, [])

      const startEditing = useCallback(
        async (file, line, base) => {
          if (!file || file.binary) return
          setEditorMode('inline')
          setEditingPath(file.path)
          setEditTargetLine(line && line > 0 ? line : firstChangeLine(file))
          setDraft('')
          setDraftBaseline('')
          setSaveError('')
          try {
            const data = await getJson('content', { ...params(), path: file.path, base: base || '' })
            if (data.binary || data.tooLarge) {
              setEditingPath(null)
              showNotice(t(data.binary ? 'state.binary' : 'state.fileTooLarge'))
              return
            }
            const buffer = buildEditBuffer(data.text || '', file)
            setDraft(buffer)
            setDraftBaseline(buffer)
            setDraftMtime(data.mtimeMs || 0)
            setDraftVersion((value) => value + 1)
          } catch (error) {
            setEditingPath(null)
            showNotice(error.message || String(error))
          }
        },
        [params, showNotice, t],
      )

      const saveDraft = useCallback(
        async (base) => {
          if (!editingPath) return
          setSaving(true)
          setSaveError('')
          try {
            const result = await postJson(
              'write',
              { ...params(), path: editingPath, base: base || '' },
              { text: stripGhostRows(draft), expectedMtimeMs: draftMtime },
            )
            setDraftMtime(result.mtimeMs || 0)
            setDraftBaseline(draft)
            showNotice(t('state.savedFile'), true)
            await loadWorktree(new AbortController().signal)
            await loadSnapshot(new AbortController().signal)
          } catch (error) {
            setSaveError(error.message || String(error))
          } finally {
            setSaving(false)
          }
        },
        [editingPath, draft, draftMtime, params, showNotice, t, loadWorktree, loadSnapshot],
      )

      const exitEditing = useCallback(() => {
        if (stripGhostRows(draft) !== stripGhostRows(draftBaseline) && typeof window !== 'undefined' && typeof window.confirm === 'function') {
          if (!window.confirm(t('state.confirmDiscard'))) return
        }
        setEditingPath(null)
        setSaveError('')
        setDraft('')
        setDraftBaseline('')
        setEditorMode('inline')
      }, [draft, draftBaseline, t])

      const jumpEdit = useCallback(
        (line) => {
          const area = editorAreaRef.current
          if (!area) return
          const lines = draft.split('\n')
          const target = Math.max(1, line || 1)
          let contentSeen = 0
          let row = 0
          let offset = 0
          for (let index = 0; index < lines.length; index += 1) {
            const isGhost = lines[index].startsWith(GHOST_MARK)
            if (!isGhost) contentSeen += 1
            if (contentSeen >= target && !isGhost) {
              row = index
              break
            }
            offset += lines[index].length + 1
          }
          area.focus()
          try {
            area.setSelectionRange(offset, offset)
          } catch {
            /* ignore */
          }
          area.scrollTop = Math.max(0, (row + 1 - 4) * Math.round(editorFontSize * 1.6))
        },
        [draft, editorFontSize],
      )

      const renderFileRows = (files, groups) => {
        const rows = []
        for (const file of files.filter((item) => !item.group)) {
          rows.push(h(FileRow, { key: file.path, file, active: file.path === selectedPath, onSelect: setSelectedPath }))
        }
        for (const group of groups) {
          const collapsed = Boolean(collapsedGroups[group.path])
          rows.push(h(GroupHeader, { key: `group:${group.path}`, group, collapsed, t, onToggle: () => toggleGroup(group.path) }))
          if (collapsed) continue
          if (group.error) {
            rows.push(h('div', { key: `error:${group.path}`, className: 'crv-note' }, group.error))
            continue
          }
          for (const commit of (group.commits || []).slice(0, 8)) {
            rows.push(
              h(
                'div',
                { className: 'crv-subcommit', key: `commit:${group.path}:${commit.short}` },
                h('span', { className: 'crv-hash' }, commit.short),
                h('span', { className: 'crv-subject' }, commit.subject),
              ),
            )
          }
          for (const file of group.files || []) {
            rows.push(h(FileRow, { key: file.path, file, active: file.path === selectedPath, onSelect: setSelectedPath }))
          }
        }
        return rows
      }

      const addedLines = (file) => {
        const set = new Set()
        for (const hunk of (file && file.hunks) || []) {
          for (const line of hunk.lines || []) {
            if (line.kind === 'add' && line.new !== null && line.new !== undefined) set.add(line.new)
          }
        }
        return set
      }

      const renderDiffPane = (sourceFiles, truncated) => {
        const active = sourceFiles.find((file) => file.path === selectedPath) || sourceFiles[0]
        const repoRoot = snapshot && snapshot.repo ? snapshot.repo.root : ''
        const isEditing = Boolean(active && editingPath === active.path)
        const marks = isEditing ? changeMarks(active) : []
        const total = isEditing ? draft.split('\n').filter((line) => !line.startsWith(GHOST_MARK)).length : 0
        return h(
          'div',
          { className: 'crv-diffwrap' },
          h(
            'div',
            { className: 'crv-diff', ref: diffRef },
            notice
              ? h(
                  'div',
                  { className: 'crv-notice' },
                  notice,
                  h('button', { className: 'crv-btn', style: { marginLeft: 'auto' }, onClick: () => setNotice('') }, '×'),
                )
              : null,
            truncated ? h('div', { className: 'crv-note' }, t('state.truncated')) : null,
            active
              ? h(FileCard, {
                  file: active,
                  t,
                  editLabel: t('action.editAt'),
                  editing: isEditing,
                  draft,
                  editLine: editTargetLine,
                  draftVersion,
                  dirty: stripGhostRows(draft) !== stripGhostRows(draftBaseline),
                  saving,
                  saveError,
                  onDraft: setDraft,
                  onSave: () => saveDraft(repoRoot),
                  onExitEdit: exitEditing,
                  onRegisterArea: (element) => {
                    editorAreaRef.current = element
                  },
                  onEdit: (line) => startEditing(active, line, repoRoot),
                  onEditAt: (line) => startEditing(active, line, repoRoot),
                  editorMode,
                  onFloat: () => setEditorMode((previous) => (previous === 'inline' ? 'float' : 'inline')),
                  onFull: () => setEditorMode((previous) => (previous === 'inline' ? 'full' : 'inline')),
                  fontSize: editorFontSize,
                  onZoom: zoomEditor,
                })
              : h(Empty, { title: t('state.selectFile') }),
          ),
          isEditing && total > 0 ? h(Minimap, { marks, total, onJump: jumpEdit, t }) : null,
          isEditing && editorMode !== 'inline'
            ? h(
                EditorDialog,
                {
                  t,
                  title: active.path,
                  full: editorMode === 'full',
                  saving,
                  onDock: () => setEditorMode('inline'),
                  onToggleFull: () => setEditorMode(editorMode === 'full' ? 'float' : 'full'),
                  onSave: () => saveDraft(repoRoot),
                  onClose: exitEditing,
                },
                h(
                  'div',
                  { className: 'crv-dlgcontent' },
                  h(EditableFileView, {
                    t,
                    draft,
                    added: addedLines(active),
                    editing: true,
                    editLine: editTargetLine,
                    draftVersion,
                    dirty: stripGhostRows(draft) !== stripGhostRows(draftBaseline),
                    saving,
                    saveError,
                    onDraft: setDraft,
                    onSave: () => saveDraft(repoRoot),
                    onExit: exitEditing,
                    onRegisterArea: (element) => {
                      editorAreaRef.current = element
                    },
                    fontSize: editorFontSize,
                    onZoom: zoomEditor,
                  }),
                  h(Minimap, { marks, total, onJump: jumpEdit, t }),
                ),
              )
            : null,
        )
      }

      const renderCommitsList = () => {
        if (!snapshot) return h('div', { className: 'crv-note' }, t('state.loading'))
        const commits = snapshot.commits || []
        if (commits.length === 0) return h(Empty, { title: t('state.emptyCommits') })
        return h(
          'div',
          { className: 'crv-list crv-flat' },
          commits.map((commit) => h(CommitRow, { key: commit.hash, commit, onSelect: setSelectedCommit })),
          commits.length >= 40 ? h('div', { className: 'crv-note' }, t('state.commitsLimit').replace('{n}', String(commits.length))) : null,
        )
      }

      const renderWorktree = () => {
        if (worktreeError) return h(ErrorBox, { message: worktreeError, onRetry: refresh, retryLabel: t('action.retry') })
        if (!worktree) return h('div', { className: 'crv-note' }, t('state.loading'))
        const files = worktree.files || []
        if (files.length === 0) {
          return h(Empty, { title: t('state.emptyWorktree'), hint: t('state.emptyWorktreeHint') })
        }
        return h(
          'div',
          { className: 'crv-body' },
          h('div', { className: 'crv-list' }, renderFileRows(files, worktree.groups || [])),
          renderDiffPane(files, worktree.truncated),
        )
      }

      const renderCommitDetail = () => {
        if (commitError) return h(ErrorBox, { message: commitError, onRetry: refresh, retryLabel: t('action.retry') })
        if (!commitDetail) return h('div', { className: 'crv-note' }, t('state.loading'))
        const files = commitDetail.files || []
        if (files.length === 0) return h(Empty, { title: t('state.commitMissing') })
        return h(
          'div',
          { className: 'crv-body' },
          h('div', { className: 'crv-list' }, renderFileRows(files, commitDetail.groups || [])),
          renderDiffPane(files, commitDetail.truncated),
        )
      }

      const renderTurns = () => {
        if (turnsError) return h(ErrorBox, { message: turnsError, onRetry: refresh, retryLabel: t('action.retry') })
        if (turnsUnavailable) return h(Empty, { title: t('state.turnsUnavailable') })
        if (!turns) return h('div', { className: 'crv-note' }, t('state.loading'))
        if (turns.length === 0) return h(Empty, { title: t('state.emptyTurns'), hint: t('state.emptyTurnsHint') })
        const turnEditing = Boolean(turnDiff && editingPath === turnDiff.path)
        const turnTotalRows = turnEditing ? draft.split('\n').filter((line) => !line.startsWith(GHOST_MARK)).length : 0
        return h(
          'div',
          { className: 'crv-body' },
          h(
            'div',
            { className: 'crv-list' },
            turns.map((turn) =>
              h(
                'div',
                { className: 'crv-turn', key: turn.seq },
                h(
                  'div',
                  { className: 'crv-turnhead' },
                  h('b', null, t('label.turn').replace('{n}', String(turn.turn))),
                  h('span', { className: 'crv-grow' }),
                  h('span', null, t('label.turnFiles').replace('{n}', String(turn.total))),
                  h('span', { className: 'crv-plus' }, `+${formatCount(turn.added)}`),
                  h('span', { className: 'crv-minus' }, `-${formatCount(turn.deleted)}`),
                ),
                (turn.files || []).map((file) =>
                  h(TurnFileRow, {
                    key: `${turn.seq}-${file.index}`,
                    file,
                    active: Boolean(turnFile && turnFile.seq === turn.seq && turnFile.index === file.index),
                    onSelect: () => setTurnFile({ seq: turn.seq, index: file.index, path: file.path }),
                  }),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'crv-diffwrap' },
            h(
              'div',
              { className: 'crv-diff', ref: diffRef },
              notice
                ? h(
                    'div',
                    { className: 'crv-notice' },
                    notice,
                    h('button', { className: 'crv-btn', style: { marginLeft: 'auto' }, onClick: () => setNotice('') }, '×'),
                  )
                : null,
              turnDiffError ? h('div', { className: 'crv-error' }, turnDiffError) : null,
              turnDiff
                ? h(FileCard, {
                    file: turnDiff,
                    t,
                    editLabel: t('action.editAt'),
                    editing: editingPath === turnDiff.path,
                    draft,
                    editLine: editTargetLine,
                    draftVersion,
                    dirty: stripGhostRows(draft) !== stripGhostRows(draftBaseline),
                    saving,
                    saveError,
                    onDraft: setDraft,
                    onSave: () => saveDraft(scopeRef.current.cwd || ''),
                    onExitEdit: exitEditing,
                    onRegisterArea: (element) => {
                      editorAreaRef.current = element
                    },
                    onEdit: (line) => startEditing(turnDiff, line, scopeRef.current.cwd),
                    onEditAt: (line) => startEditing(turnDiff, line, scopeRef.current.cwd),
                    fontSize: editorFontSize,
                    onZoom: zoomEditor,
                  })
                : h(Empty, { title: turnFile ? t('state.loading') : t('state.selectFile') }),
            ),
            turnDiff && editingPath === turnDiff.path && turnTotalRows > 0
              ? h(Minimap, { marks: changeMarks(turnDiff), total: turnTotalRows, onJump: jumpEdit, t })
              : null,
          ),
        )
      }

      const header = selectedCommit
        ? h(
            'div',
            { className: 'crv-head' },
            h(
              'div',
              { className: 'crv-row' },
              h('button', { className: 'crv-btn', onClick: goBack }, `← ${t('action.back')}`),
              h('span', { className: 'crv-hash' }, selectedCommit.short),
              h('span', { className: 'crv-grow' }),
              loading ? h('span', { className: 'crv-pulse' }) : null,
              h('button', { className: 'crv-btn', onClick: refresh, disabled: loading }, t('action.refresh')),
            ),
            h('div', { className: 'crv-subject', title: selectedCommit.subject }, selectedCommit.subject || ''),
            h(
              'div',
              { className: 'crv-meta' },
              h('span', { className: 'crv-ellipsis' }, selectedCommit.author || ''),
              h('span', { className: 'crv-ellipsis' }, (selectedCommit.date || '').slice(0, 16)),
              commitDetail && commitDetail.commit && commitDetail.commit.refs
                ? h('span', { className: 'crv-ellipsis', style: { opacity: 0.7 } }, commitDetail.commit.refs)
                : null,
              h('span', { className: 'crv-grow' }),
              h('span', { className: 'crv-ver', title: 'dsh-code-review-tab' }, `v${PLUGIN_VERSION}`),
            ),
          )
        : h(
            'div',
            { className: 'crv-head' },
            h(
              'div',
              { className: 'crv-row' },
              h(
                'div',
                { className: 'crv-seg' },
                h(
                  'button',
                  { 'data-active': mode === 'worktree' ? 'true' : 'false', onClick: () => setMode('worktree') },
                  t('mode.worktree'),
                ),
                h('button', { 'data-active': mode === 'commits' ? 'true' : 'false', onClick: () => setMode('commits') }, t('mode.commits')),
                h(
                  'button',
                  { 'data-active': mode === 'turns' ? 'true' : 'false', onClick: () => setMode('turns') },
                  t('mode.turns'),
                ),
              ),
              h('span', { className: 'crv-grow' }),
              loading ? h('span', { className: 'crv-pulse' }) : null,
              h('button', { className: 'crv-btn', onClick: refresh, disabled: loading }, t('action.refresh')),
            ),
            h(
              'div',
              { className: 'crv-meta' },
              snapshot && snapshot.repo ? h('span', { className: 'crv-ellipsis', title: snapshot.repo.root }, snapshot.repo.name) : null,
              snapshot && snapshot.repo && snapshot.repo.branch
                ? h('span', { className: 'crv-branch', title: snapshot.repo.branch }, snapshot.repo.branch)
                : snapshot && snapshot.repo && snapshot.repo.detached
                  ? h('span', { className: 'crv-branch' }, t('label.detached'))
                  : null,
              snapshot && snapshot.counts && snapshot.counts.files > 0
                ? h(
                    'span',
                    { className: 'crv-ellipsis' },
                    `${snapshot.counts.files} ${snapshot.counts.files === 1 ? t('label.filesOne') : t('label.files')}`,
                    ' ',
                    h('span', { className: 'crv-plus' }, `+${formatCount(snapshot.counts.additions)}`),
                    ' ',
                    h('span', { className: 'crv-minus' }, `-${formatCount(snapshot.counts.deletions)}`),
                  )
                : null,
              h('span', { className: 'crv-grow' }),
              h('span', { className: 'crv-ver', title: 'dsh-code-review-tab' }, `v${PLUGIN_VERSION}`),
            ),
          )

      let body
      if (selectedCommit) body = renderCommitDetail()
      else if (mode === 'turns') body = renderTurns()
      else if (snapshotError) body = h(ErrorBox, { message: snapshotError, onRetry: refresh, retryLabel: t('action.retry') })
      else if (snapshot && snapshot.ok && !snapshot.repo) {
        body = h(Empty, {
          title: t('state.noRepo'),
          hint: t('state.noRepoHint'),
          action: h(
            'button',
            { className: 'crv-btn', style: { marginTop: 6 }, onClick: () => setMode('turns') },
            t('mode.turns'),
          ),
        })
      } else if (mode === 'commits') body = renderCommitsList()
      else body = renderWorktree()

      return h('div', { className: 'crv-root' }, h('style', null, STYLE), header, body)
    }

    function TabIcon(size) {
      const s = size || 16
      return h(
        'svg',
        { viewBox: '0 0 16 16', width: s, height: s, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 2.5, y: 1.5, width: 11, height: 13, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.75 }),
        h('path', { d: 'M5 5.2h6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: 0.55 }),
        h('path', { d: 'M5 8h6', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: 0.55 }),
        h('path', { d: 'M5 10.8h3.4', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: 0.55 }),
        h('circle', { cx: 12.1, cy: 12.6, r: 2.5, fill: 'var(--dsw-alias-bg-base)' }),
        h('path', {
          d: 'M10.6 12.6h3',
          stroke: 'var(--dsw-alias-state-success-primary)',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    return {
      inject: ['locale', 'slots'],
      apply(ctx) {
        const locale = ctx.get('locale')
        if (locale && typeof locale.register === 'function') {
          ctx.effect(() => {
            const disposers = []
            try {
              disposers.push(locale.register(NS, 'zh', DICT_ZH))
              disposers.push(locale.register(NS, 'en', DICT_EN))
            } catch {
              /* another instance already owns this namespace */
            }
            return () => {
              for (const dispose of disposers) {
                try {
                  dispose()
                } catch {
                  /* already disposed */
                }
              }
            }
          }, 'code-review: locale dictionaries')
        }

        let translate = null
        const t = (key) => {
          if (!translate) translate = makeTranslate(ctx)
          return translate(key)
        }
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.input.left', () =>
              ctx.slots.register(
                { name: 'conversation.input.left', id: 'dsh-code-review:launcher', order: 30 },
                (slotProps) => h(ReviewLauncher, { ...slotProps, ctx, t }),
              ),
            ),
          'code-review: composer launcher',
        )
        ctx.effect(
          () =>
            ctx.slots.inject('shell.overlay', () =>
              ctx.slots.register(
                { name: 'shell.overlay', id: 'dsh-code-review:drawer', order: 50 },
                (slotProps) => h(ReviewDrawer, { ...slotProps, ctx, t }),
              ),
            ),
          'code-review: review drawer',
        )
        ctx.effect(() => {
          // The native right Sidebar registry can appear after this plugin
          // mounts, so probe for it instead of assuming it exists.
          let stopped = false
          let disposeType = null
          const disposers = []
          let attempts = 0
          const register = (tabs) => {
            try {
              disposeType = tabs.register({
                id: 'dsh-code-review-tab',
                kind: 'code-review-tab',
                keepMounted: true,
                priority: 'extension',
                title: () => t('tab.title'),
                guide: [
                  {
                    id: 'code-review-tab',
                    order: 40,
                    title: () => t('tab.title'),
                    description: () => t('tab.description'),
                  },
                ],
              })
              disposers.push(
                ctx.slots.inject('sidebar.right.pane.tab', () =>
                  ctx.slots.register(
                    {
                      name: 'sidebar.right.pane.tab',
                      key: 'dsh-code-review-tab',
                      inject: (sessionId) => ({ sessionId }),
                    },
                    (slotProps) => h(CodeReviewTab, { ctx, scope: { sessionId: slotProps.sessionId }, visible: true }),
                  ),
                ),
              )
              disposers.push(
                ctx.slots.inject('sidebar.right.pane.tab.title', () =>
                  ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: 'dsh-code-review-tab' }, () => h('span', null, t('tab.title'))),
                ),
              )
            } catch {
              try {
                if (disposeType) disposeType()
              } catch {
                /* already disposed */
              }
            }
          }
          const timer = setInterval(() => {
            if (stopped) return
            const tabs = ctx.get('sidebarRightTabs')
            if (tabs && typeof tabs.register === 'function') {
              clearInterval(timer)
              register(tabs)
              return
            }
            attempts += 1
            if (attempts > 120) clearInterval(timer)
          }, 250)
          return () => {
            stopped = true
            clearInterval(timer)
            for (const dispose of disposers.reverse()) {
              try {
                dispose()
              } catch {
                /* already disposed */
              }
            }
            try {
              if (disposeType) disposeType()
            } catch {
              /* already disposed */
            }
          }
        }, 'code-review: native right sidebar tab')
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.chat.markdown.fence', () =>
              ctx.slots.register(
                { name: 'conversation.chat.markdown.fence', id: 'dsh-code-review:fence-source', order: -100 },
                (slotProps) => h(FenceSource, { ...slotProps, t, ctx }),
              ),
            ),
          'code-review: chat fence source',
        )
      },
    }
  },
})
