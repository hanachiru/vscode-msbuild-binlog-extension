import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDirectory, '..');

/** Returns an absolute path for a workspace-relative asset. */
function fromWorkspaceRoot(...segments) {
  return path.join(workspaceRoot, ...segments);
}

/** Copies static webview assets into the compiled output directory. */
async function copyWebviewAssets() {
  const sourcePath = fromWorkspaceRoot('src', 'webview', 'summary', 'summary.css');
  const destinationDirectory = fromWorkspaceRoot('out', 'webview', 'summary');
  const destinationPath = path.join(destinationDirectory, 'summary.css');

  await mkdir(destinationDirectory, { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

await copyWebviewAssets();