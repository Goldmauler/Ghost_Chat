# REZO — Team Messaging Inside Your Editor

> Send and receive team messages right inside your normal files. No sidebar, no panels, no context switching. Just your code and your team.

[![VS Code](https://img.shields.io/badge/VS%20Code-Extension-blue)](https://marketplace.visualstudio.com/items?itemName=rezo-dev.rezo)
[![Version](https://img.shields.io/badge/version-1.0.1-green)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## Zero Setup. Just Install and Go.

REZO works out of the box — no accounts, no configuration, no file paths.

1. Install the extension
2. Press `Ctrl+Shift+P` → **REZO: Create New Room**
3. Share the room code with your team (e.g. `REZO-7K9P`)
4. They install REZO and run **REZO: Join Room by Code**
5. Done — start sending messages

---

## How It Works

```
You select code → Ctrl+Shift+S → sent to room

Teammate presses Ctrl+Shift+V → history appears at their cursor as comments
```

No new windows. No sidebars. Everything stays inside your normal editor flow.

---

## Send a Message

1. **Select any text** in any file
2. Press **`Ctrl+Shift+S`** (Mac: `Cmd+Shift+S`)
3. The selected text, filename, and line number are sent to your active room

---

## Receive Messages

1. **Place your cursor** anywhere in any file
2. Press **`Ctrl+Shift+V`** (Mac: `Cmd+Shift+V`)
3. The full room history is inserted at your cursor as a comment block:

```
// ===== REZO HISTORY [Room: REZO-7K9P] =====
// [2024-01-15 14:30] alice (utils.ts:42): check this function
// [2024-01-15 14:31] bob (app.py:10): looks good, approved
// ===== END REZO HISTORY =====
```

4. Read it, then **manually delete the block** when done

REZO automatically uses the correct comment style for your language:

| Language | Comment Style |
|----------|--------------|
| TypeScript, JavaScript, Java, C, Go, Rust | `//` |
| Python, Ruby, Shell, YAML | `#` |
| HTML, XML, Markdown | `<!-- -->` |
| SQL, Lua, Haskell | `--` |

---

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| REZO: Create New Room | — | Generate a new room code like `REZO-7K9P` |
| REZO: Join Room by Code | — | Join a teammate's room |
| REZO: Leave Current Room | — | Disconnect from active room |
| REZO: Send Selected Text | `Ctrl+Shift+S` | Send selection to room |
| REZO: Receive History | `Ctrl+Shift+V` | Insert room history at cursor |
| REZO: Set Display Name | — | Change your sender name |

---

## Status Bar

The bottom-left status bar shows your active room:

- `💬 REZO: REZO-7K9P` — connected to a room
- `💬 REZO: No Room` — click to create a room

---

## Rooms

- Room codes are short and easy to share: `REZO-XXXX`
- Rooms **auto-delete after 35 minutes of inactivity** to keep storage clean
- If a room expires, just create a new one — takes 2 seconds
- The room code is your session — anyone with the code can join

---

## Offline Support

If you have no internet connection, REZO shows the last **50 cached messages** from your previous session. You'll see a warning toast: *"Network error. Using cached history."*

---

## Keybinding Conflicts

If `Ctrl+Shift+S` or `Ctrl+Shift+V` conflict with another extension:

1. Open Keyboard Shortcuts: `Ctrl+K` then `Ctrl+S`
2. Search for `rezo.sendMessage` or `rezo.receiveHistory`
3. Set your preferred keybinding

---

## Privacy

- All messages are stored in a shared Firebase Realtime Database
- REZO does not collect any personal data
- Messages are tied only to room codes — no accounts or logins
- Rooms auto-delete after 35 minutes of inactivity
- Do not share sensitive credentials or secrets in REZO rooms

---

## License

MIT — free to use, modify, and distribute.

---

## Contributing

Issues and PRs welcome. Keep patches small and focused.
