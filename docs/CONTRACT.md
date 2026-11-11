# hbs-worktree 接口契约 v2

v2 换了模型：不再有「仓库注册表」和「init」。**当前项目就是当前选中的 Harness 工作区**，
git 命令直接在主业务代码目录里执行。本文件覆盖 v1 中冲突的部分。

## 1. 角色

| 部件 | 文件 | 职责 |
| --- | --- | --- |
| 引擎 | `lib/engine.js` | 唯一真相来源：`git worktree` 与分支操作 |
| 宿主 | `index.js` | 注册 skill + 一条 `POST /hbs-worktree/api` |
| 面板 | `client.js` | 左栏入口（`sidebar.panellist`）+ 整页（`main`，同 id `hbs-worktree`）+ 设置兜底 |
| CLI | `bin/hbs-wt.js` | 同一引擎的命令行入口（agent 用） |
| skill | `assets/hbs-worktree.md` | 绑定协议 |

## 2. 磁盘布局

```
<项目根>/                     ← Harness 工作区的 path，必须是 git 仓库
├── .worktree/                 ← 所有工作树，整体写进 .git/info/exclude
│   ├── .hbs-state.json       ← 只有元数据：主业务分支、会话绑定、备注
│   └── A-a/                  ← 工作树（分支 A-a）
```

`.worktree/.hbs-state.json`：

```json
{
  "version": 2,
  "base": "A",
  "entries": {
    "A-a": { "session": "session-6742…", "note": "解析器重写", "createdAt": "2026-11-10T02:00:00.000Z" }
  }
}
```

- `base`：主业务分支。第一次进入时取主仓库当前分支；之后只有 `switch` 到**非工作树分支**时才更新，
  所以在预览工作树分支期间「主业务」不会漂。
- `entries`：以分支名为键的纯元数据。工作树是否存在以 `git worktree list` 为准。

### 目录迁移

0.4.x 用的是 `worktree/`。0.5.0 起改为 `.worktree/`，并在**第一次读取**时自动迁移：
逐个 `git worktree move` 到新目录、`.hbs-state.json` 一起搬、从 exclude 里删掉旧的 `worktree/` 行、
旧目录空了就删掉。迁移失败（例如工作树被占用）会明确报错而不是留下半套布局。

## 3. 命令（POST `{cmd, args}` → 同一信封）

信封不变：`{ ok: true, data }` / `{ ok: false, error: { code, message, details } }`。

| 命令 | 参数 | 返回 data |
| --- | --- | --- |
| `repo` | `{}` | `{ root, isGit, base, preview, currentBranch, detached, dirty }` |
| `list` | `{}` | `{ root, isGit, base, preview, currentBranch, detached, dirty, worktrees: [row] }` |
| `add` | `{ branch, session?, note?, autoCommit? }` | `{ worktree: row }` |
| `update` | `{ branch, autoCommit }` | `{ branch, autoCommit }` |
| `follow` | — | `{ branch, changed, head, blocked? }` |
| `remove` | `{ branch, force? }` | `{ branch, removed: true }` |
| `switch` | `{ branch }` | `{ branch, base, preview, changed, detached }` |
| `merge` | `{ from, into }` | `{ from, into, merged: true }` |
| `bind` | `{ branch, session }` | `{ branch, session }` |
| `unbind` | `{ branch }` | `{ branch }` |
| `env` | `{ session }` | 绑定上下文或 `null` |
| `prune` | `{}` | `{ pruned: true }` |

`root` 由调用方在请求体里给出（面板取当前 Harness 工作区的 `path`；CLI 取当前目录）。

### row

```json
{
  "branch": "A-a",
  "path": "/项目/.worktree/A-a",
  "session": "session-6742…",
  "note": "解析器重写",
  "autoCommit": true,
  "createdAt": "2026-11-10T02:00:00.000Z",
  "exists": true,
  "dirty": false,
  "ahead": 2
}
```

`exists` 为 false 表示元数据还在但目录没了（可 `prune`）；`ahead` 是相对 `base` 的领先提交数。
`autoCommit` 默认 `true`：会话收尾自己提交并推送；用户可在操作列切成 `false`，此时会话不提交，
且 `switch` 会因工作树脏被拒绝（切过去也看不到未提交内容）。

### 预览 vs 切换

- 目标分支是**主业务分支或普通分支** → `git checkout <branch>`，主业务分支随之前移（`detached:false`）。
- 目标分支是**工作树分支** → `git checkout --detach <branch>`：git 不允许同一分支双检出，
  所以主业务目录只能 detached 显示它；`preview` 记下这条分支，`base` 不动（`detached:true`）。
  工作树本身不删、不动。切回普通分支时 `preview` 清空。
- `remove` 拒绝删除 `preview` 中的分支（主业务目录正显示它），`merge` 拒绝把工作树分支当目标。
- 面板在预览状态下必须显式标注：分支下拉旁一个「预览中」标签、一行说明（主代码已是该分支内容，
  但 git 只允许一处检出所以是 detached，提交回工作树做），以及一个「回到主业务」按钮。

### 分支下拉用的数据

`list.data.base` + `worktrees[].branch` 就够：主业务分支排第一并标「主业务」，其余是工作树分支。
`repo.data.isGit === false` 时面板顶部提示「当前主业务代码未初始化 git」，不再请求其它数据。

### 分支命名

- 切换 / 合并 / 删除 / 绑定：只认 **git 自己的分支规范**（`git check-ref-format`），
  所以 `feature/tm/v-3.58.0` 这类带 `/` 的分支名完全合法。
