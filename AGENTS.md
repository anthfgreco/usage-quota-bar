# AGENTS.md - Usage Quota Bar

Zero-dependency VS Code status-bar extension displaying Claude Code & Codex subscription quota.

## Architecture Map

- `lib.js`: Pure functions only (zero external/vscode dependencies). Formatting, pace math, tooltip generation, parser logic. Must stay runnable under plain Node.
- `extension.js`: VS Code runtime glue. Status bar items, polling timer, HTTP requests, local auth readers, and Claude token auto-refresh.
- `test/*.test.js`: Offline test suites runnable directly via `node`.
- `docs/`.

## Key Commands

- Run all tests: `npm test`
- Run single test: `node test/<name>.test.js`
- Build package: `npm run build:vsix` (via `@vscode/vsce`) or `./build-vsix.sh` (bash/zip fallback)

## Hard Invariants

1. **Zero Runtime Dependencies**: `dependencies` in `package.json` must remain empty.
2. **Hover Stability Contract**: VS Code disposes open status-bar hovers whenever the `tooltip` string mutates (`vscode#128887`). Tooltip updates must avoid fluctuating live countdowns and only update when content changes.
3. **Purity Separation**: Never import `vscode` or Node filesystem/network APIs into `lib.js`. Keep all I/O and VS Code API usage isolated in `extension.js`.
4. **Auth Paths**: Reads runtime credentials locally from `~/.claude/.credentials.json` (or macOS Keychain) and `~/.codex/auth.json`. Never embed credentials or secrets.
