# GhostChat Setup And Test Guide

This guide explains every step required to set up GhostChat and test it locally and across two laptops on the same LAN.

## 1. Prerequisites

You need the following on each laptop:

1. VS Code installed.
2. Node.js and npm installed.
3. Access to the same local network.
4. Read and write permission to one shared folder on that network.

Quick check commands:

```bash
node -v
npm -v
```

If these commands return versions, your environment is ready.

## 2. Open The Project

1. Open VS Code.
2. Open the GhostChat project folder.
3. Open a terminal in the project root.

## 3. Install Dependencies And Compile

Run:

```bash
npm install
npm run compile
```

Expected result:

1. Dependencies install without errors.
2. Compile command completes successfully.
3. Build output appears in the `out` folder.

## 4. Create The Shared LAN JSON File

GhostChat uses one shared history file for all users.

1. Create a shared folder on one machine in your LAN.
2. Give both laptops read and write permission.
3. Create a file named `ghostchat_history.json`.
4. Put this content in the file:

```json
[]
```

5. Copy the full network path to this file.

Examples:

1. Windows UNC: `\\192.168.1.105\SharedFolder\ghostchat_history.json`
2. Linux mount path: `/mnt/shared/ghostchat_history.json`

## 5. Run Extension In Development Host (Laptop 1)

1. In VS Code, press F5.
2. A new Extension Development Host window opens.
3. In that new window, open Command Palette.
4. Run `GhostChat: Set Shared File Path`.
5. Paste the shared JSON file path from Section 4.
6. Run `GhostChat: Join Group from LAN List`.
7. If a group already exists, click it to join.
8. If no groups exist yet, run `GhostChat: Create New Group` once to seed the shared file.
9. Use a group ID like `TEAM-Alpha`.

Expected result:

1. Status bar shows `GhostChat • Group: TEAM-Alpha`.
2. No error toast appears for file access.

## 6. Test Send Flow (Laptop 1)

1. Open any file, for example `test.py` or `index.ts`.
2. Select a line of text, for example:

```text
check this function
```

3. Press Ctrl+Shift+S.

Expected result:

1. Toast shows: `Message sent to Group TEAM-Alpha`.
2. Shared JSON file now contains a new object with:
   1. `groupId`
   2. `sender`
   3. `content`
   4. `file`
   5. `line`
   6. `timestamp`

## 7. Test Receive Flow (Laptop 1)

1. Place cursor anywhere in the file.
2. Press Ctrl+Shift+V.

Expected result:

1. Full group history is inserted exactly at cursor location.
2. A toast appears:

```text
Full history inserted at cursor. Delete this block when done.
```

3. Inserted block format is like:

```text
// ===== GHOSTCHAT HISTORY [Group: TEAM-Alpha] =====
// [2026-05-18 12:05] Vimal (app.py:42): check this function
// ===== END HISTORY =====
```

For Python files, prefix should be `#`.
For Markdown/HTML, wrapper should be `<!-- -->`.

## 8. Join A Group By Clicking, Not Typing

1. Run `GhostChat: Show Groups in LAN`.
2. GhostChat scans the shared JSON file and lists all discovered group IDs.
3. Click the group you want.
4. GhostChat sets that group as the active group.
5. If you do not see a group yet, ask someone to send one message first or create a new group.

## 9. Two-Laptop LAN Test (Real Team Scenario)

### 8.1 Setup Laptop 2

1. Open same GhostChat project on laptop 2.
2. Run:

```bash
npm install
npm run compile
```

3. Press F5 to open Extension Development Host on laptop 2.
4. Set the same shared file path.
5. Join the same group ID, for example `TEAM-Alpha`.

### 8.2 Send On Laptop 1, Receive On Laptop 2

1. On laptop 1, select text and press Ctrl+Shift+S.
2. On laptop 2, place cursor and press Ctrl+Shift+V.

Expected result:

1. Laptop 2 sees laptop 1 message in inserted history block.
2. Optional watcher notification appears on laptop 2: `New message in Group TEAM-Alpha`.

### 8.3 Reverse Direction

1. On laptop 2, send selected text.
2. On laptop 1, receive history.

Expected result:

1. Both users see complete group history from the same shared file.

## 10. Private Distribution Test With VSIX

If you want to test as installed extension before publishing:

1. In project root, run:

```bash
npx @vscode/vsce package
```

2. This creates a `.vsix` file.
3. Copy the VSIX to laptop 2.
4. Install on each laptop:
   1. Open Extensions view.
   2. Click menu `...`.
   3. Select `Install from VSIX...`.
5. Configure shared path and group exactly as above.

Expected result:

1. Same send/receive behavior works in installed extension mode.

## 11. Full Validation Checklist

Mark each item done before publication:

1. Shared file contains valid JSON array.
2. Both laptops can read and write shared file.
3. Status bar shows active group on both laptops.
4. Ctrl+Shift+S sends selected text only.
5. Ctrl+Shift+V inserts full group history at cursor.
6. File name and line number are stored correctly.
7. Multiline selected text is preserved in history block.
8. No-selection send attempt is blocked with warning.
9. Group switching works using commands.
10. Sender name is correct (OS username or overridden value).
11. Watcher notification appears for new remote messages.
12. Shared file remains readable after many sends.

## 12. Troubleshooting

### 11.1 File Not Found

Symptoms:

1. Error toast says shared file not found.

Fix:

1. Verify full network path.
2. Verify folder is shared on LAN.
3. Re-run `GhostChat: Set Shared File Path`.

### 11.2 Permission Error

Symptoms:

1. Error toast says no permission.

Fix:

1. Grant write permission on shared folder and file for both laptops.
2. Retry send command.

### 11.3 Network Offline Or Slow

Symptoms:

1. Messages fail intermittently.

Fix:

1. Confirm both laptops are on same LAN.
2. Check share accessibility from file explorer.
3. Retry command after connection stabilizes.

### 11.4 Invalid JSON

Symptoms:

1. Receive command fails due to parse error.

Fix:

1. Open shared file.
2. Ensure valid JSON array format.
3. Correct malformed content.

## 13. Ready For Publication

You are ready to publish when:

1. All checklist items in Section 10 pass.
2. Two-laptop send and receive flow works repeatedly.
3. VSIX private install test passes.

After this, proceed with version bump, package, and publish to Marketplace.