import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildRemoteCommand,
  configureXiangwoScriptRunner,
  runXiangwoScript,
  resolveXiangwoScriptPath,
  type XiangwoScriptRequest,
} from './xiangwo-script-runner';

const REQUEST: XiangwoScriptRequest = {
  label: '侧边交接台',
  interpreter: { local: 'node', remote: 'node' },
  scriptPath: '/opt/wego-lite/task-spaces/task-spaces.mjs',
  envVar: 'XIANGWO_TASK_SPACES_MJS',
  args: ['list'],
};

const REQUEST_WITH_SEARCH: XiangwoScriptRequest = {
  ...REQUEST,
  interpreter: {
    local: 'node',
    remote: 'node',
    remoteSearchPaths: ['"$HOME"/.nvm/versions/node/*/bin/node', '/usr/bin/node'],
  },
};

afterEach(() => {
  delete process.env.XIANGWO_TASK_SPACES_MJS;
  configureXiangwoScriptRunner({});
});

describe('[XG-CUSTOM] resolveXiangwoScriptPath', () => {
  it('环境变量覆盖脚本路径', () => {
    expect(resolveXiangwoScriptPath(REQUEST)).toBe(REQUEST.scriptPath);
    process.env.XIANGWO_TASK_SPACES_MJS = '  D:\\wego\\task-spaces.mjs ';
    expect(resolveXiangwoScriptPath(REQUEST)).toBe('D:\\wego\\task-spaces.mjs');
  });
});

describe('[XG-CUSTOM] runXiangwoScript 本机', () => {
  it('本机有脚本 → 本地 spawn（保持旧行为）并解析 JSON', async () => {
    const execLocal = vi.fn(async () => ({ stdout: '[{"id":"a"}]', stderr: '', exitCode: 0 }));
    configureXiangwoScriptRunner({
      activeRemoteHost: () => undefined,
      execLocal,
      fileExists: () => true,
    });
    const result = await runXiangwoScript(REQUEST);
    expect(result).toEqual([{ id: 'a' }]);
    expect(execLocal).toHaveBeenCalledWith('node', [REQUEST.scriptPath, 'list']);
  });

  it('本机没有脚本 → 人话错误（不再 ENOENT 裸抛）', async () => {
    const execLocal = vi.fn();
    configureXiangwoScriptRunner({
      activeRemoteHost: () => undefined,
      execLocal,
      fileExists: () => false,
    });
    await expect(runXiangwoScript(REQUEST)).rejects.toThrow(
      /侧边交接台不可用：本机没有脚本文件 .*XIANGWO_TASK_SPACES_MJS/
    );
    expect(execLocal).not.toHaveBeenCalled();
  });

  it('退出码非 0 → 带 exit 码 + stderr 首行的人话错误', async () => {
    configureXiangwoScriptRunner({
      activeRemoteHost: () => undefined,
      execLocal: async () => ({ stdout: '', stderr: 'Cannot find module\nmore', exitCode: 1 }),
      fileExists: () => true,
    });
    await expect(runXiangwoScript(REQUEST)).rejects.toThrow(
      /侧边交接台在本机执行失败（exit 1）：Cannot find module（脚本路径不对：检查环境变量 XIANGWO_TASK_SPACES_MJS /
    );
  });

  it('本机执行器抛错 → 包成人话', async () => {
    configureXiangwoScriptRunner({
      activeRemoteHost: () => undefined,
      execLocal: async () => {
        throw new Error('spawn node ENOENT');
      },
      fileExists: () => true,
    });
    await expect(runXiangwoScript(REQUEST)).rejects.toThrow(/侧边交接台启动失败：.*ENOENT/);
  });
});

