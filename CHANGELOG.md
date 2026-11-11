# Changelog

## 1.2.0 — 2026-11-11

- The panel moved out of Settings: a **left-sidebar entry** (the same rail as Tasks and
  Plugins) opens it as a full page. Clicking the entry selects the `main` panel
  registered under the same id, which is how the official packages ship their own
  management pages.
- Settings keeps the same page as a fallback entry for deployments without the
  sidebar rail; all three surfaces render one component.
- The sidebar icon is an inline SVG (the plugin still imports nothing but React).

## 1.1.1 — 2026-11-10

- **Fixed: switching the branch in the panel could look like it did nothing.** A
  preview recorded in `.hbs-state.json` survived an outside `git checkout`, so the
  picker believed it was already on that branch and the click was skipped. The
  engine now reconciles the stored preview against git on every read, and the page
  always asks the engine instead of short-circuiting on its own stale value.
- The page re-reads the project when the window regains focus or becomes visible,
  so a branch changed in an editor or terminal shows up without pressing Refresh.
- `switch` reports `changed`/`currentBranch` honestly, including "already there",
  and re-previewing the same branch tip no longer re-checks out anything.

## 1.1.0 — 2026-11-10

首个正式对外版本（接在 1.0.1 之后；下面的 0.x 记录是发布前的开发过程）。

**一个需求 = 一个 git 工作树 = 一个专属会话。**

- **面板**：设置 → 工作树。工作区下拉、分支下拉、工作树表格（分支 / 会话 / 备注 / 状态 / 操作）。
- **新建即全套**：填分支名 + 会话名（+ 备注），一次点击完成——建分支、检出到 `.worktree/<分支>`、
  在当前工作区新建会话并命名、绑定到该工作树、自动发出首条锁定指令。
- **自动提交（默认开）**：会话做完需求自己 `commit` + `push`；操作列的下拉可切成「手动提交」，
  此时会话不提交，且工作树有未提交改动时不允许被预览（切过去也看不到）。
- **预览**：分支下拉切过去，主目录变成该分支内容可直接运行（detached HEAD），一键「回到主业务」。
- **合并**：弹窗选源/目标（默认主业务分支），普通 `git merge`；冲突自动回滚并列出文件清单。
- **删除**：目录 + 分支一起删；有未提交改动或未合并提交时要求二次确认。
- **CLI**：`hbs-wt repo / list / add / update / bind / env / switch / merge / remove / prune`，
  `--json` 与面板共用同一套信封；skill 里带 profile 路径兜底，不 `npm link` 也能用。
- **自带 skill**：7 条硬规矩，会话只允许改 `.worktree/<分支>` 下的绝对路径、`git -C`、做完必须提交。
- **零依赖**：插件本身不依赖任何 npm 包，引擎只用 node 内置模块。

### 兼容性

- 工作树目录为 `.worktree/`（隐藏）。0.4.x 的 `worktree/` 布局在第一次打开时自动迁移。
- 需要 `dsh web`（浏览器）部署才能使用面板；Electron 桌面壳里用 CLI。

## 0.6.1 — 2026-11-10

- The actions column is centered — header and the two controls (auto-commit picker,
  delete) line up in the middle of the column instead of hugging its right edge.

## 0.6.0 — 2026-11-10

- **Auto-commit is now a per-worktree setting**, on by default and switched from the
  actions column (`update` command). The skill asks the session to commit and push when
  the requirement is done — a separate branch cannot touch the main code, while *not*
  committing leaves the work invisible and makes a preview fail.
- `switch` refuses to preview a worktree with uncommitted changes (`worktree-dirty`),
  saying why instead of silently showing the old content.
- The actions column holds two controls now (auto-commit picker + delete); column widths
  were rebalanced (16 / 29 / 17 / 11 / 27 %) and checked at 1180 / 900 / 700 px.
- `hbs-wt env` and `list` rows report `autoCommit`, so the agent reads the setting live.

## 0.5.3 — 2026-11-10

