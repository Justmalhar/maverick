# Maverick — Master Plan (v0.1 → cross-platform companion)

> Synthesized 2026-05-31 from a deep multi-agent audit of Maverick, the `crynta/terax-ai`
> reference, and the `maverick-app` iOS companion. This is the authoritative roadmap.
> Legend: effort **S/M/L/XL**; priority **P0** (blocks trust) → **P3** (polish).

---

## 0. Locked Decisions (ADRs)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| **ADR-1** | Core architecture vs. 7-8 MB goal | **Incremental shift to Rust.** Keep the Bun sidecar working now; write all new perf-critical code in Rust; migrate sidecar logic (git/config/skills/MCP/SQLite) into Rust module-by-module, shedding Bun over time. | terax hits 7-8 MB because it is a **pure Rust core + web UI, no sidecar**. A bundled Bun runtime is tens of MB — incompatible with the size goal. Incremental keeps the tree green while converging on terax's size+speed. |
| **ADR-2** | PTY + companion WS server location | **Rust authority + Rust WS server** (`axum`/`tokio-tungstenite`). One bounded ring buffer serves both desktop renderer re-attach and phone scrollback replay. | PTYs already live in Rust (`portable-pty`) because **node-pty fails under Bun**. terax also keeps PTYs in Rust. Avoids the node-pty risk and the Bun dependency entirely. |
| **ADR-3** | Client strategy | **Switch to React Native now** — one codebase for iOS/Android/web on the same `MaverickProtocol`. Keep the working Swift app as the protocol-conformance reference during the RN build. | Long-term goal: *laptop = server, anything = client*. RN gives cross-platform + web reach. The Swift app validated the protocol end-to-end. |
| **ADR-4** | Execution order | **Safe v0.1 P0 desktop fixes first**, each merged green + fully tested, before bigger architectural pieces. | "Nothing broken when you stop." Earn trust by making the *claimed-done* features actually work before large migrations. |

---

## 1. Reality vs. Perception

The foundations believed "missing" mostly **exist** — the failures are last-mile wiring:

1. **Terminal Mode (`⌘T`/SplitGrid) is dead.** Panes hardcode `ptyId: workspace.id`, which never matches a real Rust-minted `pty_N` id → no output, keystrokes rejected (`TerminalView.tsx:16-18,37-42` vs `usePty.ts:18`). *AgentTerminal + BottomTerminal work correctly.* This is the root of "terminal not implemented."
2. **Git panel writes all throw "command not found."** Read paths work; 9 mutating commands (`git_checkout`, `git_blame`, `git_cherry_pick`, `git_stash_apply/pop/drop`, `git_conflicts`, `git_resolve_conflict`) are **registered nowhere** in `lib.rs` (only 5 git commands exist). Hunk staging silently no-ops (no stdin pipe to `git apply`).
3. **Browser webview is real but never run live** — all 18 tests mock `invoke()`; it also unmounts+reloads on every tab switch.
4. **The shell is half-mounted.** `StatusBar`, `ActivityBar`, and the bottom `Panel` are built + tested but **never rendered** in `Workbench.tsx` — so `NotificationBell`, `CaffeinateToggle`, token/cost readout, backend dots are all invisible.
5. **Memory:** every xterm renderer kept alive (`display:none`), **zero PTY output batching**, **no `pty_kill` on destroy** (process + thread leak), scrollback hardcoded.

---

## 2. Target Architecture

```
┌─ Window (Tauri v2) ───────────────────────────────────────────────┐
│  WebView (React)            Rust Core (grows; Bun shrinks)         │
│  src/ ──invoke──▶  src-tauri/src/                                  │
│                      ├─ pty/        PTY authority + ring buffer    │
│                      ├─ remote/     companion WS server (axum)     │
│                      │              + iroh transport + pairing     │
│                      ├─ git/        (migrated from sidecar)        │
│                      ├─ fs/         watcher + tree + search        │
│                      └─ store/      SQLite (migrated)              │
│                            │ stdio JSON-RPC (legacy, shrinking)    │
│                            ▼                                       │
│                      Bun sidecar (transitional)                   │
└───────────────────────────────────────────────────────────────────┘
        ▲ Tier1 LAN/mDNS  ▲ Tier3 iroh P2P  ▲ Tier4 CF relay
        └──────────── MaverickProtocol over Noise ────────────┐
                                                       React Native + web clients
```

