import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { Octokit } from '@octokit/rest';
// [XG-CUSTOM] socks5 代理：GitHub API 走用户代理，解决国内直连 api.github.com 慢
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { ReadGitHubCredentials } from '@core/features/github/api/node/services/github-credentials';
import { normalizeRepositoryHost } from '@core/primitives/repository/api';
import type { GitHubApiAuthError } from './github-api-auth-errors';
import { getCachedOctokit, setCachedOctokit } from './octokit-cache';

export { clearOctokitCache } from './octokit-cache';

const octokitLog = {
  debug: (...input: unknown[]) => log.debug('Octokit', { args: input }),
  info: (...input: unknown[]) => log.debug('Octokit', { args: input }),
  warn: (...input: unknown[]) => log.warn('Octokit', { args: input }),
  error: (...input: unknown[]) => log.debug('Octokit request failed', { args: input }),
};

export class GitHubApiAuthErrorException extends Error {
  constructor(readonly authError: GitHubApiAuthError) {
    super(authError.message);
    this.name = 'GitHubApiAuthErrorException';
  }
}

export async function getOctokit(
  readCredentials: ReadGitHubCredentials,
  accountId: string,
  host: string
): Promise<Result<Octokit, GitHubApiAuthError>> {
  const normalizedHost = normalizeRepositoryHost(host);
  const credentials = await readCredentials(accountId, normalizedHost);
  if (!credentials.success) return err(credentials.error);
  const { accessToken, apiBaseUrl } = credentials.data;

  const cached = getCachedOctokit(normalizedHost, accountId);
  if (cached?.token === accessToken && cached.apiBaseUrl === apiBaseUrl) return ok(cached.octokit);

  // [XG-CUSTOM] 代理：XIANGWO_GITHUB_PROXY 优先，回退 XIANGWO_BROWSER_PROXY（和浏览器同代理）
  const proxyUrl = process.env.XIANGWO_GITHUB_PROXY || process.env.XIANGWO_BROWSER_PROXY;
  const octokit = new Octokit({
    auth: accessToken,
    baseUrl: apiBaseUrl,
    log: octokitLog,
    ...(proxyUrl ? { request: { agent: new SocksProxyAgent(proxyUrl) } } : {}),
  });

  setCachedOctokit(normalizedHost, accountId, { octokit, token: accessToken, apiBaseUrl });
  return ok(octokit);
}
