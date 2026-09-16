import type { ShareableProjectSettingsWriteField } from '@core/primitives/project-settings/api';

export type ShareableFieldFormKey =
  | 'preservePatterns'
  | 'scriptPrepare'
  | 'scriptSetup'
  | 'scriptRun'
  | 'scriptTeardown';

export type ShareableFieldDescriptor = {
  id: ShareableProjectSettingsWriteField;
  formKey: ShareableFieldFormKey;
  modalLabel: string;
  leafLabel: string;
  defaultWrite: boolean;
  normalizeText(value: string): string;
  placeholder?: string;
  description?: string;
  multiline: boolean;
  group?: 'lifecycle';
};

function trimText(value: string): string {
  return value.trim();
}

function normalizePatternList(value: string): string {
  return value
    .split('\n')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .join('\n');
}

export const SHAREABLE_FIELD_DESCRIPTORS: ShareableFieldDescriptor[] = [
  {
    id: 'preservePatterns',
    formKey: 'preservePatterns',
    modalLabel: '保留模式',
    leafLabel: '保留模式',
    defaultWrite: true,
    normalizeText: normalizePatternList,
    placeholder: '.env\n.env.local',
    description:
      '匹配这些 glob 模式的已忽略和未跟踪文件会从主仓库复制到每个工作树。每行一个模式。',
    multiline: true,
  },
  {
    id: 'scripts.prepare',
    formKey: 'scriptPrepare',
    modalLabel: '准备脚本',
    leafLabel: '准备',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'python -m venv .venv\nmise install',
    description:
      '工作区存在后、任务会话开始前运行的阻塞命令。用于代理依赖的环境设置。',
    multiline: true,
    group: 'lifecycle',
  },
  {
    id: 'scripts.setup',
    formKey: 'scriptSetup',
    modalLabel: '设置脚本',
    leafLabel: '设置',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'npm install\ncp .env.example .env',
    multiline: true,
    group: 'lifecycle',
  },
  {
    id: 'scripts.run',
    formKey: 'scriptRun',
    modalLabel: '运行脚本',
    leafLabel: '运行',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'npm run dev',
    multiline: true,
    group: 'lifecycle',
  },
  {
    id: 'scripts.teardown',
    formKey: 'scriptTeardown',
    modalLabel: '清理脚本',
    leafLabel: '清理',
    defaultWrite: true,
    normalizeText: trimText,
    placeholder: 'docker compose down',
    multiline: true,
    group: 'lifecycle',
  },
];

export const SHAREABLE_FIELD_DESCRIPTOR_BY_ID = Object.fromEntries(
  SHAREABLE_FIELD_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor])
) as Record<ShareableProjectSettingsWriteField, ShareableFieldDescriptor>;

export const DEFAULT_WRITE_FIELDS = SHAREABLE_FIELD_DESCRIPTORS.filter(
  (descriptor) => descriptor.defaultWrite
).map((descriptor) => descriptor.id);

export const SHAREABLE_FIELD_FORM_KEY = Object.fromEntries(
  SHAREABLE_FIELD_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor.formKey])
) as Record<ShareableProjectSettingsWriteField, ShareableFieldFormKey>;
