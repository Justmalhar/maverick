import { describe, test, expect } from "bun:test";
import { parseRemoteUrl, prWebUrl } from "./git-provider";

describe("parseRemoteUrl", () => {
  test("scp-style GitHub SSH", () => {
    const info = parseRemoteUrl("git@github.com:justmalhar/maverick.git");
    expect(info).toEqual({
      provider: "github",
      host: "github.com",
      owner: "justmalhar",
      repo: "maverick",
      webUrl: "https://github.com/justmalhar/maverick",
      remoteUrl: "git@github.com:justmalhar/maverick.git",
    });
  });

  test("https Bitbucket", () => {
    const info = parseRemoteUrl("https://user@bitbucket.org/team/repo.git");
    expect(info?.provider).toBe("bitbucket");
    expect(info?.owner).toBe("team");
    expect(info?.repo).toBe("repo");
    expect(info?.webUrl).toBe("https://bitbucket.org/team/repo");
  });

  test("ssh:// GitLab with port", () => {
    const info = parseRemoteUrl("ssh://git@gitlab.com:2222/group/sub/repo.git");
    expect(info?.provider).toBe("gitlab");
    expect(info?.host).toBe("gitlab.com");
    expect(info?.owner).toBe("group/sub");
    expect(info?.repo).toBe("repo");
  });

  test("self-hosted gitlab host detection", () => {
    expect(parseRemoteUrl("https://gitlab.mycorp.dev/o/r.git")?.provider).toBe("gitlab");
  });

  test("unknown host", () => {
    expect(parseRemoteUrl("git@git.internal.corp:o/r.git")?.provider).toBe("unknown");
  });

  test("no .git suffix is fine", () => {
    expect(parseRemoteUrl("https://github.com/o/r")?.repo).toBe("r");
  });

  test("rejects empty and malformed strings", () => {
    expect(parseRemoteUrl("")).toBeNull();
    expect(parseRemoteUrl("   ")).toBeNull();
    expect(parseRemoteUrl("not-a-url")).toBeNull();
    expect(parseRemoteUrl("https://github.com/only-owner")).toBeNull();
  });
});

describe("prWebUrl", () => {
  const gh = parseRemoteUrl("git@github.com:o/r.git")!;
  const bb = parseRemoteUrl("git@bitbucket.org:o/r.git")!;
  const gl = parseRemoteUrl("https://gitlab.com/o/r.git")!;

  test("github compare URL with default base", () => {
    expect(prWebUrl(gh, "feat")).toBe("https://github.com/o/r/compare/main...feat?expand=1");
  });

  test("github compare URL with explicit base", () => {
    expect(prWebUrl(gh, "feat", "develop")).toBe(
      "https://github.com/o/r/compare/develop...feat?expand=1"
    );
  });

  test("bitbucket new-PR URL with and without dest", () => {
    expect(prWebUrl(bb, "feat")).toBe("https://bitbucket.org/o/r/pull-requests/new?source=feat");
    expect(prWebUrl(bb, "feat", "main")).toBe(
      "https://bitbucket.org/o/r/pull-requests/new?source=feat&dest=main"
    );
  });

  test("gitlab new-MR URL with and without target", () => {
    expect(prWebUrl(gl, "feat")).toBe(
      "https://gitlab.com/o/r/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat"
    );
    expect(prWebUrl(gl, "feat", "main")).toBe(
      "https://gitlab.com/o/r/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat&merge_request%5Btarget_branch%5D=main"
    );
  });
});