- README install section rewritten for both audiences: users take the tarball from Releases
  (no commands at all), maintainers run `npm pack`; a table lists what the panel, skill, and
  CLI look like after install, plus why neither the skill nor `npm link` is needed.
- FAQ gained the two questions that get asked: "does someone else have to install the skill?"
  and "do they need `npm link`?"

## 0.5.2 — 2026-11-10

- Installing the plugin is the only step: the skill was always registered by the host
  half, and the CLI now has a documented fallback
  (`node "$DSH_PROFILE_DIR/node_modules/hbs-worktree/bin/hbs-wt.js"`), so a user who
  never ran `npm link` still gets a working agent.
- The skill no longer stops at "hbs-wt is not on PATH": it tries PATH first, then the
  profile install, and only asks the user when both fail. It also treats the worktree
  path in the panel's first message as the binding when the CLI is unavailable.
- README install section says this explicitly in both languages.

## 0.5.1 — 2026-11-10

Packaged as a GitHub-ready repository.

- Repository root is the plugin: `index.js`, `client.js`, `lib/`, `bin/`, `assets/`,
  `docs/`, `test/`, `scripts/` (the old `hbs-worktree-pro/hbs-worktree/` nesting is gone).
- Added `.gitignore`, `.github/workflows/ci.yml` (node 22 + 24: check, tests, pack dry-run),
  `CONTRIBUTING.md`, `promo/home.png`, and `docs/screenshots/`.
- README (English) and README.zh.md (Chinese) rewritten: what the plugin is, the five
  pain points it removes, step-by-step usage with the effect of each step, the branch
  model, the CLI, the session protocol, state layout, and an FAQ.
- `package.json` now carries `repository`, `homepage`, and `bugs`; the published file
  list drops the screenshots and promo art.

## 0.5.0 — 2026-11-10

- The worktree directory is now `.worktree/` (hidden) instead of `worktree/`, so the
  project root stays visually clean.
- Existing worktrees under `worktree/` are migrated automatically on first use:
  each one is relocated with `git worktree move`, the metadata file moves with it,
  the stale `worktree/` exclude line is dropped, and the empty legacy directory is
  removed. A worktree git refuses to move fails loudly instead of leaving a split
  layout.

## 0.4.1 — 2026-11-10

- The toolbar never wraps: the two pickers shrink first (flex-basis with a cap),
  the action buttons keep their width, so 「合并」「刷新」stay on the same line at
  every panel width. Verified at 1180 / 900 / 700 px.
- Pickers are narrower by default (workspace caps at 220 px, branch at 320 px)
  instead of a fixed 180 + 220.
- The preview strip is one paragraph — bold label, then the explanation — with the
  button pinned right, instead of three flex children that drifted apart.

## 0.4.0 — 2026-11-10

Panel layout rebuilt around one reading order instead of stacked fragments:

- Header, then **one** toolbar row (workspace · branch · merge · refresh), then an
  optional state strip, then the table, then one footer row with `+ 新增工作树`
  and the worktree count.
- The detached-preview warning is now a single strip under the toolbar — label,
  explanation, and a small `回到主业务` button on the right — instead of a badge
  and a button wedged into the toolbar plus a loose paragraph.
- The table always renders (with a real empty row) so the page does not jump
  between states, and the count moved out of the table into the footer.
- Error, loading, non-git, and empty states share one strip style.

## 0.3.3 — 2026-11-10

- The panel now says when it is previewing a worktree branch: a "previewing" tag,
  a line explaining that the main checkout holds the branch content on a detached
  HEAD (git allows one checkout per branch), and a "back to main line" button.
  Without it the state looked like a switch that never happened, because
  `git status` only says `HEAD (no branch)`.
- `npm run shot` gained `--preview` and now mirrors select/input values into
  attributes before serialising, so a screenshot shows the real selection instead
  of the first option.

## 0.3.2 — 2026-11-10

- Branch names are validated by `git check-ref-format`, not by the directory-name
  rules this tool uses for the worktrees it creates. Switching, merging, deleting,
  and binding now accept `feature/tm/v-3.58.0` and every other legal branch; the
  previous code reused the flat-directory pattern and refused any slash.
