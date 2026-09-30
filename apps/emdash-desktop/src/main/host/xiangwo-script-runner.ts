// [XG-CUSTOM] 主机感知的"项我 CLI"执行器（侧边交接台 / 专家交接台等）。
//
// 问题（Windows 客户端断点）：window.ts 原来把 Linux 绝对路径写死在本机 ——
//   /persistent/home/xgqlover/天天项上/五层四维记忆系统/wego-lite/task-spaces/task-spaces.mjs
//   /persistent/home/xgqlover/天天项上/五层四维记忆系统/xiangwo-agent/expert_handoff.py
// 远程主机（Windows 客户端 SSH 连 Linux 主机）上这些路径不存在 → spawn ENOENT → 直接抛原始异常，
// UI 只有一句「交接失败: spawn node ENOENT」，看不出该干什么。
//
// 解决：
//   1. **主机感知**：本机（无远程主机）= 本地 spawn（保持原行为）；远程主机 = 走 emdash 已有的
//      SSH 通道（`SshClientProxy.exec` / `execScript`）在**主机上**跑同一个脚本。
//   2. **人话错误**：路径不存在 / 通道没就绪 / 退出码非 0 → 抛带"该干什么"的普通 Error
//      （渲染进程本来就会把 message 显示出来，见 orb.js 的 `交接失败: …`）。
//   3. 路径可用环境变量覆盖（XIANGWO_TASK_SPACES_MJS / XIANGWO_EXPERT_HANDOFF_PY）。
//   4. **解释器不能在 PATH 里**：这台主机的 node 是 nvm 装的（`~/.nvm/.../bin/node`），
//      sshd 的非交互 exec **没有** nvm 的 PATH → 直接 `node script` 会 exit 127。
//      所以远程执行按 `remoteSearchPaths` 生成一段小 shell（`command -v` → 逐个绝对路径），
//      用 `execScript` 跑；argv 用 `quoteArg(posix)` 转义，不手搓引号。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { quoteArg } from '@emdash/core/primitives/exec/api';

export type XiangwoScriptHost = { connectionId: string; host: string };

export type XiangwoScriptExecResult = { stdout: string; stderr: string; exitCode: number };

export type XiangwoScriptInterpreter = {
  /** 本机解释器（可以是绝对路径，例如 /usr/bin/python3） */
  local: string;
  /** 远程主机上的解释器名（走 PATH） */
  remote: string;
  /** PATH 里找不到时依次尝试的绝对路径；`$HOME`/`*` 由 shell 展开（只允许写常量，不接用户输入） */
  remoteSearchPaths?: string[];
};

export type XiangwoScriptRunnerDeps = {
  /** 当前主机候选（无远程主机 → undefined） */
  activeRemoteHost?: () => XiangwoScriptHost | undefined | null;
  /** 在远程主机上执行 argv（走 SSH exec；由 bootstrap 注入 infrastructure.ssh.manager） */
  execRemote?: (
    connectionId: string,
    command: string,
    args: string[]
  ) => Promise<XiangwoScriptExecResult>;
  /** 在远程主机上执行一段 POSIX shell（走 SSH execScript；解释器不在 PATH 时用） */
  execRemoteScript?: (
    connectionId: string,
    script: string
  ) => Promise<XiangwoScriptExecResult>;
  /** 本机执行 argv（缺省 = child_process.spawn） */
  execLocal?: (command: string, args: string[]) => Promise<XiangwoScriptExecResult>;
  /** 本机文件是否存在（缺省 = fs.existsSync） */
  fileExists?: (path: string) => boolean;
  log?: (message: string, meta?: Record<string, unknown>) => void;
};

export type XiangwoScriptRequest = {
  /** 人话名字（错误信息里用），例如「侧边交接台」 */
  label: string;
  /** 解释器（本地 / 远程分开：本地可以是绝对路径，远程走 PATH + 兜底搜索路径） */
  interpreter: XiangwoScriptInterpreter;
  /** 默认脚本路径（Linux 主机上的绝对路径） */
  scriptPath: string;
  /** 覆盖脚本路径的环境变量名 */
  envVar: string;
  /** 脚本参数（命令 + 参数） */
  args: string[];
};

let configuredDeps: XiangwoScriptRunnerDeps | undefined;

/** 注入依赖（boot 时调一次；见 bootstrap/boot/phases/services.ts） */
export function configureXiangwoScriptRunner(deps: XiangwoScriptRunnerDeps): void {
  configuredDeps = deps;
}

/** 脚本路径：环境变量优先（允许远程/本机指向别处） */
export function resolveXiangwoScriptPath(request: XiangwoScriptRequest): string {
  const override = process.env[request.envVar];
  if (typeof override === 'string' && override.trim() !== '') return override.trim();
  return request.scriptPath;
}

function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map((item) => item.trim())
    .find((item) => item !== '');
  return line ?? '';
}

function isMissingFileError(text: string): boolean {
  return /ENOENT|No such file|Cannot find module|not found/i.test(text);
}

