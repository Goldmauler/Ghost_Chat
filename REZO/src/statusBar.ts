import * as vscode from 'vscode';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.statusBarItem.command = 'rezo.createRoom';
    this.statusBarItem.show();
    this.update(undefined);
  }

  /**
   * Update the status bar display.
   * @param roomCode The active room code, or undefined/null if no room is active.
   */
  public update(roomCode: string | undefined | null): void {
    if (roomCode) {
      this.statusBarItem.text = `$(comment) REZO: ${roomCode}`;
      this.statusBarItem.tooltip = `REZO — Active room: ${roomCode}\nClick to manage room`;
      this.statusBarItem.command = 'rezo.leaveRoom';
    } else {
      this.statusBarItem.text = `$(comment) REZO: No Room`;
      this.statusBarItem.tooltip = 'REZO — No active room\nClick to create a new room';
      this.statusBarItem.command = 'rezo.createRoom';
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
