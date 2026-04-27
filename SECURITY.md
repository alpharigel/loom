# Security

Loom is a developer tool that runs an HTTP + WebSocket server giving its
client (the web UI, the desktop app, or the iOS app) full access to the host
machine: arbitrary terminal sessions, file read/write, git operations, and
optional Docker container control.

There is no built-in authentication. The trust model is **the network is
trusted**. Run Loom only in environments where that holds:

- **localhost only** (default) — bound to `127.0.0.1`, no other machine
  can reach it.
- **Your LAN** behind a trusted router, with `HOST=0.0.0.0` set explicitly
  by you.
- **A Tailscale tailnet**, where peer reachability is gated by Tailscale's
  device approval and ACLs.

## Do not do this

- **Do not expose Loom directly to the public internet.** Port-forwarding
  3000 from your home router, binding to `0.0.0.0` on a cloud VM with a
  public IP, or putting it behind a public reverse proxy without auth all
  give anyone on the internet remote code execution on the host.
- **Do not run Loom on a host that holds production secrets** unless those
  secrets are scoped to what you're comfortable any client of the server
  having access to. Loom passes through `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, and `GITHUB_TOKEN` to spawned shells; the server can
  also read any file the OS user can read.

## Reporting a vulnerability

Email security issues privately to the maintainer (see `LICENSE` /
`package.json` for contact). Please do not open a public GitHub issue for
anything that could let someone compromise a running Loom instance.

## Roadmap

A future release will add an opt-in auth token that the server generates
on first start and the clients prompt for once. Until then, treat Loom as
a "trusted network only" tool.