/** 缺省的本机执行器（spawn + 收集 stdout/stderr；失败不抛，交给调用方看 exitCode） */
function defaultExecLocal(command: string, args: string[]): Promise<XiangwoScriptExecResult> {
  return new Promise<XiangwoScriptExecResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

function parseStdout(stdout: string): unknown {
  const text = stdout.trim();
  if (text === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * 执行一次项我 CLI。
 *
 * 本机：脚本必须存在（不存在给人话错误，不再抛 ENOENT）。
 * 远程：走注入的 SSH 通道；通道没就绪 / 执行失败 / 退出码非 0 都给人话错误。
 * @param request 见 XiangwoScriptRequest
 * @returns 解析后的 JSON（解析不了就返回原始 stdout 文本）
 */
export async function runXiangwoScript(request: XiangwoScriptRequest): Promise<unknown> {
  const deps = configuredDeps ?? {};
  const scriptPath = resolveXiangwoScriptPath(request);
  let host: XiangwoScriptHost | undefined;
  try {
    host = deps.activeRemoteHost?.() ?? undefined;
  } catch (error) {
    deps.log?.('读取当前主机失败，按本机处理', { label: request.label, error: String(error) });
  }

  if (host === undefined || host === null) {
    const fileExists = deps.fileExists ?? existsSync;
    let exists = false;
    try {
      exists = fileExists(scriptPath);
    } catch {
      exists = false;
    }
    if (!exists) {
      throw new Error(
        `${request.label}不可用：本机没有脚本文件 ${scriptPath}（可用环境变量 ${request.envVar} 指定路径）`
      );
    }
    const execLocal = deps.execLocal ?? defaultExecLocal;
    let result: XiangwoScriptExecResult;
    try {
      result = await execLocal(request.interpreter.local, [scriptPath, ...request.args]);
    } catch (error) {
      throw new Error(`${request.label}启动失败：${String(error)}`);
    }
    return finish(request, result);
  }

  const execRemote = deps.execRemote;
  const execRemoteScript = deps.execRemoteScript;
  const searchPaths = request.interpreter.remoteSearchPaths ?? [];
  const useScript = searchPaths.length > 0 && execRemoteScript !== undefined;
  if (!useScript && execRemote === undefined) {
    throw new Error(
      `${request.label}不可用：当前是远程主机 ${host.host}，但主机通道尚未就绪（请先在 emdash 里连上这台主机）`
    );
  }
  deps.log?.('项我 CLI 走远程主机执行', {
    label: request.label,
    host: host.host,
    scriptPath,
    viaScript: useScript,
  });
  const connectionId = host.connectionId;
  let result: XiangwoScriptExecResult;
  try {
    if (useScript) {
      result = await execRemoteScript(connectionId, buildRemoteCommand(request, scriptPath));
    } else if (execRemote !== undefined) {
      result = await execRemote(connectionId, request.interpreter.remote, [
        scriptPath,
        ...request.args,
      ]);
    } else {
      throw new Error('主机通道尚未就绪');
    }
  } catch (error) {
    throw new Error(`${request.label}在远程主机 ${host.host} 上执行失败：${String(error)}`);
  }
  return finish(request, result, host);
}

/**
 * 远程执行的 POSIX shell（解释器可能不在 sshd 的 PATH 里）：
 * 1) `command -v <解释器>`（PATH 里有就直接用）；
 * 2) 否则按 `remoteSearchPaths` 逐个试（支持 `$HOME` 与 `*` 展开，只允许写常量）；
 * 3) 都没有 → 写人话错误并 exit 127（会被 finish 包成"执行失败（exit 127）"）。
 * 脚本路径与参数用 `quoteArg(posix)` 转义（中文/空格/引号都安全）。
 * @param request 请求（读 interpreter.remote / remoteSearchPaths / args）
 * @param scriptPath 已解析的脚本路径
 * @returns 可直接交给 `SshClientProxy.execScript` 的 shell 脚本
 */
export function buildRemoteCommand(request: XiangwoScriptRequest, scriptPath: string): string {
  const binary = quoteArg(request.interpreter.remote, 'posix');
  const search = (request.interpreter.remoteSearchPaths ?? []).join(' ');
  const argv = [scriptPath, ...request.args].map((value) => quoteArg(value, 'posix')).join(' ');
  return [
    `XG_BIN="$(command -v ${binary} 2>/dev/null || true)"`,
    'if [ -z "$XG_BIN" ]; then',
    `  for xg_c in ${search}; do`,
    '    if [ -x "$xg_c" ]; then XG_BIN="$xg_c"; break; fi',
    '  done',
    'fi',
    'if [ -z "$XG_BIN" ]; then',
    `  echo "xiangwo: interpreter not found on host: ${request.interpreter.remote}" >&2`,
    '  exit 127',
    'fi',
    `exec "$XG_BIN" ${argv}`,
  ].join('\n');
}

function finish(
  request: XiangwoScriptRequest,
  result: XiangwoScriptExecResult,
  host?: XiangwoScriptHost
): unknown {
  if (result.exitCode !== 0) {
    const detail = firstLine(result.stderr) || firstLine(result.stdout) || '无错误输出';
    const where = host === undefined ? '本机' : `远程主机 ${host.host} 上`;
    const hint = isMissingFileError(detail)
      ? `（脚本路径不对：检查环境变量 ${request.envVar} 或主机上的 ${request.scriptPath}）`
      : '';
    throw new Error(
      `${request.label}在${where}执行失败（exit ${String(result.exitCode)}）：${detail}${hint}`
    );
  }
  return parseStdout(result.stdout);
}