describe('[XG-CUSTOM] runXiangwoScript 远程主机', () => {
  it('有远程主机 → 走 SSH 通道在主机上跑同一个脚本', async () => {
    const execRemote = vi.fn(async () => ({ stdout: '{"ok":true}', stderr: '', exitCode: 0 }));
    const execLocal = vi.fn();
    configureXiangwoScriptRunner({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '10.239.5.174' }),
      execRemote,
      execLocal,
      fileExists: () => false,
    });
    const result = await runXiangwoScript(REQUEST);
    expect(result).toEqual({ ok: true });
    expect(execRemote).toHaveBeenCalledWith('ssh-1', 'node', [REQUEST.scriptPath, 'list']);
    expect(execLocal).not.toHaveBeenCalled();
  });

  it('主机通道没就绪 → 人话错误（提示先连主机）', async () => {
    configureXiangwoScriptRunner({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '100.125.4.119' }),
      execRemote: undefined,
      fileExists: () => true,
    });
    await expect(runXiangwoScript(REQUEST)).rejects.toThrow(
      /侧边交接台不可用：当前是远程主机 100\.125\.4\.119，但主机通道尚未就绪/
    );
  });

  it('远程执行抛错 → 报主机名 + 原因', async () => {
    configureXiangwoScriptRunner({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '100.125.4.119' }),
      execRemote: async () => {
        throw new Error('channel open failure');
      },
    });
    await expect(runXiangwoScript(REQUEST)).rejects.toThrow(
      /侧边交接台在远程主机 100\.125\.4\.119 上执行失败：.*channel open failure/
    );
  });

  it('远程退出码非 0 → 人话错误（含主机名）', async () => {
    configureXiangwoScriptRunner({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '100.125.4.119' }),
      execRemote: async () => ({ stdout: '', stderr: 'python3: not found', exitCode: 127 }),
    });
    await expect(runXiangwoScript(REQUEST)).rejects.toThrow(
      /侧边交接台在远程主机 100\.125\.4\.119 上执行失败（exit 127）：python3: not found/
    );
  });

  it('读主机失败 → 按本机处理，不炸', async () => {
    configureXiangwoScriptRunner({
      activeRemoteHost: () => {
        throw new Error('db gone');
      },
      execLocal: async () => ({ stdout: 'ok', stderr: '', exitCode: 0 }),
      fileExists: () => true,
    });
    await expect(runXiangwoScript(REQUEST)).resolves.toBe('ok');
  });
});

describe('[XG-CUSTOM] buildRemoteCommand（解释器不在 PATH 里）', () => {
  it('先 command -v，再逐个兜底绝对路径，最后 exit 127；argv 已转义', () => {
    const script = buildRemoteCommand(REQUEST_WITH_SEARCH, "/opt/we go/task's.mjs");
    expect(script).toContain("XG_BIN=\"$(command -v node 2>/dev/null || true)\"");
    expect(script).toContain('for xg_c in "$HOME"/.nvm/versions/node/*/bin/node /usr/bin/node; do');
    expect(script).toContain('exit 127');
    expect(script).toContain(`exec "$XG_BIN" '/opt/we go/task'\\''s.mjs' list`);
  });

  it('没有兜底路径时不生成 shell（走 argv 直跑）', async () => {
    const execRemote = vi.fn(async () => ({ stdout: '{}', stderr: '', exitCode: 0 }));
    const execRemoteScript = vi.fn();
    configureXiangwoScriptRunner({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '10.0.0.1' }),
      execRemote,
      execRemoteScript,
    });
    await runXiangwoScript(REQUEST);
    expect(execRemote).toHaveBeenCalledWith('ssh-1', 'node', [REQUEST.scriptPath, 'list']);
    expect(execRemoteScript).not.toHaveBeenCalled();
  });

  it('有兜底路径 → 走 execScript（nvm node 的真实场景）', async () => {
    const execRemote = vi.fn();
    const execRemoteScript = vi.fn(async (_connectionId: string, _script: string) => ({
      stdout: '{"ok":1}',
      stderr: '',
      exitCode: 0,
    }));
    configureXiangwoScriptRunner({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '10.239.5.174' }),
      execRemote,
      execRemoteScript,
    });
    await expect(runXiangwoScript(REQUEST_WITH_SEARCH)).resolves.toEqual({ ok: 1 });
    expect(execRemote).not.toHaveBeenCalled();
    const script = execRemoteScript.mock.calls[0]?.[1];
    expect(String(script)).toContain('command -v node');
    expect(String(script)).toContain(REQUEST.scriptPath);
  });

  it('主机的解释器也找不到（exit 127）→ 人话错误', async () => {
    configureXiangwoScriptRunner({
      activeRemoteHost: () => ({ connectionId: 'ssh-1', host: '10.239.5.174' }),
      execRemoteScript: async () => ({
        stdout: '',
        stderr: 'xiangwo: interpreter not found on host: node',
        exitCode: 127,
      }),
    });
    await expect(runXiangwoScript(REQUEST_WITH_SEARCH)).rejects.toThrow(
      /侧边交接台在远程主机 10\.239\.5\.174 上执行失败（exit 127）：xiangwo: interpreter not found on host: node/
    );
  });
});
