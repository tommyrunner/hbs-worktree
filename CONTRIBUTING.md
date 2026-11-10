# Contributing

本仓库是 DeepSeek Harness 的一个插件 bundle：宿主半边 `index.js`、浏览器半边 `client.js`、
一个不依赖 Harness 的引擎 `lib/`、一个 CLI `bin/hbs-wt.js`，以及随插件分发的 skill。

## 开发环境

```bash
npm run check        # 静态检查 + 一次真实 git 往返（会在临时仓库里跑）
npm test             # 引擎 + 宿主测试
npm run shot         # 用固定数据渲染面板并截图（需要 chrome）
npm pack             # 产出可安装的 tgz
```

面板渲染测试需要 React 与 jsdom（只是测试期依赖，插件本身零依赖）：

```bash
NODE_PATH=<装着 react react-dom jsdom 的目录> node --test test/panel.render.test.mjs
```

在本地 Harness 里验证：

1. 插件管理器安装 `npm pack` 出来的 tgz（面板 + skill + CLI 都在里面，不需要额外装 skill）；
2. 刷新页面，打开 设置 → 工作树；
3. 想在终端里直接用 `hbs-wt` 再 `npm link`，会话里的 agent 不依赖它（skill 有兜底路径）。

## 结构约束

- **`lib/` 不 import 任何 `@deepseek-ai/*`。** 引擎必须能只用 node 内置模块启动，否则 CLI 会在没有 Harness 的环境里挂掉。
- **`index.js` 只做搬运**：注册 skill provider、把引擎挂到 `POST /hbs-worktree/api`。业务判断一律在 `lib/engine.js`。
- **`client.js` 不算状态**：所有工作区/分支/会话数据都从 HTTP 信封来，面板只做展示与触发。
- 面板视觉与 `dsh-extended-panel` 一致：`React.createElement`、内联 style、`--dsw-alias-*` 主题变量、无 CSS 文件、无第三方依赖。
- 字典 `en` / `zh` 的 key 必须完全一致，且每个 key 都要在代码里以 `t('key')` 出现（`npm run check` 会查）。
- 破坏性操作（删除、强制、合并）必须二次确认，并优先回滚而不是留下半成品状态。

## 加一条命令

1. `docs/CONTRACT.md` 第 3 节加一行（参数 + 返回 data 形状）；
2. `lib/engine.js` 写 handler，注册进 `COMMANDS`；
3. `bin/hbs-wt.js` 加参数映射与人类可读输出；
4. `client.js` 需要的话加按钮/弹窗（注意按钮的可用性规则）；
5. `test/engine.test.mjs` 加用例；`npm run check` 的往返也可以顺带覆盖。

## 提交前

- [ ] `npm run check` 全绿
- [ ] `npm test` 全绿
- [ ] `npm pack --dry-run` 里没有多余文件
- [ ] 改了界面就 `npm run shot` 看一眼宽/窄两种宽度
- [ ] `CHANGELOG.md` 加一条

## 许可

提交的代码按 MIT 许可发布。
