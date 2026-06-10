import { defaultShell } from "./deps";
import type { Shell } from "./types";

export type GitProvider = "github" | "bitbucket" | "gitlab" | "unknown";

export interface RemoteInfo {
  provider: GitProvider;
  host: string;
  owner: string;
  repo: string;
  // Browser-openable repo root, e.g. https://github.com/owner/repo
  webUrl: string;
  remoteUrl: string;
}

function providerForHost(host: string): GitProvider {
  const h = host.toLowerCase();
  if (h === "github.com" || h.endsWith(".github.com")) return "github";
  if (h === "bitbucket.org" || h.endsWith(".bitbucket.org")) return "bitbucket";
  if (h === "gitlab.com" || h.includes("gitlab")) return "gitlab";
  return "unknown";
}

// Accepts the three URL shapes git remotes use in practice:
//   git@github.com:owner/repo.git
//   ssh://git@bitbucket.org/owner/repo.git
//   https://gitlab.com/owner/repo.git
export function parseRemoteUrl(url: string): RemoteInfo | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  let host = "";
  let path = "";

  const scp = trimmed.match(/^(?:[\w.-]+@)?([\w.-]+):(?!\/)(.+)$/);
  const uri = trimmed.match(/^(?:ssh|https?|git):\/\/(?:[\w.-]+@)?([\w.-]+(?::\d+)?)\/(.+)$/);
  if (uri) {
    host = uri[1].replace(/:\d+$/, "");
    path = uri[2];
  } else if (scp) {
    host = scp[1];
    path = scp[2];
  } else {
    return null;
  }

  const segments = path.replace(/\.git$/, "").split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const repo = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join("/");

  return {
    provider: providerForHost(host),
    host,
    owner,
    repo,
    webUrl: `https://${host}/${owner}/${repo}`,
    remoteUrl: trimmed,
  };
}

// Web URL that opens the provider's create-PR/MR form for `branch`.
export function prWebUrl(info: RemoteInfo, branch: string, base?: string): string {
  switch (info.provider) {
    case "bitbucket": {
      const dest = base ? `&dest=${encodeURIComponent(base)}` : "";
      return `${info.webUrl}/pull-requests/new?source=${encodeURIComponent(branch)}${dest}`;
    }
    case "gitlab": {
      const target = base
        ? `&merge_request%5Btarget_branch%5D=${encodeURIComponent(base)}`
        : "";
      return `${info.webUrl}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${encodeURIComponent(branch)}${target}`;
    }
    default: {
      // GitHub compare URL also works for unknown hosts running GitHub Enterprise.
      const baseRef = base ?? "main";
      return `${info.webUrl}/compare/${encodeURIComponent(baseRef)}...${encodeURIComponent(branch)}?expand=1`;
    }
  }
}

export class GitProviderModule {
  private shell: Shell;

  constructor(opts: { shell?: Shell } = {}) {
    this.shell = opts.shell ?? defaultShell;
  }

  async remoteInfo(params: { worktreePath: string; remote?: string }): Promise<RemoteInfo> {
    const remote = params.remote ?? "origin";
    const url = (
      await this.shell.text(
        ["git", "-C", params.worktreePath, "remote", "get-url", remote],
        undefined
      )
    ).trim();
    const info = parseRemoteUrl(url);
    if (!info) throw new Error(`unrecognized remote URL for ${remote}: ${url}`);
    return info;
  }
}
