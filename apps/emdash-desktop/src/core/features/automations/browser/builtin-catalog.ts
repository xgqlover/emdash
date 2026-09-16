import { BookOpen, Bug, FlaskConical, Mail, Search, Wrench } from 'lucide-react';
import type { BuiltinAutomationTemplate } from './automation-template';

const TEST_COVERAGE_PROMPT =
  'Inspect recent merged code for meaningful regression risk and add the smallest deterministic tests for weakly covered behavior. Prioritize new code paths, bug fixes without tests, edge-case parsing, concurrency, permissions, validation, shared utilities, and core flows. Avoid low-signal snapshots and cosmetic-only changes. Follow existing test conventions, run relevant validation, and summarize what risky behavior is now covered.';

export const builtinAutomationCatalog: BuiltinAutomationTemplate[] = [
  {
    id: 'critical-bug-finder',
    category: '代码质量',
    name: '查找严重 bug',
    description: '分析最近的提交，查找高严重性正确性 bug 并提交安全修复',
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
    description:
      '发布每日摘要，总结前一天的仓库变更和风险',
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
    description:
      '按计划审查整个仓库，对已验证的高影响安全问题告警',
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
    description:
      '审查最近的变更，为覆盖不足的高风险逻辑添加测试',
    icon: FlaskConical,
    defaultTrigger: { expr: '0 10 * * 2', tz: 'UTC' },
    defaultConversationConfig: { initialPrompt: TEST_COVERAGE_PROMPT },
  },
  {
    id: 'reported-bugs',
    category: '事件与分诊',
    name: '修复上报的 bug',
    description:
      '调查你在 issue、文档或提示笔记中提供的 bug 报告，并用 PR 修复',
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
    description:
      '为最近变更或文档不足的代码创建和更新开发者文档',
    icon: BookOpen,
    defaultTrigger: { expr: '0 14 * * 5', tz: 'UTC' },
    defaultConversationConfig: {
      initialPrompt:
        'Find recently changed or under-documented developer-facing code. Add concise documentation that explains behavior, setup, examples, sharp edges, and validation steps. Prefer updating existing docs over creating duplicate pages.',
    },
  },
];

export const emptyStateAutomationTemplates = builtinAutomationCatalog;
