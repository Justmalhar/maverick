# maverick-hostd

The **Maverick Host** daemon — a headless companion server that hosts and multiplexes
PTY sessions on a Mac and serves the MaverickProtocol over WebSocket with Noise-XX
pairing. It is the standalone, Tauri-free counterpart to the companion server embedded
in the Maverick ADE desktop app: the iOS app ("Maverick Terminal") is a direct client of
this daemon. There is **no hosted infrastructure** — the daemon runs on the user's own
machine, and coding agents run as local CLIs reading the user's own configs.

This crate is a thin binary over `maverick-core` (`pty` + `remote`). It links **no Tauri**
(`cargo tree -p maverick-hostd | grep -c '^tauri'` → `0`).

## Build

```bash
# from src-tauri/
cargo build -p maverick-hostd            # debug
cargo build -p maverick-hostd --release  # release → target/release/maverick-hostd
```

## Run

```bash
RUST_LOG=info ./target/debug/maverick-hostd [--port <PORT>] [--data-dir <DIR>] [--pair]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--port` | `8765` | TCP port to bind. `0` lets the OS pick a free port (read it from the startup log). |
| `--data-dir` | `${XDG_DATA_HOME or ~/Library/Application Support}/maverick` | Root for the security context (see layout below). |
| `--pair` | off | Mint a one-time pairing ticket, print its `maverick://pair/v1?…` payload to stdout, then keep serving. Exits non-zero if pairing fails. |

On start it logs the bound listener, e.g.:

```
maverick-hostd listening: RemoteStatus { enabled: true, running: true, port: Some(8765),
                                         lan_exposed: false, paired_devices: 0 }
```

Stop with Ctrl-C (it logs the post-stop status and exits cleanly).

## Data-dir layout

The security context is rooted at `<data_dir>/companion/`:

- `identity.key` — the desktop's persistent X25519 static identity (mode 0600, owner-only),
  generated once on the first `--pair` / `start`.
- `devices.json` — the TOFU store of paired devices (pinned static keys + names).

## Bind rule (security invariant)

The listener binds **loopback `127.0.0.1` only** until the server is **enabled AND at least
one device is paired** — at which point it widens to the LAN wildcard `0.0.0.0` and
advertises `_maverick._tcp` over mDNS. An enabled-but-unpaired server never reaches off-box.
Loopback peers are trusted (served plaintext); every non-loopback peer must complete the
Noise-XX pairing handshake (rejected with WS close `4401` otherwise).

## Pairing flow

1. Run with `--pair`. Copy the printed `PAIR: maverick://pair/v1?k=…&e=…&t=…&r=…&n=…&f=…`
   payload (the QR a client scans). The pairing token is single-use and expires in ~120 s.
2. A client (the iOS app, or a Noise-XX initiator) completes the XX handshake against the
   daemon. The client's static key is pinned TOFU into `devices.json`; a changed key for a
   known device id is rejected (`TofuMismatch`).
3. Confirm out-of-band via the 30-digit safety number if desired.
4. With ≥1 device paired and the server enabled, a subsequent run binds the LAN and is
   discoverable via mDNS (`dns-sd -B _maverick._tcp` on macOS).

### Connectivity beyond the LAN

Per the product design, remote reach is **BYO-Tailscale**: run the daemon on a machine in
your tailnet and connect from the phone over the tailnet IP (the daemon binds the tailnet
interface like any other). No relay is operated by Maverick.

## Tests

```bash
# from src-tauri/
cargo test -p maverick-hostd --test loopback   # real-socket WS round-trip against a real PTY
cargo test --workspace                          # full suite (maverick-core + desktop + hostd)
```

## Scope (M0)

This M0 daemon delivers: secure pairing, terminal sessions over WebSocket, and the
agent-runner surface inherited from `maverick-core`. Deferred to later milestones:
LaunchAgent/`SMAppService` packaging + a menu-bar host UI (M7), real Bun-sidecar wiring for
file/git helpers (post-M0; `NoopSidecar` returns a clear error for those today), and
session survival across daemon restart (spec §8).
