import * as vscode from 'vscode';

/** Renders the custom editor HTML shell for the summary viewer. */
export function renderSummaryHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  documentUri: vscode.Uri,
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'summary', 'summary.css'));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} https: data:`,
    `script-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <title>MSBuild Binlog Viewer</title>
  </head>
  <body data-file-path="${escapeHtml(documentUri.fsPath)}">
    <div class="app-shell app-shell-loading" data-role="app-shell">
      <header class="toolbar">
        <div class="toolbar-title-group">
          <div class="toolbar-caption">MSBuild Binlog Viewer</div>
          <h1 data-role="file-name">Loading...</h1>
        </div>
        <div class="toolbar-actions">
          <label class="search-field">
            <span class="search-label">Search</span>
            <input data-role="search" type="search" placeholder="Search tree" />
          </label>
          <div class="status-pill" data-role="status">Loading</div>
          <button data-role="reload" type="button">Reload</button>
        </div>
      </header>
      <main data-role="content" class="content">
        <section class="loading-screen">Loading ${escapeHtml(documentUri.fsPath)} for Viewer</section>
      </main>
    </div>
    <script type="module" src="${scriptUri}"></script>
  </body>
</html>`;
}

/** Escapes text inserted into the HTML template. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}