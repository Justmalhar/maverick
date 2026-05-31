# Distribution & Auto-Update (P3-B)

Maverick ships `tauri-plugin-updater` for in-app updates. JSON config cannot
carry inline comments, so the placeholder values in `tauri.conf.json` →
`plugins.updater` are documented here. **The repository owner must replace both
before publishing a release.**

## TODO (tracked: task #24 "P3-B-follow-up: Distribution live-verification")

A real auto-update can only be verified end-to-end against a published, signed
release — that work is tracked as task **#24** (it needs secrets + a published
release and cannot run headlessly). The two placeholders below MUST be filled by
the owner; until then the in-app "Check now" button degrades gracefully (a 404 /
missing-config maps to "Updates are not configured for this build." rather than a
red error) and the CLI installer refuses to install unverified artifacts.

### 1. `plugins.updater.pubkey`

Currently a **throwaway placeholder minisign public key**. It is structurally
valid (the build compiles and the plugin loads), and it enforces signature
verification — but nobody holds the matching private key, so it will reject
every update until regenerated. It does NOT silently accept unsigned updates.

Generate the real keypair:

```sh
bunx @tauri-apps/cli signer generate -w ~/.tauri/maverick.key
```

- Paste the printed **public** key into `plugins.updater.pubkey`.
- Keep the **private** key secret. In CI, set:
  - `TAURI_SIGNING_PRIVATE_KEY` — the private key string (or its path).
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose (if any).

`bun run tauri:build` with those env vars set emits `*.sig` files and a
`latest.json` manifest (because `bundle.createUpdaterArtifacts` is `true`).

### 2. `plugins.updater.endpoints`

Currently `https://github.com/justmalhar/maverick/releases/latest/download/latest.json`
(a real owner, but the repo has no published release yet, so `check()` 404s and
the UI shows the graceful "not configured" state). Confirm the org/user is
correct before publishing. Tauri supports `{{target}}`, `{{arch}}`, and
`{{current_version}}` template variables if a more granular layout is needed.

## CLI installer (`getmaverick.sh`)

The installer downloads the release asset and verifies it against a companion
`<asset>.sha256` before declaring success, deleting the partial download on
mismatch. It fails clearly if the release, the asset, or the `.sha256` is absent
rather than blindly installing. **The release CI must therefore emit a
`<asset>.sha256` next to each asset** — the in-app updater's `.sig`/`latest.json`
minisign artifacts are NOT verifiable by the script (no embedded pubkey), so a
`latest.json`-only release is treated as unverifiable. Set `MAVERICK_REPO` to the
real release repo (defaults to `justmalhar/maverick`).
