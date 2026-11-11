/**
 * Browser half of the Worktrees panel.
 *
 * One page in the Web UI's Settings (`settings.section`) that manages the git
 * worktrees of the project behind one Harness workspace:
 *
 *   toolbar ── workspace picker, branch picker, Merge, Refresh. The branch
 *              picker's value is the main checkout's current branch, and
 *              picking another one really runs `switch`, so the main business
 *              code follows the picker.
 *   table   ── one row per worktree: branch / session / note / status / delete.
 *   dialogs ── add (branch + session + note), merge (source, target), delete
 *              (with a second, forced confirmation when git refuses).
 *
 * The table holds worktrees only. The main business branch is rendered inside
 * the branch picker, marked «主业务», instead of as a pseudo row: that keeps
 * every table row something the user can actually delete. The choice is here
 * because the contract leaves it open.
 *
 * Data: every read and every write is one `POST /hbs-worktree/api` call to this
 * plugin's Host half, which hands the command to the engine. The page derives
 * nothing itself, so the engine stays the single source of truth for workspace
 * state.
 *
 * No Harness client package is imported: React comes from the module table and
 * every control is local, styled with `--dsw-alias-*` theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'hbs-worktree',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const NS = 'hbs-worktree';
    /** Shared by the sidebar entry, the main panel, and the settings section. */
    const PANEL_ID = 'hbs-worktree';
    const API = '/hbs-worktree/api';

    /** Client-side code for "the Host route never answered"; it never crosses the wire. */
    const UNREACHABLE = 'unreachable';

    /** Branch and directory names: no slashes, no leading dash, no spaces. */
    /**
     * Enough of git's branch rules to catch a typo before a round trip; slashes
     * are legal and become nested worktree directories, so they are allowed here.
     * The engine still runs `git check-ref-format`, which is the authority.
     */
    const NAME_PATTERN = /^[A-Za-z0-9._-][A-Za-z0-9._/-]*$/;

    const en = {
      title: 'Worktrees',
      description: 'One git worktree per requirement, bound to one session, merged back when it is done.',
      workspace: 'Workspace',
      branch: 'Branch',
      mainLine: 'main line',
      previewing: 'Previewing',
      previewHint: 'the main checkout already has this branch\'s content, but the branch is also checked out under .worktree/, so git keeps it on a detached HEAD. Run it here; commit inside the worktree.',
      backToBase: 'Back to main line',
      merge: 'Merge',
      refresh: 'Refresh',
      session: 'Session',
      note: 'Note',
      status: 'Status',
      actions: 'Actions',
      add: 'New worktree',
      remove: 'Delete',
      unbound: 'Unbound',
      autoCommitOn: 'Auto',
      autoCommitOff: 'Manual',
      autoCommitHint: 'Auto-commit: the session commits and pushes when the requirement is done. Off: you commit by hand, and switching to it will be refused while dirty.',
      okAutoCommit: 'Auto-commit setting saved',
      running: 'Running',
      done: 'Finished',
      loading: 'Loading…',
      emptyList: 'No worktree yet. Create one to give a requirement its own directory.',
      worktreeCount: 'worktrees',
      noWorkspaces: 'No Harness workspace is available.',
      servicesMissing: 'This build does not provide the session or workspace service.',
      notGit: 'The main business code is not a git repository yet.',
      hostMissing: 'The Host is not ready: /hbs-worktree/api did not answer.',
      failed: 'The command failed.',
      retry: 'Retry',
      addTitle: 'New worktree',
      addHint: 'The worktree branches off the main line and lives under .worktree/.',
      branchName: 'Branch name',
      branchPlaceholder: 'feature-parser',
      invalidName: 'Use letters, digits, dots, underscores, hyphens and slashes; no leading hyphen or slash, no "..".',
      sessionName: 'Session name',
      sessionNamePlaceholder: 'e.g. parser rewrite',
      sessionNameHint: 'A new session opens in this workspace and is locked to the worktree.',
      sessionCreateFailed: 'The worktree was created, but its session failed: ',
      firstMessageFailed: 'The session was created, but the first instruction was not sent. Send it yourself:',
      notePlaceholder: 'Optional, e.g. parser rewrite',
      create: 'Create',
      cancel: 'Cancel',
      working: 'Working…',
      okAdd: 'Worktree created',
      removeTitle: 'Delete worktree',
      removeWarn: 'Deleting removes the worktree directory and the branch itself:',
      forceRemove: 'Force delete',
      okRemove: 'Worktree deleted',
      okSwitch: 'Main checkout switched to',
      okAlready: 'Main checkout is already on',
      mergeTitle: 'Merge worktree',
      mergeHint: 'Merges one worktree branch into a target branch, rolled back on conflict.',
      mergeFrom: 'Source branch',
      mergeTo: 'Target branch',
      mergeConflict: 'Rolled back. Resolve the conflict by hand, then merge again.',
      okMerge: 'Merged',
      conflictFiles: 'Conflicting files',
      dirty: 'Uncommitted changes',
      missingDir: 'The worktree directory is gone; prune it.',
    };

    const zh = {
      title: '工作树',
      description: '一个需求一个 git 工作树，绑定一条会话，做完再合并回主业务。',
      workspace: '工作区',
      branch: '分支',
      mainLine: '主业务',
      previewing: '预览中',
      previewHint: '主代码已包含这条分支的内容；但分支同时在 .worktree/ 里检出，git 只允许一处检出，所以这里是 detached HEAD。可以直接运行，提交请回工作树里做。',
      backToBase: '回到主业务',
      merge: '合并',
      refresh: '刷新',
      session: '会话',
      note: '备注',
      status: '状态',
      actions: '操作',
      add: '新增工作树',
      remove: '删除',
      unbound: '未绑定',
      autoCommitOn: '自动提交',
      autoCommitOff: '手动提交',
      autoCommitHint: '自动提交：会话做完需求自己提交并推送。手动提交：你自己提交；工作树有未提交改动时不允许切过去。',
      okAutoCommit: '自动提交设置已保存',
      running: '运行中',
      done: '已完成',
      loading: '加载中…',
      emptyList: '还没有工作树。新建一个，让这个需求有自己的目录。',
      worktreeCount: '个工作树',
      noWorkspaces: '没有可用的 Harness 工作区。',
      servicesMissing: '当前版本没有提供会话或工作区服务。',
      notGit: '当前主业务代码未初始化 git。',
      hostMissing: '宿主未就绪：/hbs-worktree/api 没有响应。',
      failed: '命令执行失败。',
      retry: '重试',
      addTitle: '新增工作树',
      addHint: '工作树从主业务分支切出，放在 .worktree/ 下。',
      branchName: '分支名',
      branchPlaceholder: 'feature-parser',
      invalidName: '分支名只能用字母、数字、点、下划线、连字符和斜杠，不能以连字符或斜杠开头，也不能包含 ..',
      sessionName: '会话名称',
      sessionNamePlaceholder: '例如：解析器重写',
      sessionNameHint: '会在当前工作区新建一个会话，并把它锁定到这个工作树。',
      sessionCreateFailed: '工作树已创建，但会话创建失败：',
      firstMessageFailed: '会话已创建，但首条指令没有自动发出，请手动发送这条消息：',
      notePlaceholder: '选填，例如：解析器重写',
      create: '创建',
      cancel: '取消',
      working: '处理中…',
      okAdd: '已新增工作树',
      removeTitle: '删除工作树',
      removeWarn: '删除会移除工作树目录以及分支本身：',
      forceRemove: '强制删除',
      okRemove: '已删除工作树',
      okSwitch: '主业务代码已切换到',
      okAlready: '主业务代码已经在',
      mergeTitle: '合并工作树',
      mergeHint: '把一个工作树分支合并进目标分支，冲突时整体回滚。',
      mergeFrom: '源分支',
      mergeTo: '目标分支',
      mergeConflict: '已回滚，请手动解决冲突后再合并。',
      okMerge: '已合并',
      conflictFiles: '冲突文件',
      dirty: '有未提交改动',
      missingDir: '工作树目录已不存在，可以清理掉。',
    };

    const TOKEN = {
      labelPrimary: 'var(--dsw-alias-label-primary, currentColor)',
      labelSecondary: 'var(--dsw-alias-label-secondary, currentColor)',
      labelTertiary: 'var(--dsw-alias-label-tertiary, currentColor)',
      onPrimary: 'var(--dsw-alias-label-primary-foreground, #fff)',
      border: 'var(--dsw-alias-border-l3, rgba(127,127,127,.35))',
      cardFill: 'var(--dsw-alias-settings-card-fill, transparent)',
      cardStroke: 'var(--dsw-alias-settings-card-stroke, rgba(127,127,127,.3))',
      bgLayer3: 'var(--dsw-alias-bg-layer-3, rgba(127,127,127,.14))',
      moduleBg: 'var(--dsw-alias-bg-module-platform, rgba(127,127,127,.06))',
      hoverSolid: 'var(--dsw-alias-interactive-bg-hover-solid, rgba(127,127,127,.12))',
      hoverDanger: 'var(--dsw-alias-interactive-bg-hover-danger, rgba(214,69,69,.1))',
      error: 'var(--dsw-alias-state-error-primary, #d64545)',
      success: 'var(--dsw-alias-state-success-primary, #2f9e63)',
      warn: 'var(--dsw-alias-state-warn-primary, #c98a1a)',
      buttonFill: 'var(--dsw-alias-button-primary-fill, #4b8bf5)',
      buttonHover: 'var(--dsw-alias-button-primary-hover, #3f7be0)',
      radiusXs: 'var(--dsw-radius-xs, 4px)',
      radiusSm: 'var(--dsw-radius-sm, 6px)',
      radiusMd: 'var(--dsw-radius-md, 8px)',
      radiusXl: 'var(--dsw-radius-xl, 16px)',
      dialogFill: 'var(--dsw-alias-bg-layer-1, #fff)',
      elevation: 'var(--dsw-elevation-prominent, 0 18px 48px rgba(0,0,0,.28))',
    };

    const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace';

    /** Text input matching the Settings form fields. */
    const inputStyle = {
      boxSizing: 'border-box',
      width: '100%',
      height: 40,
      padding: '0 14px',
      fontSize: 13,
      lineHeight: '20px',
      color: TOKEN.labelPrimary,
      background: TOKEN.bgLayer3,
      border: '.5px solid ' + TOKEN.border,
      borderRadius: TOKEN.radiusMd,
      outline: 'none',
      fontFamily: 'inherit',
    };
    const fieldLabel = { display: 'grid', gap: 5, fontSize: 12, color: TOKEN.labelSecondary };
    const hint = { margin: 0, fontSize: 12, lineHeight: '18px', color: TOKEN.labelTertiary };
    /** Secondary line used for metadata under a control. */
    const tinyHint = Object.assign({}, hint, { fontSize: 11 });
    const cardStyle = {
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      padding: '12px 14px',
      border: '.5px solid ' + TOKEN.cardStroke,
      background: TOKEN.cardFill,
      borderRadius: TOKEN.radiusXl,
      boxSizing: 'border-box',
    };
    /** One page-level hint: says why the table is not there instead of showing nothing. */
    const emptyCardStyle = Object.assign({}, cardStyle, { gap: 6 });
    /**
     * One toolbar row that cannot wrap: the two pickers give up width first, the
     * action buttons keep theirs, so 「合并」「刷新」never drop to a second line.
     */
    const toolbarStyle = { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'nowrap', minWidth: 0, padding: '0 0 12px' };
    const fieldGroupStyle = (maxWidth) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, flex: '1 1 0', minWidth: 0, maxWidth: maxWidth });
    const fieldLabelStyle = Object.assign({}, hint, { flex: 'none', whiteSpace: 'nowrap' });
    const fieldSelectStyle = { width: '100%', minWidth: 0, height: 32, fontSize: 12.5 };
    const toolbarActionsStyle = { display: 'inline-flex', alignItems: 'center', gap: 8, flex: 'none', marginLeft: 'auto' };
    /** One-line state strip above the table: says what the current state means. */
    const bannerStyle = {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 12px',
      marginBottom: 10,
      border: '.5px solid ' + TOKEN.cardStroke,
      background: TOKEN.bgLayer3,
      borderRadius: TOKEN.radiusMd,
      boxSizing: 'border-box',
    };
    const bannerText = { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: '18px', color: TOKEN.labelSecondary };
    /** Stands in for the table when there is nothing to put in it. */
    const noticeStripStyle = {
      padding: '14px',
      border: '.5px solid ' + TOKEN.cardStroke,
      background: TOKEN.cardFill,
      borderRadius: TOKEN.radiusXl,
      fontSize: 12.5,
      lineHeight: '20px',
      color: TOKEN.labelSecondary,
      boxSizing: 'border-box',
    };
    const emptyRowCell = { textAlign: 'center', padding: '30px 12px', color: TOKEN.labelTertiary, borderBottom: 'none' };
    const footerRowStyle = { display: 'flex', alignItems: 'center', gap: 10, paddingTop: 10 };
    const groupStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 };
    const selectControl = { width: 180, height: 32, fontSize: 12.5 };
    const tableWrapStyle = {
      border: '.5px solid ' + TOKEN.cardStroke,
      background: TOKEN.cardFill,
      borderRadius: TOKEN.radiusXl,
      overflow: 'hidden',
      boxSizing: 'border-box',
    };
    const tableStyle = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' };
    /** Branch / session / note / status / actions — the table owns these, not the cells. */
    const COLUMN_WIDTHS = ['16%', '29%', '17%', '11%', '27%'];
    /** Two controls in one cell: the auto-commit picker and the delete action. */
    const actionGroupStyle = { display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center' };
    const actionSelectStyle = { width: 92, height: 26, fontSize: 11.5 };
    const rowHover = { cursor: 'default' };
    const thStyle = {
      textAlign: 'left',
      padding: '9px 12px',
      fontSize: 11.5,
      fontWeight: 500,
      lineHeight: '16px',
      color: TOKEN.labelTertiary,
      borderBottom: '.5px solid ' + TOKEN.border,
      whiteSpace: 'nowrap',
    };
    const tdStyle = {
      padding: '10px 12px',
      fontSize: 13,
      lineHeight: '20px',
      color: TOKEN.labelPrimary,
      borderBottom: '.5px solid ' + TOKEN.border,
      verticalAlign: 'middle',
      minWidth: 0,
    };
    /**
     * Cells whose content is longer than the column: one line, ellipsis, tooltip.
     * `display: block` is load-bearing — overflow and text-overflow do nothing on
     * an inline box, and the text then paints over the next column instead.
     */
    const cellClip = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
    const branchText = Object.assign({ fontFamily: mono, fontSize: 12.5, color: TOKEN.labelPrimary }, cellClip);
    const noteText = Object.assign({ color: TOKEN.labelSecondary }, cellClip);
    const mutedText = { color: TOKEN.labelTertiary };
    const cellBadges = { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' };
    const backdropStyle = {
      position: 'fixed',
      inset: 0,
      zIndex: 2400,
      background: 'rgba(0, 0, 0, .32)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      boxSizing: 'border-box',
    };
    const dialogStyle = {
      boxSizing: 'border-box',
      width: 'min(480px, 100%)',
      maxHeight: 'min(78vh, 100%)',
      overflowY: 'auto',
      display: 'grid',
      gap: 14,
      padding: '20px 22px',
      borderRadius: TOKEN.radiusXl,
      background: TOKEN.dialogFill,
      border: '.5px solid ' + TOKEN.border,
      boxShadow: TOKEN.elevation,
    };
    const dialogTitle = { margin: 0, fontSize: 17, fontWeight: 600, lineHeight: '24px', color: TOKEN.labelPrimary };
    const dialogFooter = { display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 2 };

    /** Row-level action button (native row buttons are 28px tall). */
    function smallButton(kind) {
      const base = {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 28,
        padding: '0 10px',
        fontSize: 12,
        lineHeight: '18px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        borderRadius: TOKEN.radiusSm,
        border: '.5px solid ' + TOKEN.border,
        background: 'transparent',
        color: TOKEN.labelPrimary,
        whiteSpace: 'nowrap',
      };
      if (kind === 'danger') return Object.assign({}, base, { border: 'none', color: TOKEN.error });
      return base;
    }

    /** Visual state for a disabled button; primary fills otherwise look enabled. */
    const DIMMED = { opacity: 0.45, cursor: 'default' };

    /** Page-level button, matching the native settings buttons. */
    function buttonStyle(kind) {
      const base = {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        height: 36,
        padding: '0 14px',
        fontSize: 14,
        lineHeight: '22px',
        fontFamily: 'inherit',
        cursor: 'pointer',
        borderRadius: TOKEN.radiusMd,
        border: 'none',
        background: 'transparent',
        color: TOKEN.labelPrimary,
        whiteSpace: 'nowrap',
      };
      if (kind === 'primary') return Object.assign({}, base, { background: TOKEN.buttonFill, color: TOKEN.onPrimary });
      if (kind === 'secondary') return Object.assign({}, base, { border: '.5px solid ' + TOKEN.border });
      if (kind === 'danger') return Object.assign({}, base, { color: TOKEN.error });
      return base;
    }

    function hoverable(kind) {
      const resting = kind === 'primary' ? TOKEN.buttonFill : 'transparent';
      let active = TOKEN.hoverSolid;
      if (kind === 'primary') active = TOKEN.buttonHover;
      else if (kind === 'danger') active = TOKEN.hoverDanger;
      return {
        onMouseEnter: (event) => {
          const target = event.currentTarget;
          if (target.disabled) return;
          target.style.background = active;
        },
        onMouseLeave: (event) => {
          event.currentTarget.style.background = resting;
        },
      };
    }

    /** Session ids share a long prefix; their tail is what tells two apart. */
    function shortSession(id) {
      const text = String(id || '');
      return text.length > 12 ? '…' + text.slice(text.length - 12) : text;
    }

    /** Last path segment, used when a workspace has no title. */
    function baseName(path) {
      const parts = String(path || '').split('/').filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : '';
    }

    /** Session title when the session is known, the id tail otherwise. */
    function sessionLabel(t, byId, id) {
      const text = String(id || '');
      if (text.length === 0) return t('unbound');
      const row = byId[text] || {};
      const title = typeof row.title === 'string' && row.title.length > 0 ? row.title : '';
      return title.length > 0 ? title : shortSession(text);
    }

    /** One message for one failed command; the code decides between Host and engine text. */
    function errorText(t, error) {
      if (error === undefined || error === null) return t('failed');
      if (error.code === UNREACHABLE) return t('hostMissing');
      const message = typeof error.message === 'string' ? error.message : '';
      return message.length > 0 ? message : t('failed');
    }

    /**
     * Sidebar entry icon: the same branch glyph as `icon.svg`, drawn inline so the
     * plugin still imports nothing but React.
     * @param props - `size` in pixels, supplied by the sidebar.
     */
    function WorktreeIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('circle', { cx: 6, cy: 5, r: 2.2 }),
        h('circle', { cx: 6, cy: 19, r: 2.2 }),
        h('circle', { cx: 18, cy: 12, r: 2.2 }),
        h('path', { d: 'M6 7.2v9.6' }),
        h('path', { d: 'M8.2 5h4.3A3.3 3.3 0 0 1 15.8 8.3v1.4' }),
        h('path', { d: 'M8.2 19h4.3a3.3 3.3 0 0 0 3.3-3.3v-1.4' }));
    }

    /**
     * The first thing the new session reads: load the skill, then treat the
     * worktree as the only writable directory. It names the path outright so the
     * agent cannot guess wrong before the skill loads.
     */
    function firstMessage(branch, path) {
      return [
        '请先读取并严格遵守 hbs-worktree skill。',
        '本会话已绑定工作树分支 ' + String(branch || '') + '，工作目录是 ' + String(path || '') + '。',
        '所有文件操作只能用该目录下的绝对路径，所有 git 命令用 git -C ' + String(path || '') + '，',
        '不要修改主业务代码目录里的任何文件；需求完成时按 skill 的规则提交并推送（默认要提交），合并在面板上由我来做。',
      ].join('\n');
    }

    /** Files git refused to merge, when the engine reported a conflict. */
    function conflictFiles(error) {
      if (error === undefined || error === null || error.code !== 'conflict') return [];
      const files = error.details && error.details.files;
      return Array.isArray(files) ? files.map((file) => String(file)) : [];
    }

    function createStore(compute) {
      let snapshot = compute();
      const listeners = new Set();
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        publish: () => {
          const next = compute();
          if (next === snapshot) return;
          snapshot = next;
          listeners.forEach((listener) => listener());
        },
      };
    }

    /** Small metadata chip, the native "自定义" tag shape. */
    function Tag(props) {
      let color = TOKEN.labelSecondary;
      if (props.tone === 'ok') color = TOKEN.success;
      else if (props.tone === 'bad') color = TOKEN.error;
      else if (props.tone === 'warn') color = TOKEN.warn;
      else if (props.tone === 'info') color = TOKEN.buttonFill;
      return h('span', {
        style: {
          border: '.5px solid ' + TOKEN.border,
          borderRadius: TOKEN.radiusXs,
          color: color,
          flex: 'none',
          padding: '1px 6px',
          fontSize: 11,
          lineHeight: '16px',
          whiteSpace: 'nowrap',
        },
      }, props.children);
    }

    /** Status dot, the native credential-dot shape. */
    function Dot(props) {
      let color = TOKEN.labelTertiary;
      if (props.tone === 'ok') color = TOKEN.success;
      else if (props.tone === 'bad') color = TOKEN.error;
      else if (props.tone === 'warn') color = TOKEN.warn;
      return h('span', {
        title: props.title,
        'aria-hidden': props.title === undefined ? 'true' : undefined,
        style: { boxSizing: 'border-box', width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block', flex: 'none' },
      });
    }

    /** Themed select. The native widget paints its own plate, which shows as a
     *  hard white box on a dark card, so the plate is drawn here instead. */
    function Select(props) {
      const wrapper = Object.assign({ position: 'relative', display: 'flex', minWidth: 0 }, props.wrapperStyle);
      return h('span', { style: wrapper },
        h('select', {
          style: Object.assign({}, inputStyle, props.controlStyle, {
            appearance: 'none',
            WebkitAppearance: 'none',
            paddingRight: 28,
            cursor: props.disabled ? 'default' : 'pointer',
            opacity: props.disabled ? 0.5 : 1,
          }),
          value: props.value,
          title: props.title,
          disabled: props.disabled,
          onChange: props.onChange,
        }, props.options.map((option) => h('option', { key: option.value, value: option.value }, option.label))),
        h('span', {
          'aria-hidden': 'true',
          style: {
            position: 'absolute',
            right: 11,
            top: '50%',
            marginTop: -2,
            pointerEvents: 'none',
            width: 0,
            height: 0,
            borderLeft: '4px solid transparent',
            borderRight: '4px solid transparent',
            borderTop: '5px solid ' + TOKEN.labelTertiary,
          },
        }));
    }

    function Field(props) {
      return h('label', { style: fieldLabel },
        h('span', null, props.label),
        props.children,
        props.hint ? h('span', { style: hint }, props.hint) : null);
    }

    /** Command feedback for one action; a conflict also lists the files git stopped on. */
    function Notice(props) {
      const t = props.t;
      const files = Array.isArray(props.files) ? props.files : [];
      return h('div', {
        style: {
          display: 'grid',
          gap: 4,
          padding: '8px 12px',
          borderRadius: TOKEN.radiusMd,
          background: TOKEN.moduleBg,
          border: '.5px solid ' + TOKEN.border,
        },
      },
        h('p', {
          style: { margin: 0, fontSize: 12.5, lineHeight: '18px', color: props.tone === 'ok' ? TOKEN.success : TOKEN.error },
        }, props.text),
        files.length > 0 ? h('div', { style: { display: 'grid', gap: 2 } },
          h('span', { style: tinyHint }, t('conflictFiles')),
          h('ul', { style: { margin: 0, paddingLeft: 18, fontFamily: mono, fontSize: 11.5, lineHeight: '18px', color: TOKEN.labelSecondary } },
            files.map((file, index) => h('li', { key: String(index) }, file)))) : null);
    }

    /** Escape closes any dialog; the backdrop click is wired next to it. */
    function useEscape(onEscape) {
      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onEscape(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, []);
    }

    /** Dialog frame: backdrop, card, title and one hint line. */
    function Dialog(props) {
      return h('div', {
        style: backdropStyle,
        onClick: (event) => { if (event.target === event.currentTarget) props.onCancel(); },
      },
        h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title, style: dialogStyle },
          h('div', { style: { display: 'grid', gap: 4 } },
            h('h3', { style: dialogTitle }, props.title),
            props.hint ? h('p', { style: hint }, props.hint) : null),
          props.children,
          props.footer));
    }

    /** One worktree row: the branch cell carries the state dots the table has no column for. */
    function WorktreeRow(props) {
      const t = props.t;
      const row = props.row;
      const session = typeof row.session === 'string' ? row.session : '';
      const note = typeof row.note === 'string' ? row.note : '';
      const known = props.sessionById[session] || {};
      const exists = row.exists !== false;
      const last = props.isLast === true;
      const cell = Object.assign({}, tdStyle, last ? { borderBottom: 'none' } : {});
      return h('tr', Object.assign({
        onMouseEnter: (event) => { event.currentTarget.style.background = TOKEN.hoverSolid; },
        onMouseLeave: (event) => { event.currentTarget.style.background = 'transparent'; },
      }, rowHover),
        h('td', { style: cell },
          h('span', { style: cellBadges },
            h('span', { style: branchText, title: typeof row.path === 'string' ? row.path : undefined }, String(row.branch || '')),
            row.dirty === true ? h(Dot, { tone: 'warn', title: t('dirty') }) : null,
            exists ? null : h(Dot, { tone: 'bad', title: t('missingDir') }))),
        h('td', { style: cell },
          h('span', {
            style: Object.assign({}, cellClip, session.length > 0 ? {} : mutedText),
            title: session.length > 0 ? session : undefined,
          }, sessionLabel(t, props.sessionById, session))),
        h('td', { style: cell },
          h('span', {
            style: Object.assign({}, noteText, note.length > 0 ? {} : mutedText),
            title: note.length > 0 ? note : undefined,
          }, note.length > 0 ? note : '—')),
        h('td', { style: cell },
          session.length === 0
            ? h('span', { style: mutedText }, '—')
            : (known.running === true ? h(Tag, { tone: 'ok' }, t('running')) : h(Tag, null, t('done')))),
        h('td', { style: Object.assign({}, cell, { textAlign: 'center' }) },
          h('span', { style: actionGroupStyle },
            h(Select, {
              value: row.autoCommit === false ? 'off' : 'on',
              wrapperStyle: { flex: 'none' },
              controlStyle: actionSelectStyle,
              title: t('autoCommitHint'),
              disabled: !exists,
              options: [
                { value: 'on', label: t('autoCommitOn') },
                { value: 'off', label: t('autoCommitOff') },
              ],
              onChange: (event) => props.onAutoCommit(row, event.target.value === 'on'),
            }),
            h('button', Object.assign({
              type: 'button',
              style: smallButton('danger'),
              title: exists ? undefined : t('missingDir'),
              onClick: () => props.onRemove(row),
            }, hoverable('danger')), t('remove')))));
    }

    /** Modal asking for branch name, session and note; the engine's refusal stays inline. */
    function AddDialog(props) {
      const t = props.t;
      const [branch, setBranch] = React.useState('');
      const [sessionName, setSessionName] = React.useState('');
      const [note, setNote] = React.useState('');
      const [error, setError] = React.useState('');
      const [busy, setBusy] = React.useState(false);

      useEscape(props.onCancel);

      const submit = async () => {
        const name = branch.trim();
        // The engine validates too; doing it here keeps a typo from costing a round trip.
        const bad = !NAME_PATTERN.test(name)
          || name.endsWith('/')
          || name.includes('//')
          || name.includes('..')
          || name === '.'
          || name === '..';
        if (bad) {
          setError(t('invalidName'));
          return;
        }
        setBusy(true);
        setError('');
        try {
          setError(await props.onSubmit({ branch: name, sessionName: sessionName.trim(), note: note.trim() }));
        } finally {
          setBusy(false);
        }
      };

      return h(Dialog, {
        title: t('addTitle'),
        hint: t('addHint'),
        onCancel: props.onCancel,
        footer: h('div', { style: dialogFooter },
          h('button', Object.assign({ type: 'button', style: buttonStyle('secondary'), onClick: props.onCancel }, hoverable('secondary')), t('cancel')),
          h('button', Object.assign({
            type: 'button',
            style: Object.assign({}, buttonStyle('primary'), busy ? DIMMED : {}),
            disabled: busy,
            onClick: () => void submit(),
          }, busy ? {} : hoverable('primary')), busy ? t('working') : t('create'))),
      },
        h(Field, { label: t('branchName') },
          h('input', {
            style: inputStyle,
            value: branch,
            placeholder: t('branchPlaceholder'),
            spellCheck: false,
            onChange: (event) => setBranch(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') void submit(); },
          })),
        h(Field, { label: t('sessionName'), hint: t('sessionNameHint') },
          h('input', {
            style: inputStyle,
            value: sessionName,
            placeholder: t('sessionNamePlaceholder'),
            spellCheck: false,
            onChange: (event) => setSessionName(event.target.value),
          })),
        h(Field, { label: t('note') },
          h('input', {
            style: inputStyle,
            value: note,
            placeholder: t('notePlaceholder'),
            spellCheck: false,
            onChange: (event) => setNote(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Enter') void submit(); },
          })),
        error.length > 0 ? h('p', { style: Object.assign({}, hint, { color: TOKEN.error }) }, error) : null);
    }

    /** Modal picking source and target branch; a conflict lists the files and stops there. */
    function MergeDialog(props) {
      const t = props.t;
      const sources = Array.isArray(props.sources) ? props.sources : [];
      const targets = Array.isArray(props.targets) ? props.targets : [];
      const [from, setFrom] = React.useState(sources.length > 0 ? sources[0] : '');
      const [into, setInto] = React.useState(props.base !== '' && targets.indexOf(props.base) >= 0 ? props.base : (targets.length > 0 ? targets[0] : ''));
      const [failure, setFailure] = React.useState(null);
      const [busy, setBusy] = React.useState(false);

      useEscape(props.onCancel);

      const submit = async () => {
        if (from === '' || into === '') return;
        setBusy(true);
        setFailure(null);
        try {
          const outcome = await props.onSubmit(from, into);
          if (outcome.ok !== true) setFailure({ message: outcome.message, files: outcome.files });
        } finally {
          setBusy(false);
        }
      };

      const toOptions = targets.map((branch) => ({ value: branch, label: branch === props.base ? branch + ' · ' + t('mainLine') : branch }));

      return h(Dialog, {
        title: t('mergeTitle'),
        hint: t('mergeHint'),
        onCancel: props.onCancel,
        footer: h('div', { style: dialogFooter },
          h('button', Object.assign({ type: 'button', style: buttonStyle('secondary'), onClick: props.onCancel }, hoverable('secondary')), t('cancel')),
          h('button', Object.assign({
            type: 'button',
            style: Object.assign({}, buttonStyle('primary'), busy || from === '' || into === '' ? DIMMED : {}),
            disabled: busy || from === '' || into === '',
            onClick: () => void submit(),
          }, busy ? {} : hoverable('primary')), busy ? t('working') : t('merge'))),
      },
        h(Field, { label: t('mergeFrom') },
          h(Select, { value: from, options: sources.map((branch) => ({ value: branch, label: branch })), controlStyle: { height: 36, fontSize: 13 }, onChange: (event) => setFrom(event.target.value) })),
        h(Field, { label: t('mergeTo') },
          h(Select, { value: into, options: toOptions, controlStyle: { height: 36, fontSize: 13 }, onChange: (event) => setInto(event.target.value) })),
        failure !== null ? h(Notice, { t: t, tone: 'bad', text: failure.message, files: failure.files }) : null,
        failure !== null ? h('p', { style: hint }, t('mergeConflict')) : null);
    }

    /**
     * Destructive confirmation. git refuses to drop a worktree with unmerged
     * commits or unsaved changes, so the refusal turns this into a second
     * confirmation instead of an unexplained failure.
     */
    function RemoveDialog(props) {
      const t = props.t;
      const branch = String(props.branch || '');
      const [error, setError] = React.useState('');
      const [mayForce, setMayForce] = React.useState(false);
      const [busy, setBusy] = React.useState(false);

      useEscape(props.onCancel);

      const submit = async (force) => {
        setBusy(true);
        setError('');
        try {
          const outcome = await props.onConfirm(force);
          if (outcome.ok === true) return;
          setError(outcome.message);
          setMayForce(outcome.code === 'unmerged-commits' || outcome.code === 'worktree-dirty');
        } finally {
          setBusy(false);
        }
      };

      return h(Dialog, {
        title: t('removeTitle'),
        hint: t('removeWarn'),
        onCancel: props.onCancel,
        footer: h('div', { style: dialogFooter },
          h('button', Object.assign({ type: 'button', style: buttonStyle('secondary'), onClick: props.onCancel }, hoverable('secondary')), t('cancel')),
          mayForce
            ? h('button', Object.assign({
              type: 'button',
              style: Object.assign({}, buttonStyle('danger'), busy ? DIMMED : {}),
              disabled: busy,
              onClick: () => void submit(true),
            }, busy ? {} : hoverable('danger')), busy ? t('working') : t('forceRemove'))
            : h('button', Object.assign({
              type: 'button',
              style: Object.assign({}, buttonStyle('secondary'), { color: TOKEN.error }, busy ? DIMMED : {}),
              disabled: busy,
              onClick: () => void submit(false),
            }, busy ? {} : hoverable('danger')), busy ? t('working') : t('remove'))),
      },
        h('p', { style: Object.assign({}, hint, { fontFamily: mono, color: TOKEN.labelPrimary }) }, '.worktree/' + branch),
        error.length > 0 ? h('p', { style: Object.assign({}, hint, { color: TOKEN.error }) }, error) : null);
    }

    function Panel(props) {
      const t = props.t;
      const actions = props.actions;
      // This is a page, not a settings block: the shell's main panel clips overflow,
      // so the page owns its scroll area — the pattern the built-in management pages
      // use, a flex column whose middle row scrolls around a 960px reading column.
      const pageOuterStyle = {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
      };
      const pageScrollStyle = { flex: '1', minHeight: 0, overflowY: 'auto', scrollbarGutter: 'stable' };
      const pageContentStyle = { maxWidth: 960, margin: '0 auto', boxSizing: 'border-box', padding: '0 clamp(24px, 4vw, 48px) 48px' };
      /** The page frame: fixed outer column, scrolling middle, reading column inside. */
      const shell = (children) => h('div', { style: pageOuterStyle },
        h('div', { style: pageScrollStyle }, h('div', { style: pageContentStyle }, children)));
      const state = React.useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
      const [notice, setNotice] = React.useState(null);
      const [dialog, setDialog] = React.useState(null);
      const [branchChoice, setBranchChoice] = React.useState('');

      // The Settings shell mounts this page each time the section is opened, so
      // arriving here re-reads the project — the same work Refresh does.
      React.useEffect(() => {
        actions.refresh();
      }, []);

      // Branches can move outside this page (an editor, a terminal, the agent).
      // Re-read when the window comes back so the picker never argues with git.
      React.useEffect(() => {
        const wake = () => {
          if (typeof document === 'undefined' || document.visibilityState !== 'hidden') actions.refresh();
        };
        window.addEventListener('focus', wake);
        document.addEventListener('visibilitychange', wake);
        return () => {
          window.removeEventListener('focus', wake);
          document.removeEventListener('visibilitychange', wake);
        };
      }, []);

      const list = state.list || null;
      const repo = state.repo || null;
      const workspaces = state.workspaces;
      const sessionById = state.sessionById || {};
      const worktrees = list !== null && Array.isArray(list.worktrees) ? list.worktrees : [];
      const base = list !== null && typeof list.base === 'string' ? list.base : (repo !== null && typeof repo.base === 'string' ? repo.base : '');
      // Previewing a worktree branch leaves the main repository on a detached
      // HEAD, so that branch is reported as `preview` instead of `currentBranch`.
      const preview = list !== null && typeof list.preview === 'string' ? list.preview : '';
      const onBranch = list !== null && typeof list.currentBranch === 'string' ? list.currentBranch : '';
      const current = onBranch.length > 0 ? onBranch : (preview.length > 0 ? preview : base);
      const nonGit = repo !== null && repo.isGit !== true;
      // Previewing is the one state where the picker and `git status` disagree,
      // so it gets a label, a hint, and an exit instead of silent confusion.
      const previewing = preview.length > 0 && onBranch.length === 0;

      // Keep a live preview on the branch's newest commit: a requirement that was
      // just committed inside the worktree should show up without re-picking the
      // branch. Plain branches and other worktrees finishing move nothing.
      React.useEffect(() => {
        if (!previewing) return undefined;
        const timer = window.setInterval(() => { void actions.follow(); }, 4000);
        return () => { window.clearInterval(timer); };
      }, [previewing, actions]);

      // The picker is a command, not a filter: its value follows the main
      // checkout, and a refused `switch` has to put the old branch back.
      React.useEffect(() => {
        setBranchChoice(current);
      }, [current]);

      const onPickBranch = async (next) => {
        const previous = branchChoice;
        setBranchChoice(next);
        setNotice(null);
        // Always ask the engine, even when the picker already shows that branch:
        // an outside `git checkout` leaves the picker stale, and silently
        // returning would look like the click did nothing.
        const result = await actions.run('switch', { branch: next });
        if (result.ok === true) {
          const changed = result.data !== null && result.data.changed === true;
          setNotice({ tone: 'ok', text: (changed ? t('okSwitch') : t('okAlready')) + ' ' + next, files: [] });
          return;
        }
        setBranchChoice(previous);
        setNotice({ tone: 'bad', text: errorText(t, result.error), files: [] });
      };

      // Auto-commit is a per-worktree setting the session reads through
      // `hbs-wt env`, so changing it here changes what the agent does next.
      const changeAutoCommit = async (row, autoCommit) => {
        setNotice(null);
        const result = await actions.run('update', { branch: String(row.branch || ''), autoCommit: autoCommit });
        if (result.ok === true) {
          setNotice({ tone: 'ok', text: t('okAutoCommit') + ' · ' + String(row.branch || '') + ' · ' + (autoCommit ? t('autoCommitOn') : t('autoCommitOff')), files: [] });
          return;
        }
        setNotice({ tone: 'bad', text: errorText(t, result.error), files: [] });
      };

      const everyBranch = base === '' ? [] : [base].concat(worktrees.map((row) => String(row.branch || '')).filter((branch) => branch !== '' && branch !== base));
      const branchOptions = base === '' ? [] : [{ value: base, label: base + ' · ' + t('mainLine') }]
        .concat(worktrees.map((row) => String(row.branch || '')).filter((branch) => branch !== '' && branch !== base).map((branch) => ({ value: branch, label: branch })));
      // The checkout is what the picker claims to show, so say which commit that is:
      // `v-3.58-test (49ab12c)`. Other branches stay bare — their tip is not what is
      // checked out, and mixing the two would be a lie.
      const headShort = repo !== null && typeof repo.head === 'string' ? repo.head : '';
      const markedBranchOptions = headShort === ''
        ? branchOptions
        : branchOptions.map((option) => (option.value === branchChoice
          ? { value: option.value, label: option.label + ' (' + headShort + ')' }
          : option));

      const workspaceOptions = workspaces.map((item) => ({
        value: String(item.workspaceId || ''),
        label: String(item.title || '') || baseName(item.path) || String(item.workspaceId || ''),
      }));

      let overlay = null;
      if (dialog !== null && dialog.kind === 'add') {
        overlay = h(AddDialog, {
          t: t,
          onCancel: () => setDialog(null),
          onSubmit: async (values) => {
            const args = { branch: values.branch };
            if (values.note !== '') args.note = values.note;
            const result = await actions.run('add', args);
            if (result.ok !== true) return errorText(t, result.error);

            // The worktree exists now; the session is what locks the AI to it.
            const worktree = result.data && result.data.worktree ? result.data.worktree : {};
            const started = await actions.startSession({
              workspaceId: state.workspaceId,
              name: values.sessionName,
              branch: values.branch,
              path: String(worktree.path || ''),
            });
            setDialog(null);
            if (started.ok !== true) {
              setNotice({ tone: 'bad', text: t('sessionCreateFailed') + started.message, files: [] });
              return '';
            }
            setNotice({ tone: 'ok', text: t('okAdd') + ' ' + values.branch, files: [] });
            return '';
          },
        });
      } else if (dialog !== null && dialog.kind === 'merge') {
        overlay = h(MergeDialog, {
          t: t,
          base: base,
          sources: worktrees.map((row) => String(row.branch || '')).filter((branch) => branch !== ''),
          targets: everyBranch,
          onCancel: () => setDialog(null),
          onSubmit: async (from, into) => {
            const result = await actions.run('merge', { from: from, into: into });
            if (result.ok !== true) return { ok: false, message: errorText(t, result.error), files: conflictFiles(result.error) };
            setDialog(null);
            setNotice({ tone: 'ok', text: t('okMerge') + ' ' + from + ' → ' + into, files: [] });
            return { ok: true, message: '', files: [] };
          },
        });
      } else if (dialog !== null && dialog.kind === 'remove') {
        overlay = h(RemoveDialog, {
          t: t,
          branch: dialog.branch,
          onCancel: () => setDialog(null),
          onConfirm: async (force) => {
            const result = await actions.run('remove', force ? { branch: dialog.branch, force: true } : { branch: dialog.branch });
            if (result.ok !== true) {
              return { ok: false, code: String((result.error && result.error.code) || ''), message: errorText(t, result.error) };
            }
            setDialog(null);
            setNotice({ tone: 'ok', text: t('okRemove') + ' ' + dialog.branch, files: [] });
            return { ok: true, code: '', message: '' };
          },
        });
      }

      const header = h('header', {
        style: { display: 'grid', gap: 4, padding: 'calc(28px + var(--dsh-frame-top-clearance, 0px)) 0 20px' },
      },
        h('h1', {
          style: { margin: 0, fontSize: 20, fontWeight: 500, lineHeight: '28px', color: TOKEN.labelPrimary },
        }, t('title')),
        h('p', { style: Object.assign({}, hint, { fontSize: 12.5 }) }, t('description')));

      if (state.unavailable || workspaces.length === 0) {
        return shell([
          header,
          h('p', { style: noticeStripStyle }, state.unavailable ? t('servicesMissing') : t('noWorkspaces')),
        ]);
      }

      // One row, in reading order: what project, which branch, then the actions
      // that only make sense once a worktree exists.
      const toolbar = h('div', { style: toolbarStyle },
        h('span', { style: fieldGroupStyle(220) },
          h('span', { style: fieldLabelStyle }, t('workspace')),
          h(Select, {
            value: state.workspaceId,
            wrapperStyle: { flex: '1 1 auto' },
            controlStyle: fieldSelectStyle,
            onChange: (event) => actions.selectWorkspace(event.target.value),
            options: workspaceOptions,
          })),
        branchOptions.length > 0 && !nonGit ? h('span', { style: fieldGroupStyle(320) },
          h('span', { style: fieldLabelStyle }, t('branch')),
          h(Select, {
            value: branchChoice,
            wrapperStyle: { flex: '1 1 auto' },
            controlStyle: fieldSelectStyle,
            onChange: (event) => void onPickBranch(event.target.value),
            options: markedBranchOptions,
          })) : null,
        h('span', { style: toolbarActionsStyle },
          worktrees.length > 0 && !nonGit ? h('button', Object.assign({
            type: 'button',
            style: buttonStyle('primary'),
            onClick: () => setDialog({ kind: 'merge' }),
          }, hoverable('primary')), t('merge')) : null,
          h('button', Object.assign({
            type: 'button',
            style: buttonStyle('secondary'),
            onClick: () => actions.refresh(),
          }, hoverable('secondary')), t('refresh'))));

      const banners = [];
      if (previewing) {
        banners.push(h('div', { key: 'preview', style: bannerStyle },
          h('p', { style: Object.assign({}, bannerText, { color: TOKEN.labelSecondary }) },
            h('strong', { style: { fontWeight: 600, color: TOKEN.labelPrimary } },
              t('previewing') + ' · ' + preview + (repo !== null && typeof repo.head === 'string' ? ' (' + repo.head + ')' : '') + '：'),
            ' ' + t('previewHint')),
          h('button', Object.assign({
            type: 'button',
            style: smallButton(''),
            onClick: () => void onPickBranch(base),
          }, hoverable('secondary')), t('backToBase'))));
      }
      if (notice !== null) banners.push(h(Notice, { key: 'notice', t: t, tone: notice.tone, text: notice.text, files: notice.files }));

      let tableArea = null;
      if (state.phase === 'error') {
        tableArea = h('div', { style: noticeStripStyle },
          h('p', { style: Object.assign({}, hint, { color: TOKEN.error }) }, state.error),
          h('button', Object.assign({
            type: 'button',
            style: Object.assign({}, buttonStyle('secondary'), { marginTop: 10 }),
            onClick: () => actions.refresh(),
          }, hoverable('secondary')), t('retry')));
      } else if (nonGit) {
        tableArea = h('p', { style: Object.assign({}, noticeStripStyle, { color: TOKEN.warn }) }, t('notGit'));
      } else if (list === null) {
        tableArea = h('p', { style: Object.assign({}, hint, { padding: '12px 0' }) }, t('loading'));
      } else {
        const rows = worktrees.length === 0
          ? h('tr', null, h('td', { colSpan: 5, style: Object.assign({}, tdStyle, emptyRowCell) }, t('emptyList')))
          : worktrees.map((row, index) => h(WorktreeRow, {
            key: 'worktree:' + String(row.branch || ''),
            t: t,
            row: row,
            sessionById: sessionById,
            isLast: index === worktrees.length - 1,
            onAutoCommit: (target, autoCommit) => void changeAutoCommit(target, autoCommit),
            onRemove: (target) => setDialog({ kind: 'remove', branch: String(target.branch || '') }),
          }));
        tableArea = h('div', { style: tableWrapStyle },
          h('table', { style: tableStyle },
            h('colgroup', null, COLUMN_WIDTHS.map((width, index) => h('col', { key: 'col:' + String(index), style: { width: width } }))),
            h('thead', null, h('tr', null,
              h('th', { style: thStyle }, t('branch')),
              h('th', { style: thStyle }, t('session')),
              h('th', { style: thStyle }, t('note')),
              h('th', { style: thStyle }, t('status')),
              h('th', { style: Object.assign({}, thStyle, { textAlign: 'center' }) }, t('actions')))),
            h('tbody', null, rows)));
      }

      const footer = nonGit ? null : h('div', { style: footerRowStyle },
        h('button', Object.assign({
          type: 'button',
          style: buttonStyle('secondary'),
          onClick: () => setDialog({ kind: 'add' }),
        }, hoverable('secondary')), '+ ' + t('add')),
        h('span', { style: hint }, String(worktrees.length) + ' ' + t('worktreeCount')));

      return h('div', { style: pageOuterStyle },
        h('div', { style: pageScrollStyle }, h('div', { style: pageContentStyle }, header, toolbar, banners, tableArea, footer)),
        overlay);
    }

    const inject = ['slots', 'locale', 'sessions', 'workspaces'];

    function apply(ctx, config) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { en: en, zh: zh }), 'hbs-worktree: dictionaries');

      const sessions = ctx.sessions;
      const workspaces = ctx.workspaces;

      const state = {
        phase: 'loading',
        error: '',
        workspaceId: '',
        root: '',
        repo: null,
        list: null,
      };

      /** Workspace rows plus the archived set, or empties when the service is absent. */
      function workspaceSnapshot() {
        const snapshot = workspaces && workspaces.list && typeof workspaces.list.getSnapshot === 'function'
          ? workspaces.list.getSnapshot()
          : undefined;
        return {
          items: snapshot && Array.isArray(snapshot.items) ? snapshot.items : [],
          archived: snapshot && Array.isArray(snapshot.archivedSessionIds) ? snapshot.archivedSessionIds : [],
        };
      }

      function sessionSnapshot() {
        const snapshot = sessions && sessions.list && typeof sessions.list.getSnapshot === 'function'
          ? sessions.list.getSnapshot()
          : undefined;
        return (snapshot && snapshot.byId) || {};
      }

      /** The picked workspace, falling back to the first one. */
      function pickWorkspace(items) {
        const kept = items.filter((item) => String(item.workspaceId || '') === state.workspaceId)[0];
        if (kept !== undefined) return kept;
        return items.length > 0 ? items[0] : undefined;
      }

      const store = createStore(() => {
        const snapshot = workspaceSnapshot();
        const byId = sessionSnapshot();
        const chosen = pickWorkspace(snapshot.items);
        return {
          phase: state.phase,
          error: state.error,
          unavailable: workspaces === undefined || sessions === undefined,
          workspaces: snapshot.items,
          workspaceId: chosen === undefined ? '' : String(chosen.workspaceId || ''),
          repo: state.repo,
          list: state.list,
          sessionById: byId,
        };
      });

      /** Result envelope of one Host call, normalised so callers see only `ok`/`error`. */
      async function post(cmd, args, root) {
        const body = { cmd: cmd, args: args || {} };
        if (typeof root === 'string' && root.length > 0) body.root = root;
        let response;
        try {
          response = await fetch(new URL(API, location.origin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch (error) {
          return unreachable(error);
        }
        // The route answers 200 for business errors; anything else means the Host
        // half never registered it.
        if (response === undefined || response === null || response.ok !== true) {
          return unreachable('HTTP ' + (response ? response.status : '0'));
        }
        try {
          const envelope = await response.json();
          if (envelope && envelope.ok === true) return envelope;
          return { ok: false, error: (envelope && envelope.error) || { code: 'unknown', message: '' } };
        } catch (error) {
          return unreachable(error);
        }
      }

      function unreachable(cause) {
        const message = typeof cause === 'string' ? cause : String((cause && cause.message) || cause);
        return { ok: false, error: { code: UNREACHABLE, message: message } };
      }

      function failPage(error) {
        state.phase = 'error';
        state.error = errorText(t, error);
        store.publish();
      }

      /** Re-read `repo`, then `list`, for the picked workspace. */
      async function loadWorkspace() {
        state.phase = 'loading';
        state.error = '';
        state.repo = null;
        state.list = null;
        store.publish();
        if (state.root === '') {
          state.phase = 'ready';
          store.publish();
          return;
        }
        const repo = await post('repo', {}, state.root);
        if (repo.ok !== true) {
          failPage(repo.error);
          return;
        }
        state.repo = repo.data || null;
        if (state.repo === null || state.repo.isGit !== true) {
          // Nothing else can answer: `list` needs a repository to open.
          state.phase = 'ready';
          store.publish();
          return;
        }
        const list = await post('list', {}, state.root);
        if (list.ok !== true) {
          failPage(list.error);
          return;
        }
        state.list = list.data || null;
        state.phase = 'ready';
        store.publish();
      }

      /** Take the picked workspace as the root and reload everything below it. */
      function refresh() {
        const chosen = pickWorkspace(workspaceSnapshot().items);
        state.workspaceId = chosen === undefined ? '' : String(chosen.workspaceId || '');
        state.root = chosen === undefined ? '' : String(chosen.path || '');
        void loadWorkspace();
      }

      /** Every success re-reads the state it may have changed. */
      async function run(cmd, args) {
        const result = await post(cmd, args, state.root);
        if (result.ok === true) await loadWorkspace();
        return result;
      }

      function selectWorkspace(workspaceId) {
        if (workspaceId === state.workspaceId) return;
        state.workspaceId = workspaceId;
        state.root = '';
        refresh();
      }

      /**
       * Open a session in this workspace and hand it the worktree.
       *
       * The session is created with `workspaceId`, so it lands in the project the
       * panel is showing; locking it to the worktree is the skill's job, and the
       * first message is what makes the agent read that skill before touching a
       * file. Binding first means `hbs-wt env` already answers with the worktree
       * path when the agent looks.
       */
      async function startSession(request) {
        if (sessions === undefined || typeof sessions.create !== 'function') {
          return { ok: false, message: t('servicesMissing') };
        }
        const workspaceId = String(request.workspaceId || '');
        if (workspaceId === '') return { ok: false, message: t('noWorkspaces') };

        let sessionId;
        try {
          sessionId = await sessions.create({ workspaceId });
        } catch (error) {
          return { ok: false, message: String((error && error.message) || error) };
        }
        // The title the user typed is a hint: the first message owns the real one,
        // so a rename failure must not stop the worktree from being usable.
        const title = String(request.name || '');
        if (title !== '' && typeof sessions.rename === 'function') {
          try {
            await sessions.rename(sessionId, title);
          } catch {
            // keep the generated title
          }
        }
        // Reveal it, but never depend on the layout service being present.
        const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;
        if (uiWorkspace !== undefined && typeof uiWorkspace.openSession === 'function') {
          try {
            uiWorkspace.openSession(sessionId);
          } catch {
            // the session still shows up in the sidebar
          }
        }

        const bound = await post('bind', { branch: request.branch, session: sessionId }, state.root);
        if (bound.ok !== true) return { ok: false, message: errorText(t, bound.error), sessionId };

        const text = firstMessage(request.branch, request.path);
        try {
          const binding = await borrowSession(sessionId);
          await binding.session.prompt([{ type: 'text', text: text }], 'queue');
        } catch (error) {
          return { ok: false, message: t('firstMessageFailed') + '\n' + text, sessionId };
        }
        return { ok: true, sessionId };
      }

      /** Retain one session long enough to send it a prompt. */
      async function borrowSession(sessionId) {
        if (typeof sessions.using === 'function') {
          let borrowed;
          await sessions.using(sessionId, { source: 'hbs-worktree' }, async (reference) => {
            borrowed = reference.binding;
          });
          return borrowed;
        }
        const reference = sessions.retain(sessionId, { source: 'hbs-worktree' });
        try {
          return await reference.ready;
        } finally {
          reference.release();
        }
      }

      /**
       * While the main checkout previews a worktree branch it sits on a fixed
       * commit; a requirement finishing in that worktree moves the branch, not the
       * preview. This walks the preview forward — the engine decides, and only when
       * that same branch is the one being previewed.
       */
      async function followPreview() {
        const result = await post('follow', {}, state.root);
        if (result.ok === true && result.data !== null && result.data.changed === true) await loadWorkspace();
        return result;
      }

      const actions = {
        refresh: refresh,
        run: run,
        follow: followPreview,
        selectWorkspace: selectWorkspace,
        startSession: startSession,
      };

      ctx.effect(() => {
        const offSessions = sessions && sessions.list && typeof sessions.list.subscribe === 'function'
          ? sessions.list.subscribe(() => store.publish())
          : undefined;
        // A workspace that appears, moves or disappears changes the root, so the
        // whole page has to be re-read rather than merely repainted.
        const offWorkspaces = workspaces && workspaces.list && typeof workspaces.list.subscribe === 'function'
          ? workspaces.list.subscribe(() => {
            const chosen = pickWorkspace(workspaceSnapshot().items);
            const root = chosen === undefined ? '' : String(chosen.path || '');
            if (root !== state.root) {
              refresh();
              return;
            }
            store.publish();
          })
          : undefined;
        return () => {
          if (typeof offSessions === 'function') offSessions();
          if (typeof offWorkspaces === 'function') offWorkspaces();
        };
      }, 'hbs-worktree: service subscriptions');

      // The entrance people actually use: a panel in the left sidebar (the same
      // rail as Tasks and Plugins). The sidebar entry only supplies an icon and a
      // label; clicking it makes the layout select the `main` entry registered
      // under the same id, which renders the full page.
      const page = () => h(Panel, { t: t, store: store, actions: actions });

      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        locale: NS,
        label: () => t('title'),
      }, WorktreeIcon)), 'hbs-worktree: sidebar entry');

      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({}),
      }, page)), 'hbs-worktree: main panel');


      console.info('[hbs-worktree] entries registered: sidebar, main');
    }

    return { inject: inject, apply: apply };
  },
});
