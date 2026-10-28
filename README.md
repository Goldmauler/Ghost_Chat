# REZO — End-to-End Encrypted Chat That Hides in Your Editor

> Chat with your team through a terminal that looks like an ordinary shell, or drop a note on any line as a native review thread. Every message is end-to-end encrypted. No sidebar, no chat bubbles, nothing that reads as "chatting" to someone glancing at your screen.

[![Version](https://img.shields.io/badge/version-3.0.1-green)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()

---

## What's new in 3.0

- **Terminal chat — hidden in plain sight.** Open **REZO: Open Chat** (`Ctrl+Alt+;`) and a terminal appears, disguised as `node` / `bash` / `python` / `powershell`. Type a message like a command, press Enter to send. Incoming messages scroll in like command output. To anyone watching, it's just terminal work. No more select-text-and-shortcut dance.
- **End-to-end encryption.** Messages, names, AI answers, and vault items are encrypted with AES-256-GCM on your machine. The room key lives only in the invite you share and in local secure storage — it never touches the server. The backend only ever holds ciphertext.
- **Invite-based rooms.** Room codes are now 80-bit unguessable IDs, and the invite carries the decryption key. Share it privately.
- **Panic key.** `Ctrl+Alt+0` instantly hides every REZO surface — closes the chat terminal and clears all threads.
- **Native comment threads** for pinning a discussion to a specific line, and **presence** + **git context**, all still here.

---

## Quick start

1. Install the extension
2. `Ctrl+Shift+P` → **REZO: Create New Room**
3. Click **Copy Invite** and send it to your team *privately* (it contains the decryption key)
4. They run **REZO: Join Room by Invite** and paste it
5. `Ctrl+Alt+;` to open the chat terminal — start typing

No account. No Firebase setup. AI is optional and uses **your own** free API key.

---

## The two ways to talk

**Terminal chat (primary).** A disguised terminal for free-flowing conversation. Set the disguise with `rezo.chatDisguise`. New messages appear even when it's not focused; the status bar tracks the unread count.

**Pinned threads (for code review).** Select code, `Ctrl+Shift+S`, add a note → it appears as a native comment thread on that exact line for teammates who open the file. Reply in-thread. Your source files are never modified.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+;` | Open / focus the chat terminal |
| `Ctrl+Alt+0` | **Panic** — hide all REZO surfaces instantly |
| `Ctrl+Shift+S` | Pin selection to a line thread |
| `Ctrl+Shift+Q` | Ask AI (answer inserted privately at cursor) |
| `Ctrl+Alt+B` | Save selection to your encrypted Vault |
| `Ctrl+Shift+B` | Open Vault |
| `Ctrl+Shift+H` | Show full chat history |

---

## Rooms & Invites

- Room ID: `REZO-` + 20 hex chars (80 bits — unguessable)
- The **invite** is `<room-id>~<key>`. It is a secret: whoever holds it can read the room. Share it over a trusted channel.
- Default expiry: **24 hours of inactivity** — configurable via `rezo.roomExpiry` (`5m` … `never`)
- **REZO: Copy Room Invite** re-copies the current room's invite anytime.

---

## AI Assistant

Bring your own free key (**REZO: Set AI Keys**) — Gemini, DeepSeek, or Groq. REZO ships **no** built-in AI key, so nothing is shared or abusable. If one provider is rate-limited, REZO falls back to the next key you've set.

Model ids are settings, so a provider retiring a model never breaks Ask AI: `rezo.geminiModel` (default `gemini-flash-latest`), `rezo.deepseekModel` (default `deepseek-chat`), `rezo.groqModel` (default `llama-3.1-8b-instant`).

Slash commands (prefix a selection, then `Ctrl+Shift+Q`):
- `/explain <code>` — plain English explanation
- `/test <code>` — generate unit tests
- `/refactor <code>` — cleaner, idiomatic version
- `/fix <code>` — find and fix bugs

---

## Vault — Personal Encrypted Storage

Save snippets to a private cloud vault keyed by an unguessable per-install ID and encrypted with a key only your machine holds. Persists forever (unlike rooms).

- `Ctrl+Alt+B` save selection
- `Ctrl+Shift+B` browse / insert / delete

---

## Privacy & Security

- **End-to-end encrypted** (AES-256-GCM). The Firebase backend stores only ciphertext plus routing metadata (timestamps, line numbers).
- The room key never leaves your machine except inside the invite you deliberately share.
- No AI keys are shipped — you supply your own, stored in VS Code SecretStorage.
- Deploy [`database.rules.json`](./database.rules.json) to your Firebase project (`firebase deploy --only database`) for defense-in-depth: it blocks enumerating `/rooms` and `/vaults` and only permits access to a specific, unguessable ID.

> Treat the invite like a password. Anyone you send it to can read the room.

---

## Built By

| Name | Role |
|------|------|
| **Vimal Harihar S K** | Lead Developer & Architect |
| **Arun N** | Core Developer |
| **Keshav S** | Core Developer |
| **Kiran Kishore V** | Core Developer |
| **Yashwant PT** | Core Developer |

---

## License

MIT.

## Contributing

Issues and PRs welcome. Keep patches small and focused.
