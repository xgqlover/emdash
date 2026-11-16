import { BookOpen, Bug, Compass, FlaskConical, Inbox, Mail, Search, Wrench } from 'lucide-react';
import type { BuiltinAutomationTemplate } from './automation-template';

const TEST_COVERAGE_PROMPT =
  'Inspect recent merged code for meaningful regression risk and add the smallest deterministic tests for weakly covered behavior. Prioritize new code paths, bug fixes without tests, edge-case parsing, concurrency, permissions, validation, shared utilities, and core flows. Avoid low-signal snapshots and cosmetic-only changes. Follow existing test conventions, run relevant validation, and summarize what risky behavior is now covered.';

export const builtinAutomationCatalog: BuiltinAutomationTemplate[] = [
  {
    id: 'critical-bug-finder',
    category: '代码质量',
    name: '查找严重缺陷',
    description: '分析近期提交，查找高严重性正确性缺陷并提交安全修复',
    icon: Bug,
    defaultTrigger: { expr: '0 10 * * 1', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Inspect recent code changes for high-severity correctness bugs, regressions, race conditions, data loss risks, and broken edge cases. If you find a real issue, implement the smallest safe fix and validate it with targeted tests.',
    },
  },
  {
    id: 'daily-change-summary',
    category: '状态报告',
    name: '每日总结变更',
    description: '发布每日摘要，总结前一天的显著仓库变更和风险',
    icon: Mail,
    defaultTrigger: { expr: '0 9 * * 1', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Create a concise daily digest of notable repository changes from the previous day. Highlight shipped work, risky changes, migrations, open blockers, and recommended follow-ups.',
    },
  },
  {
    id: 'codebase-vulnerability-scan',
    category: '安全',
    name: '扫描漏洞',
    description: '定期审查整个仓库，并对已验证的高影响安全问题告警',
    icon: Search,
    defaultTrigger: { expr: '0 11 * * 1', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Review the repository for validated high-impact security vulnerabilities. Focus on authentication, authorization, injection, secret handling, unsafe filesystem or shell usage, SSRF, deserialization, and privilege boundaries. Avoid noisy theoretical findings; only report or fix exploitable issues.',
    },
  },
  {
    id: 'test-coverage',
    category: '代码质量',
    name: '补充测试覆盖',
    description: '审查近期变更，为缺乏充分覆盖的高风险逻辑添加测试',
    icon: FlaskConical,
    defaultTrigger: { expr: '0 10 * * 2', tz: 'UTC' },
    defaultConversationConfig: { initialPrompt: TEST_COVERAGE_PROMPT },
  },
  {
    id: 'reported-bugs',
    category: '事故与分诊',
    name: '修复已报告缺陷',
    description: '调查你在 issue、文档或提示笔记中提供的缺陷报告，并以 PR 修复',
    icon: Wrench,
    defaultTrigger: { expr: '0 10 * * 1', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Review recent bug reports described in linked issues, project docs, or prompt notes. For actionable issues, reproduce or reason through the failure, identify the responsible code path, implement the smallest safe fix, add regression coverage, and prepare a PR summary. If no bug-report details are available, report what information is needed instead of guessing.',
    },
  },
  {
    id: 'docs-generator',
    category: '文档',
    name: '生成文档',
    description: '为近期变更或文档不足的代码创建和更新开发者文档',
    icon: BookOpen,
    defaultTrigger: { expr: '0 14 * * 5', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Find recently changed or under-documented developer-facing code. Add concise documentation that explains behavior, setup, examples, sharp edges, and validation steps. Prefer updating existing docs over creating duplicate pages.',
    },
  },
  {
    // [XG-CUSTOM 2026-11-17] AF 待接日报：只读 + 落盘，不回复、不归档
    id: 'xg-af-backlog',
    category: '运行状态',
    name: 'AF 待接日报',
    description: '读 AF 论坛未回答评论，按域/年龄/类型出日报（只读，不回帖）',
    icon: Inbox,
    defaultTrigger: { expr: '30 9 * * *', tz: 'Asia/Shanghai' },
    defaultConversationConfig: {
      initialPrompt:
        `用 bash 跑：python3 /home/xgqlover/天天项上/五层四维记忆系统/scripts/xg_af_daily.py
（它内部先做 L1 自动确认，再出日报。）

拿到输出后，把「已确认 N 条」和「按域待接」两段原样贴出来，不要自己编数。
若 bash 不可用，读 工作台/af-backlog-<今天>.md 并只做摘要。

补充口径：带 <!--mu-hive:…--> 的是「自家交付」，已由脚本自动确认；有人 @ 我们或提问的是「要答」；
空内容或 >30 天是「噪音」。

铁律：不要 af_reply、不要 af_clean、不改任何 AF 数据。`,
    },
  },
  {
    id: 'pm-one-thing',
    category: '产品管理',
    name: 'PM 一件事',
    description: '用 pm-router 自动选 /discover、/strategy、/write-prd 或 /plan-launch，产出 brief + artifacts',
    icon: Compass,
    defaultTrigger: { expr: '0 9 * * 1', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        '先读 /home/xgqlover/天天项上/五层四维记忆系统/skills-central/pm-router/SKILL.md 和同目录 routing.json，再按下面的任务用 pm-router 只选一条 command。' +
        '\n\n本任务：[在这里写产品/包装/上市任务]' +
        '\n\n执行要求：' +
        '\n1. 输出选择结果：command、reason、missing、next；' +
        '\n2. 读该 command 的 command_file，按其中步骤执行；' +
        '\n3. 先写 brief.md，再写 artifacts/<command>.md；缺信息按假设继续并写 open-questions.md；' +
        '\n4. 不自动执行下一条 command，最后只给 next 建议；' +
        '\n5. 产物落到当前工作区，不要只回聊天。',
    },
  },
];

export const emptyStateAutomationTemplates = builtinAutomationCatalog;