- Creating a worktree with a slash branch puts it at `worktree/feature/tm/v-3.58.0`.
  `feat` and `feat/x` are refused together, since that nests one worktree inside
  another; `..` and `.hbs-state.json` stay rejected.
- Duplicate creation now answers `branch-exists`; only a case-only difference
  answers `case-collision`.

## 0.3.1 — 2026-11-10

- Fixed the worktree table: long session titles and notes overflowed their cells
  and painted over the status column, and the note column collapsed to nothing.
  The clip style needed `display: block` — `overflow`/`text-overflow` do nothing on
  an inline `<span>` — and the five column widths are now declared once in a
  `<colgroup>` (20 / 34 / 24 / 10 / 12 %) instead of being split across header and
  body cells.
- Rows get a hover highlight and the last row drops its bottom border.
- `npm run shot` renders the panel against fixtures and screenshots it with
  headless Chrome, so layout regressions are visible without opening the Harness.

## 0.3.0 — 2026-11-10

- Creating a worktree now creates its session: the add dialog takes a session
  **name** instead of a picker, then the panel creates a blank session in the
  selected Harness workspace, renames it, reveals it, binds it to the worktree,
  and queues the first instruction ("read the hbs-worktree skill, work only in
  `<project>/worktree/<branch>` with absolute paths and `git -C`").
- Session choice in the dialog is gone, so the panel no longer filters archived
  sessions; it only needs `sessions` for the running state column.
- Failures are split: a worktree that was created stays usable, and the panel
  says which half failed and prints the instruction to send by hand.

## 0.2.0 — 2026-11-10

Rewritten around the project the panel is looking at, not a registry of them.

- The selected Harness workspace **is** the project: no repository registry, no
  `init`, no `.worktree/config.json`. `hbs-wt repo` answers "not a git repository"
  for a plain directory instead of failing.
- One level instead of two: worktrees branch straight off the 主业务分支, live in
  `<project>/worktree/<branch>`, and are created from the panel.
- `worktree/.hbs-state.json` holds only the base branch, session bindings, and
  notes; which worktrees exist is read from `git worktree list`.
- Previewing a worktree branch in the main checkout uses a detached HEAD (git
  refuses a second checkout of the same branch), and the base branch no longer
  moves while previewing.
- New commands: `repo`, `add`, `remove`, `switch`, `merge --from/--into`, `bind`,
  `unbind`, `env`, `prune`. Removed: `init`, `new`, `sub`, `done`, `repos`.
- Panel: workspace picker, branch picker, table of worktrees (branch / session /
  note / running state / delete), add dialog, merge dialog.

## 0.1.1 — 2026-11-10

- The repository registry (`~/.hbs-worktree/repos.json`) is now best-effort: a
  sandboxed session denied that path still gets a working worktree command.
- Panel: when no repository is registered, the empty state accepts an absolute
  repository path and initializes it in place, instead of only showing a hint.
- Panel: `switch` is disabled while a session holds the branch, matching the
  engine's `session-bound` refusal, and the health bar offers "back to base
  branch" so a preview can be ended from the UI.

## 0.1.0 — 2026-11-09

First version.

- Engine (`lib/engine.js`): `init`, `new`, `sub`, `bind`, `unbind`, `env`, `list`,
  `status`, `done`, `merge`, `switch`, `rm`, `prune`, `repos`.
- State, configuration, and worktrees all live under `<repo>/.worktree/`; the
  engine keeps that directory gitignored.
- Two-level branch model: `base → A → A-a`, with `done` merging a session
  sub-branch back into its feature branch and `merge` merging the feature branch
  into the base branch. Both roll back and report the conflicted files.
- CLI `hbs-wt` with `--json` envelopes shared with the panel.
- Host half registers the `hbs-worktree` skill and exposes `POST /hbs-worktree/api`.
- Panel in Settings → Worktrees: repository picker, health bar, workspace list
  with sub-branches, create / bind / switch / merge / delete.
