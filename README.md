# GhostChat — Simple LAN chat for VS Code

> One-click host & connect for sharing small snippets and quick history between editors on your LAN.

Features
- Lightweight HTTP host + client built into the extension
- Quick Setup wizard (Host / Connect / Use shared file)
- Persistent group records and message history
- Commands to list groups, show shared file path, dump file, and delete groups

Install
- From VS Code: open the Extensions view → click ••• → "Install from VSIX..." and pick the VSIX you built.
- Or from the command line:

```bash
code --install-extension /home/ib-90/Desktop/Ghost_Chat/ghostchat-0.0.1.vsix
```

Quick Start
1. Open the Command Palette and run `GhostChat: Quick Setup`.
2. Choose `Host` on the machine that will share. The extension starts a local HTTP host and shows a URL (e.g. `http://192.168.0.151:PORT`). Copy this URL.
3. On another machine open `GhostChat: Quick Setup` → choose `Connect` and paste the URL.
4. Use `GhostChat: List Groups` to see available groups. Select a group to view history.
5. Select text in an editor and run `GhostChat: Send Selection` (or use the message input UI) to send messages to the shared group. Use `Insert from History` to paste messages back into the editor.

Commands (Command Palette)
- `GhostChat: Quick Setup` — First-run wizard (Host / Connect / Shared file / Skip)
- `GhostChat: Start Host Share` — Start the HTTP host manually
- `GhostChat: Stop Host Share` — Stop the host
- `GhostChat: Connect To Host` — Connect to a running host by URL
- `GhostChat: Disconnect From Host` — Disconnect from remote
- `GhostChat: List Groups` — Show available groups
- `GhostChat: Show Shared File Path` — Open the local shared JSON path (when using file mode)
- `GhostChat: Dump Shared File` — Open the raw shared JSON in an editor window
- `GhostChat: Delete Group` — Remove a group record from the shared store

Troubleshooting
- If a client cannot see groups, verify the host URL is reachable from the client machine:

```bash
curl <host-url>/history
```

- If `curl` fails on Windows, check firewall rules and allow the extension host port. On the host machine make sure the port is not blocked and the host IP is reachable.
- If you used the shared-file (SMB) option, ensure the shared folder is mounted and the `ghostchat_history.json` file is writable by VS Code.

Examples
- Host URL example: `http://192.168.0.151:42817` (port shown when hosting)

Contributing
- Open issues or PRs in the repository. Small, focused patches welcome.

License
- MIT
# GhostChat

GhostChat is a LAN-only VS Code extension that shares chat history through one JSON file on a network path. There is no server, no cloud, and no database.

For a complete end-to-end setup and validation manual, see `SETUP_AND_TEST_GUIDE.md`.

## Local setup

Run `npm install` once, then `npm run compile`. After that you can launch the extension from VS Code with F5.

## What it does

 - Sends selected text, file name, and line number into a shared JSON history file.
 - Reads the same file and inserts the full history for the active group at the cursor position as a comment block.
 - Supports multiple groups in one shared file.
 - Stores only the shared file path, active group, and sender name override in VS Code `workspaceState`.

## Shared file setup

1. Create a shared network folder that every teammate can reach from the same LAN.
2. Create a JSON file in that folder, for example `ghostchat_history.json`.
3. Put an empty JSON array in the file before first use:

```json
[]
```

4. Make sure everyone has read/write permission to that folder and file.

## First-time configuration

1. Install and open the extension in VS Code.
2. On first activation, GhostChat prompts for the full shared file path, for example:

```text
\\192.168.1.105\SharedFolder\ghostchat_history.json
```

3. Enter or create a Group ID when prompted.
4. If needed, run `GhostChat: Set Sender Name` to override your OS username.

## Commands and shortcuts

 - `GhostChat: Send Selected Text` - default shortcut `Ctrl+Shift+S`
 - `GhostChat: Insert Group History` - default shortcut `Ctrl+Shift+V`
 - `GhostChat: Create New Group`
 - `GhostChat: Join Group by ID`
 - `GhostChat: Join Group from LAN List`
 - `GhostChat: Set Active Group`
 - `GhostChat: Show Current Group`
 - `GhostChat: Set Shared File Path`
 - `GhostChat: Set Sender Name`

## How to use

### Send

1. Select text in any file.
2. Press `Ctrl+Shift+S`.
3. GhostChat appends a new message to the shared JSON file with the current group ID.
4. A toast confirms the send action.

### Receive

1. Place the cursor where you want the chat history inserted.
2. Press `Ctrl+Shift+V`.
3. GhostChat reads the full shared history file and inserts the full history for the active group as a clean comment block.
4. Delete the inserted block manually when you are done with it.

### Join Without Typing

1. Run `GhostChat: Join Group from LAN List`.
2. GhostChat scans the shared JSON file and shows the groups it finds.
3. Click the group you want to join.
4. GhostChat switches the active group immediately.

## Two-instance test

1. Open the same shared workspace in two VS Code windows on two machines, or two instances with access to the same LAN share.
2. Set the same shared JSON file path in both instances.
3. Use the same Group ID in both instances.
4. Send a message in instance A.
5. Open instance B and press `Ctrl+Shift+V` to insert the full group history at the cursor.

## Notes

 - If the file is temporarily locked, GhostChat retries the read/write operation.
 - If the shared path is unreachable, GhostChat shows a friendly error message.
 - The extension watches the shared file and can notify you when a new message appears in your active group.