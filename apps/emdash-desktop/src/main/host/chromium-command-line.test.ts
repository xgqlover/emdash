import { describe, expect, it, vi } from 'vitest';
import { configureChromiumCommandLine } from './chromium-command-line';

function createCommandLine(initialSwitches: string[] = []) {
  const switches = new Set(initialSwitches);
  return {
    appendSwitch: vi.fn((name: string) => switches.add(name)),
    hasSwitch: vi.fn((name: string) => switches.has(name)),
  };
}

// [XG-CUSTOM] 2026-10-06 —— `configureChromiumCommandLine()` 现在**先**加两个与平台无关的
// DoH 开关（`dns-over-https-mode` / `dns-over-https-templates`，见 chromium-doh.ts），
// 再加 Linux 专有的 ozone / password-store ⇒ 下面的调用序号与次数相应后移。
const DOH_SWITCH_NAMES = ['dns-over-https-mode', 'dns-over-https-templates'];

describe('configureChromiumCommandLine', () => {
  it('configures Linux switches synchronously without requiring a D-Bus environment variable', () => {
    const commandLine = createCommandLine();

    configureChromiumCommandLine({
      commandLine,
      env: { XDG_CURRENT_DESKTOP: 'Hyprland' },
      platform: 'linux',
    });

    expect(commandLine.appendSwitch).toHaveBeenNthCalledWith(1, 'dns-over-https-mode', 'secure');
    expect(commandLine.appendSwitch.mock.calls[1]?.[0]).toBe('dns-over-https-templates');
    expect(commandLine.appendSwitch).toHaveBeenNthCalledWith(3, 'ozone-platform-hint', 'auto');
    expect(commandLine.appendSwitch).toHaveBeenNthCalledWith(
      4,
      'password-store',
      'gnome-libsecret'
    );
  });

  it('preserves an explicit password-store switch', () => {
    const commandLine = createCommandLine(['password-store']);

    configureChromiumCommandLine({
      commandLine,
      env: { XDG_CURRENT_DESKTOP: 'Hyprland' },
      platform: 'linux',
    });

    expect(commandLine.appendSwitch.mock.calls.map((call) => call[0])).toEqual([
      ...DOH_SWITCH_NAMES,
      'ozone-platform-hint',
    ]);
  });

  it("leaves KDE to Chromium's KWallet selection", () => {
    const commandLine = createCommandLine();

    configureChromiumCommandLine({
      commandLine,
      env: { XDG_CURRENT_DESKTOP: 'Plasma' },
      platform: 'linux',
    });

    expect(commandLine.appendSwitch.mock.calls.map((call) => call[0])).toEqual([
      ...DOH_SWITCH_NAMES,
      'ozone-platform-hint',
    ]);
  });

  it('adds only the platform-independent DoH switches on non-Linux platforms', () => {
    const commandLine = createCommandLine();

    configureChromiumCommandLine({ commandLine, env: {}, platform: 'darwin' });

    expect(commandLine.appendSwitch.mock.calls.map((call) => call[0])).toEqual(DOH_SWITCH_NAMES);
    expect(commandLine.hasSwitch).not.toHaveBeenCalled();
  });
});
