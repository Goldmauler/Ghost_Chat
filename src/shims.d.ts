declare module 'fs' {
  const fs: any;
  export = fs;
}

declare module 'path' {
  const path: any;
  export = path;
}

declare module 'os' {
  const os: any;
  export = os;
}

declare module 'crypto' {
  export function randomBytes(size: number): any;
  export function randomUUID(): string;
}

declare module 'vscode' {
  export interface Disposable {
    dispose(): void;
  }

  export interface Memento {
    get<T>(key: string): T | undefined;
    update(key: string, value: any): Thenable<void>;
  }

  export interface ExtensionContext {
    workspaceState: Memento;
    subscriptions: Disposable[];
  }

  export interface Position {
    line: number;
    character: number;
  }

  export interface Selection {
    start: Position;
    active: Position;
    isEmpty: boolean;
  }

  export interface TextDocument {
    fileName: string;
    uri: { fsPath: string };
    languageId: string;
    getText(selection?: Selection): string;
  }

  export interface TextEditorEdit {
    insert(position: Position, text: string): void;
  }

  export interface TextEditor {
    document: TextDocument;
    selection: Selection;
    edit(callback: (editBuilder: TextEditorEdit) => void | Thenable<void>): Thenable<boolean>;
  }

  export interface StatusBarItem extends Disposable {
    text: string;
    tooltip?: string;
    command?: string;
    show(): void;
    hide(): void;
  }

  export interface QuickPickItem {
    label: string;
    description?: string;
  }

  export const StatusBarAlignment: { Left: number; Right: number };

  export const window: {
    createStatusBarItem(alignment: number, priority?: number): StatusBarItem;
    showInformationMessage(message: string): Thenable<string | undefined>;
    showWarningMessage(message: string): Thenable<string | undefined>;
    showErrorMessage(message: string): Thenable<string | undefined>;
    showInputBox(options?: any): Thenable<string | undefined>;
    showQuickPick(items: readonly QuickPickItem[], options?: any): Thenable<QuickPickItem | undefined>;
    activeTextEditor?: TextEditor;
  };

  export const commands: {
    registerCommand(command: string, callback: (...args: any[]) => any): Disposable;
  };
}

declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...args: any[]): any;
declare function clearTimeout(timeoutId: any): void;