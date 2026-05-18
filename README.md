# REZO

> Team messaging built directly into VS Code. No sidebar. No panels. Just your editor.

This repository contains the source code for **REZO** — a VS Code extension that lets developers send and receive team messages inside their normal files using simple keyboard shortcuts.

## Download

Get the latest build: [`rezo-1.0.1.vsix`](REZO/rezo-1.0.1.vsix)

Install it:
```bash
code --install-extension rezo-1.0.1.vsix
```

## Quick Start

1. Install the VSIX in VS Code
2. Press `Ctrl+Shift+P` → **REZO: Create New Room**
3. Share the room code (e.g. `REZO-7K9P`) with your team
4. They install REZO and run **REZO: Join Room by Code**

## How It Works

- Select text → `Ctrl+Shift+S` → sent to room
- Place cursor → `Ctrl+Shift+V` → history inserted as comments

Zero configuration. Works out of the box.

## Project Structure

```
REZO/
├── src/
│   ├── extension.ts      Main entry point
│   ├── firebase.ts       Firebase REST API (built-in config, no setup needed)
│   ├── roomManager.ts    Room create/join/leave/expiry
│   ├── messageStore.ts   Local cache + comment formatting
│   └── statusBar.ts      Status bar manager
├── package.json
└── README.md
```

## Build From Source

```bash
cd REZO
npm install
npm run compile
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

## Tech Stack

- TypeScript + VS Code Extension API
- Firebase Realtime Database (REST API via Node.js built-in `https`)
- Zero runtime dependencies

## License

MIT
