import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

import * as vscode from 'vscode';

import type { BinlogErrorModel, BinlogLoadResult } from '../shared/binlogProtocol';

type HelperInvocation = {
  command: string;
  args: string[];
};

type HelperProcessResult = {
  stdout: string;
  stderr: string;
};

/** Resolves and invokes the .NET helper used to parse .binlog files. */
export class BinlogHelperProcess {
  /** Captures helper diagnostics for troubleshooting parse failures. */
  private readonly outputChannel = vscode.window.createOutputChannel('MSBuild Binlog Viewer');

  public constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(this.outputChannel);
  }

  /** Loads a .binlog document through the helper and returns a structured payload. */
  public async loadDocument(documentUri: vscode.Uri): Promise<BinlogLoadResult> {
    const invocation = await this.resolveInvocation();
    if (!invocation) {
      return this.createFailure('runtimeMissing', 'The binlog helper could not be located.', 'Build the helper or install a bundled runtime.');
    }

    try {
      const { stdout, stderr } = await this.runHelper(invocation.command, [...invocation.args, 'load', documentUri.fsPath]);
      this.appendProcessOutput(stderr);
      return JSON.parse(stdout) as BinlogLoadResult;
    } catch (error) {
      const spawnError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
      if (spawnError.code === 'ENOENT') {
        return this.createFailure(
          'runtimeMissing',
          'The .NET runtime was not found on PATH.',
          'Install the dotnet SDK/runtime or switch to a bundled helper build.',
        );
      }

      const stdout = spawnError.stdout?.trim();
      const stderr = spawnError.stderr?.trim();
      this.appendProcessOutput(stdout, stderr);

      return this.createFailure(
        'processError',
        'The binlog helper failed to produce a valid response.',
        spawnError.message,
        stdout,
        stderr,
      );
    }
  }

  /** Invokes the helper process while streaming stdout so large payloads do not hit execFile's maxBuffer limit. */
  private runHelper(command: string, args: string[]): Promise<HelperProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.context.extensionUri.fsPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code, signal) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');

        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        const processError = new Error(
          signal ? `The helper process was terminated by signal ${signal}.` : `The helper process exited with code ${code ?? 'unknown'}.`,
        ) as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        processError.stdout = stdout;
        processError.stderr = stderr;
        reject(processError);
      });
    });
  }

  /** Picks the best available helper launch strategy for the current workspace state. */
  private async resolveInvocation(): Promise<HelperInvocation | undefined> {
    for (const candidate of this.getInvocationCandidates()) {
      if (await this.pathExists(candidate.path)) {
        return candidate.invocation;
      }
    }

    return undefined;
  }

  /** Returns the helper launch candidates in preference order. */
  private getInvocationCandidates(): Array<{ path: vscode.Uri; invocation: HelperInvocation }> {
    const releaseDll = vscode.Uri.joinPath(this.context.extensionUri, 'tool', 'BinlogReader', 'bin', 'Release', 'net8.0', 'BinlogReader.dll');
    const debugDll = vscode.Uri.joinPath(this.context.extensionUri, 'tool', 'BinlogReader', 'bin', 'Debug', 'net8.0', 'BinlogReader.dll');
    const projectFile = vscode.Uri.joinPath(this.context.extensionUri, 'tool', 'BinlogReader', 'BinlogReader.csproj');

    return [
      { path: releaseDll, invocation: { command: 'dotnet', args: [releaseDll.fsPath] } },
      { path: debugDll, invocation: { command: 'dotnet', args: [debugDll.fsPath] } },
      { path: projectFile, invocation: { command: 'dotnet', args: ['run', '--project', projectFile.fsPath, '--'] } },
    ];
  }

  /** Checks whether a helper artifact exists. */
  private async pathExists(path: vscode.Uri): Promise<boolean> {
    try {
      await access(path.fsPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Writes helper stdout and stderr content to the shared output channel when present. */
  private appendProcessOutput(...chunks: Array<string | undefined>): void {
    for (const chunk of chunks) {
      if (chunk && chunk.trim().length > 0) {
        this.outputChannel.appendLine(chunk.trim());
      }
    }
  }

  /** Creates a structured helper error understood by the webview. */
  private createFailure(
    code: BinlogErrorModel['code'],
    message: string,
    detail?: string,
    stdout?: string,
    stderr?: string,
  ): BinlogLoadResult {
    return {
      kind: 'failed',
      error: {
        code,
        message,
        detail,
        stdout,
        stderr,
      },
    };
  }
}