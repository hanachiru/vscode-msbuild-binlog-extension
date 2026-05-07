/** Represents a key-value row shown in the details pane. */
export interface BinlogDetailRow {
  /** Labels the property rendered in the details pane. */
  key: string;

  /** Holds the formatted value rendered in the details pane. */
  value: string;
}

/** Represents one summary metric pill rendered near the top of the viewer. */
export interface BinlogSummaryMetric {
  /** Describes the metric being shown. */
  label: string;

  /** Carries the metric value as formatted text. */
  value: string;

  /** Controls color treatment for the metric pill. */
  tone?: 'neutral' | 'success' | 'warning' | 'error';
}

/** Describes the headline summary for an opened .binlog file. */
export interface BinlogSummaryViewModel {
  /** Holds the overall build outcome. */
  outcome: string;

  /** Stores the formatted build duration. */
  durationText: string;

  /** Stores the formatted build start timestamp. */
  startTime: string;

  /** Stores the formatted build end timestamp. */
  endTime: string;

  /** Lists the secondary metrics rendered below the outcome. */
  metrics: BinlogSummaryMetric[];
}

/** Describes one node in the exported build tree. */
export interface BinlogNodeViewModel {
  /** Carries the stable node identifier. */
  id: string;

  /** Describes the StructuredLogger node type. */
  kind: string;

  /** Holds the primary title rendered in the tree. */
  title: string;

  /** Holds the secondary text rendered beside the title. */
  label: string;

  /** Stores the formatted duration for timed nodes. */
  durationText?: string;

  /** Stores the formatted start timestamp for timed nodes. */
  startTime?: string;

  /** Stores the formatted end timestamp for timed nodes. */
  endTime?: string;

  /** Stores the source file path when available. */
  sourceFile?: string;

  /** Stores the source line when available. */
  line?: number;

  /** Marks nodes that StructuredLogger classified as low relevance. */
  isLowRelevance: boolean;

  /** Carries the rows shown in the details pane. */
  details: BinlogDetailRow[];

  /** Holds all child nodes needed for the current viewer iteration. */
  children: BinlogNodeViewModel[];

  /** Carries the child count without needing to inspect the array. */
  childCount: number;
}

/** Describes the full payload rendered by the custom editor. */
export interface BinlogDocumentViewModel {
  /** Holds the base file name. */
  fileName: string;

  /** Holds the absolute file path. */
  filePath: string;

  /** Stores when the helper produced the view model. */
  loadedAt: string;

  /** Holds the build summary shown above the tree. */
  summary: BinlogSummaryViewModel;

  /** Holds the build root exported from StructuredLogger. */
  rootNode: BinlogNodeViewModel;
}

/** Carries a structured helper error. */
export interface BinlogErrorModel {
  /** Classifies the error for the UI. */
  code: 'runtimeMissing' | 'processError' | 'invalidPayload' | 'internalError';

  /** Holds the user-facing error summary. */
  message: string;

  /** Holds an optional secondary explanation. */
  detail?: string;

  /** Captures helper standard output when useful for debugging. */
  stdout?: string;

  /** Captures helper standard error when useful for debugging. */
  stderr?: string;
}

/** Represents the helper response returned to the extension host. */
export type BinlogLoadResult =
  | {
      /** Discriminates a successful helper response. */
      kind: 'loaded';

      /** Carries the parsed document. */
      document: BinlogDocumentViewModel;
    }
  | {
      /** Discriminates a failed helper response. */
      kind: 'failed';

      /** Carries the structured failure details. */
      error: BinlogErrorModel;
    };

/** Represents the editor state pushed into the webview. */
export type BinlogEditorState =
  | {
      /** Discriminates the loading state. */
      kind: 'loading';

      /** Holds the display name of the file being loaded. */
      fileName: string;

      /** Holds the absolute path of the file being loaded. */
      filePath: string;
    }
  | {
      /** Discriminates the loaded state. */
      kind: 'loaded';

      /** Carries the parsed document. */
      document: BinlogDocumentViewModel;
    }
  | {
      /** Discriminates the failed state. */
      kind: 'failed';

      /** Holds the display name of the file that failed to load. */
      fileName: string;

      /** Holds the absolute path of the file that failed to load. */
      filePath: string;

      /** Carries the structured error. */
      error: BinlogErrorModel;
    };

/** Represents messages sent from the extension host to the webview. */
export type BinlogExtensionToWebviewMessage = {
  /** Identifies the state sync message. */
  type: 'stateChanged';

  /** Carries the new editor state. */
  state: BinlogEditorState;
};

/** Represents messages sent from the webview back to the extension host. */
export type BinlogWebviewToExtensionMessage =
  | {
      /** Indicates that the webview is ready to receive state. */
      type: 'ready';
    }
  | {
      /** Requests that the current document be reloaded. */
      type: 'reloadRequested';
    }
  | {
      /** Requests that VS Code open a source file referenced by the selected node. */
      type: 'openSourceLocation';

      /** Carries the source file path to open. */
      path: string;

      /** Carries the optional one-based line number to reveal. */
      line?: number;
    };