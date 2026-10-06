// [XG-CUSTOM] 2026-10-06 —— `browser.openUrl`（打开网址…）的纯逻辑单测。
//   钉住三件事：① 只收 http(s) ② 没带协议补 https:// ③ run 走的是 paneLayout.open('browser', { initialUrl })
import { describe, expect, it, vi } from 'vitest';
import {
  openUrlInBrowserPane,
  planOpenUrlCommand,
  resolveOpenUrlInput,
  type OpenUrlBrowserTarget,
} from './open-url-command';

describe('resolveOpenUrlInput', () => {
  it('keeps http(s) URLs as-is', () => {
    expect(resolveOpenUrlInput('https://g-mark.org')).toEqual({
      ok: true,
      url: 'https://g-mark.org/',
    });
    expect(resolveOpenUrlInput('http://localhost:3000/a?b=1#c')).toEqual({
      ok: true,
      url: 'http://localhost:3000/a?b=1#c',
    });
    expect(resolveOpenUrlInput('  https://example.com/x  ')).toEqual({
      ok: true,
      url: 'https://example.com/x',
    });
  });

  it('adds https:// when the scheme is missing', () => {
    expect(resolveOpenUrlInput('g-mark.org')).toEqual({ ok: true, url: 'https://g-mark.org/' });
    expect(resolveOpenUrlInput('example.com/path?q=1')).toEqual({
      ok: true,
      url: 'https://example.com/path?q=1',
    });
    // 无协议的 host:port 也补 https://（冒号后面是端口，不是协议）
    expect(resolveOpenUrlInput('localhost:5173')).toEqual({
      ok: true,
      url: 'https://localhost:5173/',
    });
    expect(resolveOpenUrlInput('127.0.0.1:8080/x')).toEqual({
      ok: true,
      url: 'https://127.0.0.1:8080/x',
    });
  });

  it('rejects empty input', () => {
    const empty = resolveOpenUrlInput('   ');
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.message).toContain('请输入网址');
  });

  it('rejects non-http(s) schemes instead of silently opening them', () => {
    for (const dangerous of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<h1>x</h1>',
      'mailto:someone@example.com',
      'ftp://example.com/x',
    ]) {
      const result = resolveOpenUrlInput(dangerous);
      expect(result.ok, dangerous).toBe(false);
      if (!result.ok) expect(result.message).toContain('只支持 http/https');
    }
  });

  it('rejects malformed or incomplete hosts', () => {
    expect(resolveOpenUrlInput('https://').ok).toBe(false);
    expect(resolveOpenUrlInput('hello world').ok).toBe(false);
    expect(resolveOpenUrlInput('hello').ok).toBe(false);
  });
});

describe('planOpenUrlCommand', () => {
  it('asks for input when the command is invoked without a url (command palette path)', () => {
    expect(planOpenUrlCommand(undefined)).toEqual({ kind: 'prompt' });
    expect(planOpenUrlCommand({ url: '   ' })).toEqual({ kind: 'prompt' });
  });

  it('opens a valid url directly', () => {
    expect(planOpenUrlCommand({ url: 'g-mark.org' })).toEqual({
      kind: 'open',
      url: 'https://g-mark.org/',
    });
  });

  it('reports invalid input instead of doing nothing', () => {
    const plan = planOpenUrlCommand({ url: 'javascript:alert(1)' });
    expect(plan.kind).toBe('error');
    if (plan.kind === 'error') expect(plan.message).toContain('只支持 http/https');
  });
});

describe('openUrlInBrowserPane', () => {
  it('opens the embedded browser pane with the url and focuses the main region', () => {
    const open = vi.fn();
    const setFocusedRegion = vi.fn();
    const target: OpenUrlBrowserTarget = { paneLayout: { open }, setFocusedRegion };

    expect(openUrlInBrowserPane(target, 'https://g-mark.org/')).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('browser', { initialUrl: 'https://g-mark.org/' });
    expect(setFocusedRegion).toHaveBeenCalledWith('main');
  });

  it('reports failure when there is no task view to open into', () => {
    expect(openUrlInBrowserPane(undefined, 'https://g-mark.org/')).toBe(false);
  });
});
