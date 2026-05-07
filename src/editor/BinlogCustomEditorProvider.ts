import * as vscode from 'vscode';
import { access } from 'node:fs/promises';

import { BinlogHelperProcess } from '../helper/HelperProcess';
import {
  type BinlogEditorState,
  type BinlogExtensionToWebviewMessage,
  type BinlogWebviewToExtensionMessage,
} from '../shared/binlogProtocol';
import { renderSummaryHtml } from '../webview/summary/renderSummaryHtml';

/** Represents the readonly document bound to a .binlog custom editor. */
class BinlogDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  /** Releases resources created for the custom document. */
  public dispose(): void {
    // No-op. The document does not currently own disposable resources.
  }
}

/** Hosts the initial readonly custom edito5r for .binlog files. */
export class BinlogCustomEditorProvider implements vscode.CustomReadonlyEditorProvider<BinlogDocument> {
  /** Identifies the custom editor contribution in package.json. */
  public static readonly viewType = 'msbuildBinlog.viewer';

  /** Reads .binlog files through the external helper process. */
  private readonly helperProcess: BinlogHelperProcess;

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.helperProcess = new BinlogHelperProcess(context);
  }

  /** Creates the readonly document wrapper used by the custom editor lifecycle. */
  public openCustomDocument(uri: vscode.Uri): BinlogDocument {
    return new BinlogDocument(uri);
  }

  /** Resolves the webview content for the opened .binlog document. */
  public async resolveCustomEditor(
    document: BinlogDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    this.configureWebview(webviewPanel.webview);
    this.registerWebviewHandlers(document, webviewPanel);
    webviewPanel.webview.html = renderSummaryHtml(this.context, webviewPanel.webview, document.uri);
  }

  /** Configures the webview with the resources required by the custom editor. */
  private configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
  }

  /** Registers inbound webview messages for the current editor instance. */
  private registerWebviewHandlers(document: BinlogDocument, webviewPanel: vscode.WebviewPanel): void {
    webviewPanel.webview.onDidReceiveMessage(
      async (message: BinlogWebviewToExtensionMessage) => {
        switch (message.type) {
          case 'ready':
          case 'reloadRequested':
            await this.loadDocumentIntoWebview(document, webviewPanel.webview);
            return;
          case 'openSourceLocation':
            await this.openSourceLocation(message.path, message.line);
            return;
        }
      },
      undefined,
      this.context.subscriptions,
    );
  }

  /** Loads the current document and posts the corresponding state transitions to the webview. */
  private async loadDocumentIntoWebview(document: BinlogDocument, webview: vscode.Webview): Promise<void> {
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
    await this.postState(webview, {
      kind: 'loading',
      fileName: relativePath,
      filePath: document.uri.fsPath,
    });

    const result = await this.helperProcess.loadDocument(document.uri);
    if (result.kind === 'loaded') {
      await this.postState(webview, {
        kind: 'loaded',
        document: result.document,
      });
      return;
    }

    await this.postState(webview, {
      kind: 'failed',
      fileName: relativePath,
      filePath: document.uri.fsPath,
      error: result.error,
    });
  }

  /** Posts an editor state update into the webview. */
  private postState(webview: vscode.Webview, state: BinlogEditorState): Thenable<boolean> {
    const message: BinlogExtensionToWebviewMessage = {
      type: 'stateChanged',
      state,
    };

    return webview.postMessage(message);
  }

  /** Opens a source file referenced from the details pane. */
  private async openSourceLocation(path: string, line?: number): Promise<void> {
    try {
      await access(path);
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      const targetLine = Math.max((line ?? 1) - 1, 0);
      const selection = new vscode.Range(targetLine, 0, targetLine, 0);

      await vscode.window.showTextDocument(document, {
        preview: true,
        selection,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(`Unable to open source file: ${message}`);
    }
  }
}