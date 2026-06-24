# Connect Git Hosts (GitHub + Bitbucket) — Design

*2026-06-24*

## Problem

The source-control panel (`SourceControlView`, the right-corner PR/commit/push
panel) runs the user's system `git` against whatever `origin` remote a repo has.
Commit is local; push/pull/PR already target Bitbucket when the remote is a
Bitbucket URL. The gap is **authentication**: pushing to Bitbucket (or GitHub
over HTTPS) fails when git has no stored credentials, and there is no in-app way
to set them up. Users asked to "connect Bitbucket and GitHub for committing."

## Constraint

CLAUDE.md rule 5: Maverick never stores credentials. So we do not persist the
secret in Maverick's SQLite/config. Instead we hand it to **git's own credential
helper** (Git Credential Manager → Windows Credential Manager), exactly how the
AI backends read their own CLI config. After that, every `git push`/`pull`/PR
authenticates automatically with no further involvement from Maverick.

## Mechanism (sidecar `GitCredentials`)

Host-agnostic, driven by git's credential protocol and each provider's user API.
Both `shell` and `fetch` are injected for testability.

- **Validate** — before storing, confirm the token actually works by calling the
  provider's authenticated user endpoint, returning the real login:
  - GitHub: `GET https://api.github.com/user`, `Authorization: Bearer <token>`
  - Bitbucket: `GET https://api.bitbucket.org/2.0/user`, Basic `user:app_password`
  - GitLab: `GET https://gitlab.com/api/v4/user`, `PRIVATE-TOKEN: <token>`
  A non-2xx throws an actionable error (`<Provider> rejected the credentials
  (HTTP 401)`) — the secret never appears in the message or logs.
- **Connect** — after a successful validation, pipe
  `protocol=https\nhost=<host>\nusername=<u>\npassword=<token>\n\n` into
  `git credential approve` (secret via **stdin**, never argv).
- **Status** — pipe `protocol=https\nhost=<host>\n\n` into `git credential fill`;
  the hardened env (`GCM_INTERACTIVE=Never`, `GIT_TERMINAL_PROMPT=0`) keeps it
  silent. Connected ⇔ output contains a `password=` line; the `username=` line is
  surfaced, the password is never returned.
- **Disconnect** — pipe the same descriptor into `git credential reject`.

Hosts: `github.com`, `bitbucket.org`, `gitlab.com`.

## IPC / commands

- RPC: `git.credential_status` `{provider}`, `git.credential_connect`
  `{provider, username, password}` → `{username}`, `git.credential_disconnect`
  `{provider, username?}`.
- Tauri commands `git_credential_status|connect|disconnect` forward to the
  sidecar (`request_with_timeout`, 30s — the connect path makes one HTTP call).
- `tauri.ts` wrappers + `ipc.ts` types (`CredentialProvider`, `CredentialStatus`).

## UX (the SCM panel)

- A provider/account button in the `SourceControlView` header showing the
  detected remote's provider and connection state ("Bitbucket · Connect" /
  "Bitbucket · Connected").
- A `ConnectHostDialog`: provider picker (defaults to the remote's provider),
  username + app-password fields, a "Create an app password ↗" link to the
  provider's token settings page, Connect, and Disconnect when already connected.
- The existing `GitError{kind:"auth"}` surfaced on push/PR gains a "Connect
  <Provider>" shortcut that opens the dialog.

## Testing

- `sidecar/git-credentials.test.ts`: correct stdin payloads to
  approve/fill/reject; status parsing (connected/username, password never
  returned); validation success/failure per provider with a mocked fetch; secret
  absent from thrown errors.
- `ConnectHostDialog.test.tsx` + `SourceControlView.test.tsx`: dialog flow and
  panel wiring with mocked `invoke`.

## Out of scope (v1)

OAuth browser flow, self-hosted/enterprise custom hosts, per-repo credential
scoping. The host-agnostic mechanism leaves room for all three later.
