// [XG-CUSTOM 2026-10-05] **事件载荷过滤器**回归测试（webhook-filter.ts）。
//
// 覆盖：空 filter=全匹配 · 路径取值（点号/数组下标/嵌套）· 五种比较 · `&&`/`||` ·
//      **解析失败 fail-closed（不匹配、不抛）** · 路径缺失（`exists`/`notExists`）·
//      类型不匹配不误判（字符串 vs 数字）· 严禁被当作代码执行（注入样本）
import { describe, expect, it } from 'vitest';
import { matchWebhookFilter, parseWebhookFilter } from './webhook-filter';

const PUSH = {
  action: 'opened',
  repository: { name: 'emdash', owner: { login: 'xgqlover' }, private: false },
  pull_request: { number: 42, draft: true, labels: ['bug', 'p1'] },
  commits: [{ message: 'fix(orb): restore history' }, { message: 'chore: bump' }],
};

describe('webhook-filter 基本行为', () => {
  it('空/空白/undefined → 一律匹配（等于没过滤）', () => {
    expect(matchWebhookFilter(undefined, PUSH)).toBe(true);
    expect(matchWebhookFilter('', PUSH)).toBe(true);
    expect(matchWebhookFilter('   ', PUSH)).toBe(true);
  });

  it('点号路径 + 字符串相等', () => {
    expect(matchWebhookFilter('action == "opened"', PUSH)).toBe(true);
    expect(matchWebhookFilter('action == "closed"', PUSH)).toBe(false);
    expect(matchWebhookFilter('repository.name == "emdash"', PUSH)).toBe(true);
    expect(matchWebhookFilter('repository.owner.login == "xgqlover"', PUSH)).toBe(true);
  });

  it('单引号也认；不等号', () => {
    expect(matchWebhookFilter("action == 'opened'", PUSH)).toBe(true);
    expect(matchWebhookFilter('action != "opened"', PUSH)).toBe(false);
    expect(matchWebhookFilter('action != "closed"', PUSH)).toBe(true);
  });

  it('数字与布尔值按类型比较', () => {
    expect(matchWebhookFilter('pull_request.number == 42', PUSH)).toBe(true);
    expect(matchWebhookFilter('pull_request.number == 43', PUSH)).toBe(false);
    expect(matchWebhookFilter('pull_request.draft == true', PUSH)).toBe(true);
    expect(matchWebhookFilter('repository.private == false', PUSH)).toBe(true);
    expect(matchWebhookFilter('repository.private == true', PUSH)).toBe(false);
  });

  it('数组下标与数组 contains', () => {
    expect(matchWebhookFilter('commits[0].message contains "restore history"', PUSH)).toBe(true);
    expect(matchWebhookFilter('commits[1].message startsWith "chore"', PUSH)).toBe(true);
    expect(matchWebhookFilter('pull_request.labels contains "p1"', PUSH)).toBe(true);
    expect(matchWebhookFilter('pull_request.labels contains "p2"', PUSH)).toBe(false);
    expect(matchWebhookFilter('commits[5].message == "x"', PUSH)).toBe(false); // 越界=缺失
  });

  it('endsWith / startsWith 对非字符串不误判', () => {
    expect(matchWebhookFilter('commits[1].message endsWith "bump"', PUSH)).toBe(true);
    expect(matchWebhookFilter('pull_request.number startsWith "4"', PUSH)).toBe(false);
  });

  it('exists / notExists', () => {
    expect(matchWebhookFilter('pull_request.draft exists', PUSH)).toBe(true);
    expect(matchWebhookFilter('pull_request.missing notExists', PUSH)).toBe(true);
    expect(matchWebhookFilter('pull_request.missing exists', PUSH)).toBe(false);
    expect(matchWebhookFilter('pull_request.draft notExists', PUSH)).toBe(false);
  });

  it('&& / || 组合（左结合）', () => {
    expect(matchWebhookFilter('action == "opened" && repository.name == "emdash"', PUSH)).toBe(true);
    expect(matchWebhookFilter('action == "opened" && repository.name == "other"', PUSH)).toBe(false);
    expect(matchWebhookFilter('action == "closed" || repository.name == "emdash"', PUSH)).toBe(true);
    expect(matchWebhookFilter('action == "closed" || repository.name == "other"', PUSH)).toBe(false);
    expect(
      matchWebhookFilter('action == "opened" && pull_request.draft == true && repository.private == false', PUSH)
    ).toBe(true);
  });
});

describe('webhook-filter fail-closed（安全侧）', () => {
  it('解析失败 → 不匹配（而不是放行）', () => {
    for (const broken of [
      'action ==',
      '== "opened"',
      'action = "opened"',
      'action == "unterminated',
      'action == "a" &&',
      'repository..name == "x"',
      'action == "a")',
      '1 == 1',
    ]) {
      expect(matchWebhookFilter(broken, PUSH), `filter=${broken}`).toBe(false);
    }
  });

  it('载荷不是对象时不抛，按"路径缺失"处理', () => {
    expect(matchWebhookFilter('action == "opened"', null)).toBe(false);
    expect(matchWebhookFilter('action == "opened"', '字符串载荷')).toBe(false);
    expect(matchWebhookFilter('action == "opened"', 42)).toBe(false);
    expect(matchWebhookFilter('anything notExists', null)).toBe(true);
  });

  it('不能借表达式执行代码（注入样本一律只是"不匹配"）', () => {
    for (const evil of [
      'constructor.constructor == "x"',
      'toString == "x"',
      '__proto__.polluted == true',
      'action == "${process.env.SECRET}"',
    ]) {
      expect(() => matchWebhookFilter(evil, PUSH)).not.toThrow();
      expect(matchWebhookFilter(evil, PUSH)).toBe(false);
    }
  });

  it('parseWebhookFilter 给出可用的创建期校验', () => {
    expect(parseWebhookFilter('').ok).toBe(true);
    expect(parseWebhookFilter('action == "opened"').ok).toBe(true);
    expect(parseWebhookFilter('action ==')).toEqual({ ok: false, reason: 'unparsable' });
  });
});