- 创建：同样允许 `/`，会落到 `.worktree/feature/tm/v-3.58.0`（嵌套目录）；
  但 `feat` 与 `feat/x` 不能同时存在（会变成工作树套工作树），`..`、`.hbs-state.json` 仍然拒绝。

### 错误码

`not-a-repo` `detached-head` `invalid-name` `branch-exists` `case-collision`
`worktree-missing` `unknown-worktree` `main-dirty` `worktree-dirty` `main-busy`
`conflict` `unmerged-commits` `not-pushed` `session-bound` `already-bound`
`no-sessions` `internal`

合并冲突：`conflict` + `details.files`（已 `merge --abort`，现场不留半成品）。

## 4. 面板入口与结构

三个槽位注册同一个页面组件，共用 id `hbs-worktree`：

- `sidebar.panellist`：左栏入口（`id` + `order` + `label` + 图标），点击后由布局调用
  `ctx.layout.selectPanel('hbs-worktree')`；
- `main`：`key: 'hbs-worktree'` 的整页面板，渲染同一个页面组件；
- `settings.section`：兜底入口（没有左栏的部署）。

页面结构：

```
[工作区 ▾]  [分支 ▾]                         [合并]  [刷新]
┌──────────────────────────────────────────────────────────┐
│ 分支    │ 会话      │ 备注   │ 状态   │ 操作             │
│ A-a     │ 修解析器  │ 重写…  │ 运行中 │ 删除             │
└──────────────────────────────────────────────────────────┘
[+ 新增工作树]
```

- **工作区下拉**：`ctx.workspaces.list.getSnapshot().items`（`workspaceId/title/path/sessionIds`），
  默认第一个；切换后整页数据换成该项目的。
- **分支下拉**：主业务分支 + 工作树分支；主业务那条带「主业务」标记。切换 = 执行 `switch`
  （主仓库 checkout，主代码跟着变）；失败时下拉回退到原值并显示错误原因。
- **合并按钮**：`worktrees.length > 0` 时出现。弹窗两个下拉：源（工作树分支）、目标（默认主业务分支）；
  确认后执行 `merge`，冲突时把 `details.files` 列出来。
- **新增弹窗**：分支名、**会话名称**（文本，不是选已有会话）、备注（选填）。提交后：
  1. `add { branch, note }` 建工作树；
  2. 客户端在**当前工作区**新建会话：`ctx.sessions.create({ workspaceId })`；
  3. 用输入的名称 `ctx.sessions.rename(sessionId, name)`（失败不阻塞）；
  4. `ctx.uiWorkspace.openSession(sessionId)` 把它显示出来（服务缺失时跳过）；
  5. `bind { branch, session: sessionId }` 让 `hbs-wt env` 立刻能查到工作树；
  6. 用 `sessions.using(sessionId, ...)` 拿到 binding，`session.prompt([{type:'text',text}], 'queue')`
     发第一条指令，内容是「读取 hbs-worktree skill + 工作目录就是 <path> + 只在该目录用绝对路径 / git -C 操作」。
  任何一步失败都要说清：工作树已建、会话未成，让用户自己补。
- **表格列**：分支 / 会话 / 备注 / 状态 / 操作。
  - 状态：会话 `running === true` → 「运行中」，否则「已完成」；未绑定会话显示「—」。
  - 操作：两个控件——「自动提交 / 手动提交」下拉（执行 `update`）+「删除」（二次确认后执行 `remove`；
    返回 `unmerged-commits` / `worktree-dirty` 时提示确认后可强制删）。
- **空态**：表格空 + 「新增工作树」。
- **非 git**：顶部提示，页面其余部分不渲染。

会话数据来源：`ctx.sessions.list.getSnapshot()`：
`byId[sessionId]` 有 `title`、`running`、`cwd`、`blank`；归档集合在
`ctx.workspaces.list.getSnapshot().archivedSessionIds`。

## 5. 跟随规则

`follow` 只在「主仓库是 detached HEAD 且 `preview` 指向某条工作树分支」时生效：

- 该分支 tip == HEAD → `changed: false`；
- 该分支有了新提交 → `git checkout --detach <branch>`，返回新的 `head`；
- 主仓库有未提交改动 → 不动作，返回 `blocked: 'main-dirty'`（绝不覆盖用户的工作区）；
- 停在普通分支 → `branch: null`，什么都不做。

面板在预览态每 4 秒调用一次；主业务分支和未被预览的工作树不会被跟随。

## 6. 提交规则

会话做完需求必须提交（`autoCommit: true`，默认）：分支独立，提交不影响主业务代码；不提交则
`switch` 会以 `worktree-dirty` 拒绝（预览只显示已提交内容），成果也看不见。
`autoCommit: false` 时会话不得提交，改为提示用户手动提交。

## 7. 会话归属

新建的会话用 `workspaceId` 挂在**面板当前选中的 Harness 工作区**下（不是 `cwd`），
所以它出现在那个项目里；「只操作工作树目录」由 skill 的纪律约束，而不是物理 cwd。
`cwd` 方案（会话根目录直接是工作树）隔离更强，但会话归类会脱离项目，v2 不采用。

## 8. skill 协议（随插件分发）

绑定后 agent 只在 `<root>/.worktree/<branch>` 里干活，全部用绝对路径、`git -C`，收尾仍走 CLI。
主业务分支由用户在面板上合并，agent 不碰。
