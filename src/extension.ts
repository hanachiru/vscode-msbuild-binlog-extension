import * as vscode from 'vscode';

import { BinlogCustomEditorProvider } from './editor/BinlogCustomEditorProvider';

/** Registers the extension entry points. */
export function activate(context: vscode.ExtensionContext): void {
  const provider = new BinlogCustomEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(BinlogCustomEditorProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
  );
}

/** Releases extension resources when VS Code deactivates the extension. */
export function deactivate(): void {
  // No-op for now. The provider owns the disposable resources.
}