**Invariant:** React only ever calls Tauri commands. The companion WS is a **separate ingress** from the stdio JSON-RPC channel — remote frames are capability-scoped + auth-gated; local stdio stays fully trusted.

---

## 3. Desktop Workstreams

### P0 — v0.1 "make the claimed-done actually work" + perf foundations

- **P0-A · Terminal Mode PTY per leaf** (M) — spawn a real PTY per `SplitNode` leaf, store the returned `pty_N` on the node (not `workspace.id`); per-leaf session map; route keystrokes to the focused leaf. *terax:* `useTerminalSession.ts` per-leaf Session decoupled from renderer.
- **P0-B · PTY lifecycle** (M) — `ptyKill` on workspace destroy/close (zero callers today), prune `agentPtyCache`/`ptyCache`, add `pty_close_all` on reload, ensure `Drop` kills the child. *terax:* `session.rs:52-62`, `mod.rs:164-184`.
- **P0-C · Rust reader batching** (L) — reader+flusher threads, **4 ms coalesce**, UTF-8 boundary carry, **DA-query filter** (DA1/DA2/DA3), raw-bytes Tauri `Channel`. *terax:* `session.rs:163-248`, `da_filter.rs`.
- **P0-D · Renderer pool + DormantRing** (XL) — global pool capped at **6 live xterm** instances behind `TerminalRegistry`; per-leaf **256 KiB DormantRing**; serialize scrollback (cap 5000) on release, replay on acquire; inactive editor releases the *renderer* but keeps the *session*. *terax:* `rendererPool.ts`, `dormantRing.ts`.
- **P0-E · Mount the shell** (M) — render `ActivityBar` + `StatusBar` + bottom `Panel` into `Workbench.tsx`; delete `PrimarySideBar`'s duplicated inline nav.
- **P0-F · Browser: verify live or gate** (M-L) — run in `tauri dev`; stop unmount-on-tab-switch (hide, don't close); harden the capture channel; fallback to terax's suspendable sandboxed iframe (`PreviewPane.tsx`) if `add_child` is flaky.

### P1 — v0.2 finish high-value partials

- **P1-A · Register 9 git commands + stdin pipe** (L) — implement+register `git_branch_list/checkout/blame/cherry_pick/stash_apply/pop/drop/conflicts/resolve_conflict`; add `stdin` to `Shell.run` so `git apply --cached -` works; `--cached` diff for the staged pane. *terax:* `operations.rs`, `parser.rs` (porcelain=v2), `process.rs` (hardened env), `errors.rs`.
- **P1-B · Remote git ops + StatusBar indicator** (L) — wire `fetch/pull/push` (methods exist, no RPC/command); ahead/behind `↑N ↓M` indicator via a `useSourceControl`-style hook (throttled auto-fetch). Auth surfaces a typed `AuthRequired` → terminal (no key storage).
- **P1-C · Real token/cost + RPC contract fixes** (L) — fix `skills.run`/`automation.run`/`mcp.start` `workspaceId`→`{projectPath,worktreePath}` Zod mismatches; feed `context.record` from the live `AgentTerminal` path; decide `AgentView`'s fate (dead code today).
- **P1-D · MCP health/logs + automation streaming** (L) — poll `MCPManager.health()`, bounded ring-buffer log capture + `mcp_logs(since_offset)` viewer, auto-restart; emit `automation:step`; persist automations to `maverick.yaml`; bundled MCP presets.
- **P1-E · Worktree lifecycle correctness** (M) — absolute/symmetric paths in create/destroy/copy; reorder destroy (remove worktree + prune *before* DB row, kill PTYs first); surface setup-script failures. *terax:* `utils.rs resolve_within_repo`.

### P2 — v0.3 polish

- **P2-A · Explorer + previewers + coalesced fs-watcher** (L) — `FilesView` click→`FilePreviewPanel`; debounced single `fs:changed` event, lazy one-level tree, `SKIP_DIRS`; gitignore-aware search/grep (`ignore` crate, scan budget). *terax:* `fs/watch.rs`, `fs/tree.rs`, `fs/search.rs`, `useFileTree.ts`.
- **P2-B · Focus-aware notifications + agent-status pill** (L) — port `route.ts`/`useWindowFocus` policy; OSC byte state-machine (`agent_detect.rs`) → per-workspace status pill; install hooks into each backend's own config.

### P3 — v0.4+ release

- **P3-A · UX polish** (S-M) — WorkspaceBadges, `<900px` icon-collapse, Environment settings (global env into PTYs), save-layout-as-preset.
- **P3-B · Distribution** (XL) — `tauri-plugin-updater` (signing key + endpoints), real `Check now`, hardened `getmaverick.sh` with checksum/signature.

---

## 4. Memory & Performance Budget (the "10+ terminals" guarantee)

| Lever | Budget | Source pattern |
|---|---|---|
| Live xterm renderers | **6** (pool, RSS scales with pool not tab count) | terax `rendererPool.ts` K=5 |
| Per-leaf dormant ring | **256 KiB** byte ring + overflow notice | terax `dormantRing.ts` |
| Server PTY hot ring | **1 MiB** raw bytes/session (~6-12k lines) | MaverickAgent `CircularBuffer` (1,048,576) |
| Replay-on-attach slice | **256 KiB** tail (base64 ~340 KiB, < 16 MiB WS frame) | — |
| Rust output coalesce | **4 ms** flusher window; 4 MiB backpressure drop + `ESC c` | terax `session.rs` |
| Resize debounce | fit at **8 ms**, PTY ioctl at **256 ms** only if changed | terax `rendererPool.ts` |
| Idle RSS, 10 terminals | **≤ 200 MB** (CLAUDE.md) | — |

---

## 5. Companion Server (replace MaverickAgent with the IDE)

`MaverickProtocol` is the contract; the **Rust core** becomes the server (ADR-2); the iOS/RN app is the client. Single-WebSocket, JSON-framed tagged unions (snake_case `type`, ISO8601 dates, base64 binary, UUID strings).

**New components (Rust unless noted):**
- `remote/ws-server` — `axum`/`tokio-tungstenite` listener; per-socket `ConnectionManager`; 16 MB max frame; multi-client fan-out (one PTY, N viewports).
- `remote/protocol` — port every `ClientMessage`/`ServerMessage` + `AgentEvent` union + enums (`AgentProvider`, `ToolKind` bare-string with `custom()` catch-all). Mirror in `src/lib/ipc.ts`.
- `pty` ring buffer + replay-on-attach (serves desktop *and* phone).
- `AgentHost` + 5 adapters (Claude rich-stream + hooks, Codex `--json`, OpenCode/Antigravity/Hermes heuristic) → structured `AgentEvent`s. **XL, highest-fidelity-risk.**
- `HookServer` (localhost:7789) + `HookConfigWriter` (idempotent merge into `~/.claude/settings.json`, 13 events; **blocking PermissionRequest ≤30s** → phone allow/deny → resume; auto-deny on timeout).
- `PairingService` + token gate (the reference's `?token` is a **no-op** — a PTY-write socket unauthenticated = RCE; **auth lands before any wide exposure**).
- aux services: git status v2 / diff (256 KB cap), directory listing (LRU 500), project indexer (chunked), upload store (5 MB cap).

**Deprecation:** staged cutover — validate the IDE server against the *unmodified* Swift app (byte-for-byte parity = strongest signal), then stop launching the menu-bar daemon, keep MaverickAgent archived one release as fallback.

---

## 6. Connectivity, Pairing, Handoff, History

### 6.1 Transport tiers (auto-selected, first success wins; Noise channel survives a tier change)
1. **LAN direct** ($0, <1 ms) — Rust advertises `_maverick._tcp` (`mdns-sd`, <300 KB); client discovers via `NWBrowser`. Plain `ws://` OK (Noise wraps payload).
2. **LAN cached IP** — last-known IP:port from QR/cache if mDNS is blocked.
3. **Iroh P2P** (remote default, the **Tailscale replacement**) — `iroh` crate (~3-5 MB) in the Rust core; dial ed25519 `NodeId`; ~90% direct hole-punch, rest auto-relay via **n0's free zero-knowledge DERP**. Client uses `IrohLib`/`iroh-ffi`. No account, no third app.
4. **Cloudflare Durable-Object relay** — zero-knowledge libsodium-sealed routing on :443; free at single-user scale; always reachable.
5. **Tailscale (optional, not bundled)** — user-selectable "Remote (Tailscale)" for power users on their own tailnet.

**Infra cost: $0** baseline and for the overwhelming majority of sessions. Optional ~$4-6/mo VPS only if self-hosting a DERP relay for SLA.

### 6.2 QR pairing (WhatsApp/Signal "companion device", TOFU, no account)
- Desktop holds a long-lived Ed25519+X25519 static identity (macOS Keychain). "Pair" mints an ephemeral session (128-bit token `PT`, ephemeral X25519, 60-120 s expiry) → QR.
- QR (`maverick://pair/v1?k&e&t&r&n&f`, <300 B) carries the desktop **static public key** (pinned out-of-band = MITM kill switch), `PT`, rendezvous hints. **Never** a private key or bearer token.
- Phone runs **Noise_XX_25519_ChaChaPoly_SHA256**; aborts unless desk static == pinned key; desktop verifies single-use `PT` (constant-time, rate-limited) + **mandatory local confirmation tap**.
- `split()` → transport-independent session keys (LAN/iroh/relay all carry the same E2E Noise). Reconnect via **Noise_KK** (2-message). Revoke = delete pinned row; "revoke all" rotates desk static.
- Libs: Bun `@noble/ciphers`+`@noble/curves`+`@noble/hashes`, `qrcode`; Rust `iroh`+keychain; Swift `CryptoKit` (Curve25519/HKDF-SHA256/ChaChaPoly) + `VisionKit` scanner. HKDF/ChaCha interop is RFC-exact across `@noble` ↔ CryptoKit.

### 6.3 Handoff (server-as-source-of-truth, *not* state migration)
- The server owns the single PTY + SQLite; clients are thin attaching viewports (broadcast-write + server-echo, screens converge). **One PTY, two viewports** — never per-client PTYs.
- **Keystone:** Maverick does **not** replicate the LLM's memory. Each CLI persists its own conversation as JSONL keyed by a native session UUID; Maverick stores only that UUID + a `resume_command_template` (no model context, no keys).
  - **Warm** (IDE running): `session.attach` → `SerializeAddon` snapshot + delta since cursor → live-tail. Zero restart.
  - **Cold** (PTY died): `session.resume` re-spawns `claude --resume <uuid>` in stored cwd; shell-fallback replays read-only + warns context not auto-restored.
- **cols/rows arbitration:** PTY = `MIN(cols)×MIN(rows)` (small client wins, big letterboxes); policy `smallest|largest|latest|manual`; `SIGWINCH` + `pty.resized` broadcast debounced 150 ms.
- **Persists to disk** (`~/Library/Application Support/maverick`): append-only `pty.log` + serialize snapshots; SQLite `messages` (stream-json parsed); new `pty_sessions` table (status `live|detached|dead|resumable`, `agent_native_session_uuid`, `resume_command_template`, `last_seq`, cols/rows…); monotonic `last_seq` cursor.

### 6.4 History (three-tier, none unbounded)
| Layer | Cap | Notes |
|---|---|---|
| Server RAM ring (terminal) | **1 MiB**/session | offset + dropped counter → client detects gaps |
| Replay slice on attach | **256 KiB** tail | base64 < 16 MiB WS frame |
| Server RAM (chat) | last **100 events** (~40 KB) | older paged from SQLite |
| Desktop SQLite (chat) | **50,000 events** or 90 days/session; keyset (`seq`) paging (replace O(n) OFFSET); 2 GB watchdog | |
| Desktop disk (scrollback) | append-only **gzip** log, 64 MiB compressed/session (~400-600 MB logical), 1 GiB global LRU | |
| **iOS SwiftTerm scrollback** | **4,000 lines** (~8-10 MB); shrink to 1,000 on memory pressure | history never lost (it's on desktop) |
| iOS concurrent renderers | **1 foreground**; background sessions drop their grid (~8-10 MB reclaimed) | |
| Agent-chat paging | **50 events/page**, sliding window max 5 pages (250 resident) | bottom-anchored, leading-edge prefetch |

### 6.5 Protocol extensions (add to `MaverickProtocol`)
`session.listResumable`, `session.attach{sinceCursor,cols,rows,historyLines}`, `session.detach`, `session.resume`, `history.page{beforeCursor,maxBytes}`, `loadAgentHistory{before,limit}` (keyset, cap 200), `loadTerminalHistory{beforeOffset,maxBytes}` (cap 512 KiB, `dropped` flag); notifications gain `pty.data{seq}`, `pty.resized{reason}`, `session.attached/detached{clientCount}`, `session.statusChanged`.

---

## 7. React Native + Web Client (ADR-3)

- One RN codebase (iOS/Android) + RN-Web (or a thin React web client) on the **same `MaverickProtocol`** types (generate TS types once; share with the IDE's `ipc.ts`).
- Terminal: `xterm.js` in a WebView (RN) / native (web) — reuse the desktop renderer-pool discipline.
- Crypto: `react-native-libsodium` / WebCrypto; QR scan via `react-native-vision-camera`.
- iroh: `iroh-ffi` via a native module (RN) / Tier-1+Tier-4 only on web (no raw UDP in browser → web uses LAN-WSS or the CF relay).
- **Keep the Swift app** as the conformance reference until RN reaches feature parity; retire after.

---

## 8. Testing Strategy

- **Per CLAUDE.md:** 100% lines / 95% branches / 100% funcs+stmts. Every public function tested. CI-enforced.
- **Frontend:** Vitest + jsdom + Testing Library; MSW mocks `invoke()`.
- **Sidecar:** `bun test`.
- **Rust:** `cargo test` — add unit tests for `pty` ring buffer (overwrite-oldest at exact cap), DA-filter, coalescing, WS framing, Noise handshake, pairing token (single-use/expiry/rate-limit).
- **Protocol conformance:** round-trip encode/decode against captured Swift JSON fixtures for **every** `ClientMessage`/`ServerMessage`/`AgentEvent` case (the iOS `readLoop` uses `try?` — a wrong key silently drops the frame).
- **E2E:** Playwright golden-path nightly; add a 10-terminal RSS budget assertion and a Terminal-Mode spawn check.
- **Adapters:** per-provider `normalize()` tests against captured stream-JSON fixtures; pin tested CLI versions.

---

## 9. Milestones & Sequencing

- **M1 (v0.1, this session onward):** P0-E → P0-A+P0-B → P0-C → P0-D → P0-F. Land only when all P0 pass live in `tauri dev` (10-terminal RSS ≤ 200 MB).
- **M2 (v0.2):** P1-A+P1-B (shared git surface) → P1-C → P1-D+P1-E.
- **M3 — companion server:** protocol types → PTY ring buffer + tee → Rust WS server + read-mostly surfaces → AgentEvent pipeline + hooks → auth/pairing/iroh → cutover.
- **M4 — RN/web client** in parallel with M3 once the protocol is frozen.
- **M5 (v0.3/v0.4):** P2 + P3.

**Branches (per CLAUDE.md `cc-*` naming):** epic `cc-feature/v01-p0-foundations`; stacked `cc-fix/terminal-mode-pty`, `cc-fix/pty-lifecycle`, `cc-feature/rust-pty-coalesce`, `cc-feature/renderer-pool`, `cc-ui/mount-shell`, `cc-feature/browser-verify`. Companion epic `cc-feature/companion-ws-server` with stacked protocol/pty/ws/agent-events/auth branches. iOS/RN in `maverick-app` under `cc-feature/rn-client`.

---

## 10. Open Decisions (need owner input later)

1. Curve25519-in-Keychain (cross-platform parity) vs P-256 Secure-Enclave (hardware non-exportable) for the desktop static identity.
2. Does Maverick already configure Claude Code hooks? If so, `HookConfigWriter` must merge with the IDE's entries, not just the user's.
3. Do remote sessions map onto existing workspaces/`EditorGroup`s, or a parallel `SessionRegistry`? (Affects whether the phone can attach to terminals already open on the desktop.)
4. Self-host an iroh DERP relay (~$4-6/mo) for SLA, or rely on n0's free no-SLA relays?
5. RN-Web vs a dedicated React web client sharing the desktop component library.

---

*Pre-existing working-tree note: a large uncommitted diff (~3.2k lines, 115 files) was present before this plan. It must be reconciled (committed as a green checkpoint or evaluated) before P0 edits land on the same files — see session notes.*
