#!/usr/bin/env node
/**
 * `hbs-wt` — the command line an agent uses.
 *
 * It owns no logic: argv becomes one engine command, and the envelope is printed
 * as text for a human or as JSON for a caller. The project directory is the
 * current directory (or `--root`), and its checked-out branch is the base.
 *
 *   hbs-wt repo                 what the current project looks like
 *   hbs-wt list                 every worktree
 *   hbs-wt add A-a --session …  create branch A-a under worktree/
 *   hbs-wt bind A-a             bind the current session to A-a
 *   hbs-wt env                  where this session should work
 *   hbs-wt switch A-a           check the main project out on A-a
 *   hbs-wt merge A-a --into A   merge a worktree branch into the base
 *   hbs-wt remove A-a           delete the worktree and its branch
 */
import { runCommand } from '../lib/engine.js';

const USAGE = `用法: hbs-wt <命令> [参数] [选项]

命令:
  repo                        当前项目状态（是否 git 仓库、主业务分支、当前分支）
  list                        列出全部工作树
  add <分支>                  从主业务分支建一个工作树到 worktree/<分支>
  remove <分支>               删除工作树及其分支（--force 丢弃未合并提交）
  switch <分支>               把主业务目录切到该分支
  merge <源分支>              把源分支合并到目标分支（--into，默认主业务分支）
  bind <分支>                 把当前会话绑定到该工作树
  unbind <分支>               解除该工作树的会话绑定
  env                         打印当前会话绑定的工作树路径
  prune                       清理僵尸 worktree 元数据

选项:
  --root <路径>               项目根目录，默认当前目录
  --session <id>              显式指定会话，默认取 DSH_SESSION_ID
  --note <文本>               add 时的备注
  --into <分支>               merge 的目标分支，默认主业务分支
  --force                     remove 时允许丢弃未合并提交
  --json                      输出 JSON 信封`;

/** Split argv into positionals and options. */
function parse(argv) {
  const positionals = [];
  const options = { json: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') options.json = true;
    else if (token === '--force') options.force = true;
    else if (token === '--root') options.root = argv[++index];
    else if (token === '--session') options.session = argv[++index];
    else if (token === '--note') options.note = argv[++index];
    else if (token === '--into') options.into = argv[++index];
    else if (token.startsWith('--')) throw new Error(`未知选项: ${token}`);
    else positionals.push(token);
  }
  return { positionals, options };
}

/** Map one command and its positionals to engine arguments. */
function argsOf(cmd, positionals, options) {
  const args = {};
  if (options.session !== undefined) args.session = options.session;
  if (options.force) args.force = true;
  switch (cmd) {
    case 'add':
      args.branch = positionals[0];
      if (options.note !== undefined) args.note = options.note;
      break;
    case 'remove':
    case 'bind':
    case 'unbind':
    case 'switch':
      args.branch = positionals[0];
      break;
    case 'merge':
      args.from = positionals[0];
      if (options.into !== undefined) args.into = options.into;
      break;
    default:
      break;
  }
  return args;
}

/** Render the result as short Chinese lines. */
function human(cmd, data) {
  if (data === null) return '当前会话没有绑定任何工作树。';
  switch (cmd) {
    case 'repo': {
      if (!data.isGit) return `当前主业务代码未初始化 git：${data.root}`;
      return [
        `项目 ${data.root}`,
        `主业务分支 ${data.base ?? '（未确定）'}｜当前分支 ${data.currentBranch ?? (data.preview ? `预览 ${data.preview}（detached）` : '（detached）')}${data.dirty ? '｜有未提交改动' : ''}`,
      ].join('\n');
    }
    case 'add':
      return `工作树 ${data.worktree.branch} 已创建：${data.worktree.path}`;
    case 'remove':
      return `已删除工作树 ${data.branch}`;
    case 'switch':
      if (!data.changed) return `主业务目录已经在 ${data.branch} 上。`;
      return data.detached === true
        ? `已预览 ${data.branch}（detached HEAD，工作树保留）`
        : `主业务目录已切到 ${data.branch}`;
    case 'merge':
      return `${data.from} 已合并到 ${data.into}`;
    case 'bind':
      return `会话 ${data.session} 已绑定 ${data.branch}${data.movedFrom ? `（从 ${data.movedFrom} 移过来）` : ''}`;
    case 'unbind':
      return `已解绑 ${data.branch}`;
    case 'env':
      return `绑定的工作树：${data.root}\n分支：${data.branch}（主业务 ${data.base}）${data.note ? `\n备注：${data.note}` : ''}`;
    case 'prune':
      return data.output === '' ? '没有需要清理的元数据。' : data.output;
    case 'list': {
      if (!data.isGit) return `当前主业务代码未初始化 git：${data.root}`;
      const current = data.currentBranch ?? (data.preview ? `预览 ${data.preview}（detached）` : '（detached）');
      const lines = [`项目 ${data.root}`, `主业务 ${data.base ?? '（未确定）'}｜当前 ${current}${data.dirty ? '（有未提交改动）' : ''}`];
      if (data.worktrees.length === 0) lines.push('还没有工作树。');
      for (const row of data.worktrees) {
        lines.push(`${row.branch}  ${row.path}${row.exists ? '' : '  [目录已丢失]'}${row.dirty ? '  脏' : ''}  领先 ${row.ahead}${row.session ? `  绑定 ${row.session}` : ''}${row.note ? `  备注 ${row.note}` : ''}`);
      }
      return lines.join('\n');
    }
    default:
      return JSON.stringify(data, null, 2);
  }
}

const [, , cmd, ...rest] = process.argv;

if (cmd === undefined || cmd === '--help' || cmd === '-h') {
  console.log(USAGE);
  process.exit(cmd === undefined ? 1 : 0);
}

let parsed;
try {
  parsed = parse(rest);
} catch (error) {
  console.error(error.message);
  console.error(USAGE);
  process.exit(1);
}

const envelope = await runCommand(cmd, argsOf(cmd, parsed.positionals, parsed.options), {
  root: parsed.options.root ?? process.cwd(),
});

if (parsed.options.json) {
  console.log(JSON.stringify(envelope, null, 2));
  process.exit(envelope.ok ? 0 : 1);
}

if (envelope.ok) {
  console.log(human(cmd, envelope.data));
  process.exit(0);
}

console.error(`错误 ${envelope.error.code}: ${envelope.error.message}`);
if (Array.isArray(envelope.error.details?.files) && envelope.error.details.files.length > 0) {
  console.error(`冲突文件:\n${envelope.error.details.files.map((file) => `  ${file}`).join('\n')}`);
}
process.exit(1);
