import { describe, it, expect, afterEach, vi } from "vitest";
import { appVersion, appCommit, versionLabel } from "./build-info";

describe("build-info", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to sentinels when build defines are absent", () => {
    // Under vitest the Vite `define` substitution does not run, so the env
    // values are undefined and the ?? fallbacks take over.
    expect(appVersion()).toBe("0.0.0");
    expect(appCommit()).toBe("dev");
    expect(versionLabel()).toBe("Maverick 0.0.0 (dev)");
  });

  it("uses injected build-time version and commit when present", () => {
    vi.stubEnv("VITE_APP_VERSION", "1.2.3");
    vi.stubEnv("VITE_APP_COMMIT", "abc1234");
    expect(appVersion()).toBe("1.2.3");
    expect(appCommit()).toBe("abc1234");
    expect(versionLabel()).toBe("Maverick 1.2.3 (abc1234)");
  });
});
