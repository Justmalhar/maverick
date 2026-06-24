import { describe, test, expect } from "bun:test";
import { GitCredentials } from "./git-credentials";
import type { Shell } from "./types";

interface Call {
  cmd: string[];
  stdin?: string;
}

function fakeShell(result: { stdout?: string; stderr?: string; exitCode?: number }): {
  shell: Shell;
  calls: Call[];
} {
  const calls: Call[] = [];
  const shell: Shell = {
    text: async () => "",
    run: async (cmd, _cwd, stdin) => {
      calls.push({ cmd, stdin });
      return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.exitCode ?? 0 };
    },
  };
  return { shell, calls };
}

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;
}

describe("GitCredentials.status", () => {
  test("reports connected and the username when fill returns a password", async () => {
    const { shell, calls } = fakeShell({
      stdout: "protocol=https\nhost=bitbucket.org\nusername=alice\npassword=secret\n",
    });
    const status = await new GitCredentials({ shell }).status("bitbucket");
    expect(status).toEqual({ provider: "bitbucket", connected: true, username: "alice" });
    expect(calls[0].cmd).toEqual(["git", "credential", "fill"]);
    expect(calls[0].stdin).toBe("protocol=https\nhost=bitbucket.org\n\n");
  });

  test("reports not connected when fill returns no password", async () => {
    const { shell } = fakeShell({ stdout: "protocol=https\nhost=github.com\n" });
    const status = await new GitCredentials({ shell }).status("github");
    expect(status.connected).toBe(false);
    expect(status.username).toBeUndefined();
  });
});

describe("GitCredentials.connect", () => {
  test("validates then stores the credential and returns the API login", async () => {
    const { shell, calls } = fakeShell({ exitCode: 0 });
    const creds = new GitCredentials({ shell, fetchFn: fakeFetch(200, { login: "octocat" }) });
    const res = await creds.connect({ provider: "github", username: "ignored", password: "ghp_tok" });
    expect(res).toEqual({ username: "octocat" });
    const approve = calls.find((c) => c.cmd.join(" ") === "git credential approve");
    expect(approve?.stdin).toContain("host=github.com");
    expect(approve?.stdin).toContain("password=ghp_tok");
  });

  test("throws (without leaking the secret) when the provider rejects the token", async () => {
    const { shell, calls } = fakeShell({ exitCode: 0 });
    const creds = new GitCredentials({ shell, fetchFn: fakeFetch(401, {}) });
    let err: unknown;
    try {
      await creds.connect({ provider: "bitbucket", username: "alice", password: "super-secret" });
    } catch (e) {
      err = e;
    }
    expect(String(err)).toContain("HTTP 401");
    expect(String(err)).not.toContain("super-secret");
    // A failed validation must NOT store anything.
    expect(calls.some((c) => c.cmd.includes("approve"))).toBe(false);
  });

  test("rejects empty input before any network or shell call", async () => {
    const { shell, calls } = fakeShell({ exitCode: 0 });
    const creds = new GitCredentials({ shell, fetchFn: fakeFetch(200, {}) });
    await expect(creds.connect({ provider: "github", username: "", password: "" })).rejects.toThrow();
    expect(calls.length).toBe(0);
  });
});

describe("GitCredentials.disconnect", () => {
  test("rejects the stored credential, scoped by host and username", async () => {
    const { shell, calls } = fakeShell({ exitCode: 0 });
    await new GitCredentials({ shell }).disconnect({ provider: "gitlab", username: "alice" });
    expect(calls[0].cmd).toEqual(["git", "credential", "reject"]);
    expect(calls[0].stdin).toBe("protocol=https\nhost=gitlab.com\nusername=alice\n\n");
  });
});

describe("GitCredentials.parseFields", () => {
  test("extracts username and password, ignoring other keys", () => {
    const fields = GitCredentials.parseFields("protocol=https\nhost=x\nusername=u\npassword=p\n");
    expect(fields).toEqual({ username: "u", password: "p" });
  });
});
