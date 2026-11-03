# Contributing to Loreloom

Thanks for helping. Loreloom is a local novel-writing app for fantasy writers: a TypeScript monorepo using npm workspaces.

## Setup

You need Node 22 or newer.

```sh
git clone <your fork>
cd loreloom
npm install
```

## Running it

- `npm run dev` runs the server and the web app with live reload. Pass a book folder after `--`, for example `npm run dev -- ~/Writing/my-book`.
- `npm start -- <book-folder>` builds the web app and serves it on `http://127.0.0.1:4317`.
- `npm run mcp -- <book-folder>` runs the MCP server over stdio.

## Before you open a pull request

```sh
npm run typecheck
npm test
```

CI runs both on every push and pull request.

## Layout

- `packages/core`: the book format, reading and writing files, search, stats.
- `packages/server`: the local HTTP API, the file watcher and the AI helper bridge.
- `packages/web`: the browser UI.
- `packages/mcp`: the MCP server.
- `sample-book/`: the example book used by the "Try the sample" option.

## Ground rules

- The AI never writes into a chapter by itself. Only an explicit click on Insert, Replace or Apply changes chapter text.
- All file writes are atomic, and deletes move files to `.loreloom/trash/`.
- The server binds to `127.0.0.1` only.
- Never read, store or forward anything under `~/.claude`, or any Claude credentials.
- Do not put "Claude" or "Anthropic" in the product name, logo or package names. Saying in plain text that Loreloom "runs Claude Code" is fine.
- Never commit a real manuscript. The only book in the repo is `sample-book/`.
