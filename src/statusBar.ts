import * as vscode from 'vscode';

export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;
  private currentRoom: string | undefined;
  private unreadCount = 0;
  private onlineCount = 0;
  private onlineNames: string[] = [];

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
    this.currentRoom = roomCode ?? undefined;
    if (!this.currentRoom) {
      this.onlineCount = 0;
      this.onlineNames = [];
    }
    this.renderStatus();
  }

  public setUnreadCount(count: number): void {
    this.unreadCount = count;
    this.renderStatus();
  }

  public clearUnread(): void {
    this.unreadCount = 0;
    this.renderStatus();
  }

  public getUnreadCount(): number {
    return this.unreadCount;
  }

  /**
   * Update the online-count badge from PresenceManager. Names show up in the
   * hover tooltip.
   */
  public setPresence(count: number, names: string[]): void {
    this.onlineCount = count;
    this.onlineNames = names;
    this.renderStatus();
  }

  private renderStatus(): void {
    if (this.currentRoom) {
      const unreadBadge = this.unreadCount > 0 ? ` (${this.unreadCount})` : '';
      const onlineBadge = this.onlineCount > 0 ? ` · ${this.onlineCount} online` : '';
      this.statusBarItem.text =
        `$(comment) REZO: ${this.currentRoom}${unreadBadge}${onlineBadge}`;

      const lines: string[] = [];
      lines.push(`REZO — Active room: ${this.currentRoom}`);
      if (this.unreadCount > 0) {
        lines.push(`${this.unreadCount} new message${this.unreadCount > 1 ? 's' : ''} — press Ctrl+Shift+V to read`);
      }
      if (this.onlineCount > 0) {
        const preview = this.onlineNames.slice(0, 8).join(', ');
        const more = this.onlineNames.length > 8 ? ` +${this.onlineNames.length - 8} more` : '';
        lines.push(`Online (${this.onlineCount}): ${preview}${more}`);
      }
      lines.push('Click to leave room');
      this.statusBarItem.tooltip = lines.join('\n');
      this.statusBarItem.command = 'rezo.leaveRoom';
      this.statusBarItem.backgroundColor = this.unreadCount > 0
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
    } else {
      this.statusBarItem.text = `$(comment) REZO: No Room`;
      this.statusBarItem.tooltip = 'REZO — No active room\nClick to create a new room';
      this.statusBarItem.command = 'rezo.createRoom';
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
