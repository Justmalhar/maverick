import { defaultShell } from "./deps";
import type { Shell } from "./types";

// Connect/disconnect HTTPS credentials for a git host by driving git's own
// credential helper (Git Credential Manager on Windows). CLAUDE.md rule 5:
// Maverick never stores the secret — it validates the token against the
// provider, then hands it to `git credential approve`, which persists it in the
// system credential store. The secret travels via stdin only, and never appears
// in a return value, log, or thrown error.

export type CredentialProvider = "github" | "bitbucket" | "gitlab";

interface ProviderConfig {
  host: string;
  // Authenticated "current user" endpoint + how the token is presented.
  userApi: string;
  authHeader: (username: string, password: string) => string;
  // Field on the JSON response that holds the account login.
  loginField: string;
}

const PROVIDERS: Record<CredentialProvider, ProviderConfig> = {
  github: {
    host: "github.com",
    userApi: "https://api.github.com/user",
    authHeader: (_u, p) => `Bearer ${p}`,
    loginField: "login",
  },
  bitbucket: {
    host: "bitbucket.org",
    userApi: "https://api.bitbucket.org/2.0/user",
    authHeader: (u, p) => `Basic ${btoa(`${u}:${p}`)}`,
    loginField: "username",
  },
  gitlab: {
    host: "gitlab.com",
    userApi: "https://gitlab.com/api/v4/user",
    // GitLab uses a header rather than Authorization; passed through below.
    authHeader: (_u, p) => p,
    loginField: "username",
  },
};

const PROVIDER_LABEL: Record<CredentialProvider, string> = {
  github: "GitHub",
  bitbucket: "Bitbucket",
  gitlab: "GitLab",
};

export interface CredentialStatus {
  provider: CredentialProvider;
  connected: boolean;
  username?: string;
}

export interface GitCredentialsOptions {
  shell?: Shell;
  fetchFn?: typeof fetch;
}

export class GitCredentials {
  private shell: Shell;
  private fetchFn: typeof fetch;

  constructor(opts: GitCredentialsOptions = {}) {
    this.shell = opts.shell ?? defaultShell;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  private config(provider: CredentialProvider): ProviderConfig {
    const cfg = PROVIDERS[provider];
    if (!cfg) throw new Error(`unsupported provider: ${provider}`);
    return cfg;
  }

  /** Whether git's credential helper already holds an HTTPS credential for the host. */
  async status(provider: CredentialProvider): Promise<CredentialStatus> {
    const { host } = this.config(provider);
    const { stdout } = await this.shell.run(
      ["git", "credential", "fill"],
      undefined,
      `protocol=https\nhost=${host}\n\n`
    );
    const fields = GitCredentials.parseFields(stdout);
    const connected = fields.password !== undefined && fields.password !== "";
    return { provider, connected, username: connected ? fields.username : undefined };
  }

  /**
   * Validate the credential against the provider, then store it via
   * `git credential approve`. Returns the real account login on success.
   */
  async connect(params: {
    provider: CredentialProvider;
    username: string;
    password: string;
  }): Promise<{ username: string }> {
    const { provider, username, password } = params;
    if (!username.trim() || !password) {
      throw new Error("username and app password are required");
    }
    const login = await this.validate(provider, username, password);

    const { host } = this.config(provider);
    const { exitCode, stderr } = await this.shell.run(
      ["git", "credential", "approve"],
      undefined,
      `protocol=https\nhost=${host}\nusername=${username}\npassword=${password}\n\n`
    );
    if (exitCode !== 0) {
      throw new Error(stderr.trim() || "git credential approve failed");
    }
    return { username: login };
  }

  /** Erase the stored HTTPS credential for the host from git's credential helper. */
  async disconnect(params: {
    provider: CredentialProvider;
    username?: string;
  }): Promise<{ ok: true }> {
    const { host } = this.config(params.provider);
    let input = `protocol=https\nhost=${host}\n`;
    if (params.username) input += `username=${params.username}\n`;
    input += "\n";
    await this.shell.run(["git", "credential", "reject"], undefined, input);
    return { ok: true };
  }

  private async validate(
    provider: CredentialProvider,
    username: string,
    password: string
  ): Promise<string> {
    const cfg = this.config(provider);
    const headers: Record<string, string> = {
      "User-Agent": "Maverick",
      Accept: "application/json",
    };
    if (provider === "gitlab") headers["PRIVATE-TOKEN"] = cfg.authHeader(username, password);
    else headers.Authorization = cfg.authHeader(username, password);

    let res: Response;
    try {
      res = await this.fetchFn(cfg.userApi, { headers });
    } catch (e) {
      throw new Error(
        `could not reach ${PROVIDER_LABEL[provider]} (${e instanceof Error ? e.message : "network error"})`
      );
    }
    if (!res.ok) {
      throw new Error(
        `${PROVIDER_LABEL[provider]} rejected the credentials (HTTP ${res.status})`
      );
    }
    const body = (await res.json()) as Record<string, unknown>;
    const login = body[cfg.loginField];
    return typeof login === "string" && login ? login : username;
  }

  // Parse `git credential`'s key=value lines into a map. Only the keys we need
  // are read; the password value is consumed here and never propagated.
  static parseFields(output: string): { username?: string; password?: string } {
    const fields: { username?: string; password?: string } = {};
    for (const line of output.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      if (key === "username") fields.username = value;
      else if (key === "password") fields.password = value;
    }
    return fields;
  }
}
