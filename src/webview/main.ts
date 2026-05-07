import type {
  BinlogDocumentViewModel,
  BinlogEditorState,
  BinlogExtensionToWebviewMessage,
  BinlogNodeViewModel,
  BinlogWebviewToExtensionMessage,
} from '../shared/binlogProtocol';

declare function acquireVsCodeApi(): { postMessage(message: BinlogWebviewToExtensionMessage): void };

const vscode = acquireVsCodeApi();
const buildFlowNodeKinds = new Set(['build', 'project', 'projectevaluation', 'target', 'task', 'msbuildtask', 'timednode']);
const searchInputDebounceMs = 120;

/** Caches the static DOM elements used throughout the viewer. */
interface ViewerElements {
  appShell: HTMLElement;
  fileName: HTMLElement;
  status: HTMLElement;
  content: HTMLElement;
  reloadButton: HTMLButtonElement | null;
  searchInput: HTMLInputElement | null;
}

/** Tracks the state currently rendered in the webview. */
let currentState: BinlogEditorState | undefined;

/** Caches the static DOM elements after the webview boots. */
let viewerElements: ViewerElements | undefined;

/** Tracks the selected node in the tree. */
let selectedNodeId: string | undefined;

/** Tracks a pending search render triggered from the search box. */
let searchRenderTimer: number | undefined;

/** Tracks the currently expanded tree branches. */
let expandedNodeIds = new Set<string>();

/** Tracks which file initialized the expansion state. */
let expansionStateFilePath: string | undefined;

/** Preserves the tree scroll position across rerenders. */
let treeScrollTop = 0;

/** Preserves the details scroll position across rerenders. */
let detailsScrollTop = 0;

/** Caches the normalized search text for the currently loaded document. */
let nodeSearchTextCache = new Map<string, string>();

/** Identifies which loaded document the current search cache belongs to. */
let searchCacheDocumentKey: string | undefined;

/** Boots the webview script and requests the initial state. */
function main(): void {
  viewerElements = getViewerElements();
  window.addEventListener('message', handleMessage);
  wireStaticEvents(viewerElements);
  vscode.postMessage({ type: 'ready' });
}

/** Handles state updates sent from the extension host. */
function handleMessage(event: MessageEvent<BinlogExtensionToWebviewMessage>): void {
  const message = event.data;
  if (message.type !== 'stateChanged') {
    return;
  }

  currentState = message.state;
  if (message.state.kind === 'loaded') {
    syncSearchTextCache(message.state.document);
    syncExpansionState(message.state.document);
    selectedNodeId = resolveSelectedNodeId(message.state.document);
  } else {
    resetViewState();
  }

  render();
}

/** Wires the static controls that exist outside the dynamic tree. */
function wireStaticEvents(elements: ViewerElements): void {
  elements.reloadButton?.addEventListener('click', () => {
    vscode.postMessage({ type: 'reloadRequested' });
  });

  elements.searchInput?.addEventListener('input', () => {
    scheduleSearchRender();
  });
}

/** Schedules a debounced tree-only refresh for search input changes. */
function scheduleSearchRender(): void {
  if (searchRenderTimer !== undefined) {
    window.clearTimeout(searchRenderTimer);
  }

  searchRenderTimer = window.setTimeout(() => {
    searchRenderTimer = undefined;
    renderSearchResults();
  }, searchInputDebounceMs);
}

/** Updates only the tree in response to search changes when a document is already loaded. */
function renderSearchResults(): void {
  const documentModel = getLoadedDocument();
  const shell = getLoadedShell();
  if (!documentModel || !shell) {
    render();
    return;
  }

  treeScrollTop = shell.querySelector<HTMLElement>('.tree-container')?.scrollTop ?? treeScrollTop;
  updateTreePanel(shell, documentModel.rootNode);
  shell.querySelector<HTMLElement>('.tree-container')?.scrollTo({ top: treeScrollTop });
}

/** Renders the entire webview based on the latest state. */
function render(): void {
  if (!viewerElements || !currentState) {
    return;
  }

  updateShellMode(viewerElements, currentState);
  renderToolbar(viewerElements, currentState);
  captureScrollPositions();
  renderStateContent(viewerElements.content, currentState);
}

/** Toggles the shell layout for loading versus interactive states. */
function updateShellMode(elements: ViewerElements, state: BinlogEditorState): void {
  elements.appShell.classList.toggle('app-shell-loading', state.kind === 'loading');
}

/** Renders the toolbar headline and status text. */
function renderToolbar(elements: ViewerElements, state: BinlogEditorState): void {
  if (state.kind === 'loading') {
    elements.fileName.textContent = state.fileName;
    elements.status.textContent = 'Loading';
    return;
  }

  if (state.kind === 'failed') {
    elements.fileName.textContent = state.fileName;
    elements.status.textContent = 'Failed';
    return;
  }

  elements.fileName.textContent = state.document.fileName;
  elements.status.textContent = state.document.summary.outcome;
}

/** Renders the state-specific content area. */
function renderStateContent(content: HTMLElement, state: BinlogEditorState): void {
  if (state.kind === 'loading') {
    renderLoadingState(content, state.filePath);
    return;
  }

  if (state.kind === 'failed') {
    renderFailureState(content, state);
    return;
  }

  renderLoadedState(content, state.document);
}

/** Renders the minimal loading screen. */
function renderLoadingState(content: HTMLElement, filePath: string): void {
  content.innerHTML = `<section class="loading-screen">Loading ${escapeHtml(filePath)} for Viewer</section>`;
}

/** Renders the failed-state content. */
function renderFailureState(content: HTMLElement, state: Extract<BinlogEditorState, { kind: 'failed' }>): void {
  content.innerHTML = renderFailure(state);
}

/** Renders or updates the loaded document shell without rebuilding it on every interaction. */
function renderLoadedState(content: HTMLElement, documentModel: BinlogDocumentViewModel): void {
  let shell = content.querySelector<HTMLElement>('.viewer-shell');
  if (!shell || shell.dataset.filePath !== documentModel.filePath) {
    content.innerHTML = '';
    shell = createLoadedShell();
    shell.dataset.filePath = documentModel.filePath;
    content.append(shell);
  }

  updateSummary(shell, documentModel);
  updateTreePanel(shell, documentModel.rootNode);
  updateDetailsPanel(shell, documentModel.rootNode);
  restoreScrollPositions(shell);
}

/** Creates the persistent loaded-state shell. */
function createLoadedShell(): HTMLElement {
  const shell = document.createElement('section');
  shell.className = 'viewer-shell';

  const summary = document.createElement('section');
  summary.className = 'summary-strip';
  summary.setAttribute('data-role', 'summary');

  const panels = document.createElement('div');
  panels.className = 'split-panels';

  const treePanel = document.createElement('section');
  treePanel.className = 'panel tree-panel';
  treePanel.append(createTreePanelShell());

  const detailsPanel = document.createElement('section');
  detailsPanel.className = 'panel details-panel';
  detailsPanel.append(createDetailsPanelShell());

  shell.append(summary);
  panels.append(treePanel, detailsPanel);
  shell.append(panels);
  return shell;
}

/** Updates the summary cards shown above the tree. */
function updateSummary(shell: HTMLElement, documentModel: BinlogDocumentViewModel): void {
  const summary = shell.querySelector<HTMLElement>('[data-role="summary"]');
  if (!summary) {
    return;
  }

  summary.innerHTML = '';

  const headline = document.createElement('div');
  headline.className = 'summary-headline';
  headline.innerHTML = `
    <div class="summary-primary">
      <strong class="summary-outcome outcome-${documentModel.summary.outcome.toLowerCase()}">${escapeHtml(documentModel.summary.outcome)}</strong>
      <span class="summary-duration">${escapeHtml(documentModel.summary.durationText || '0 ms')}</span>
    </div>
    <div class="summary-timing">
      <span>${escapeHtml(documentModel.summary.startTime)} -> ${escapeHtml(documentModel.summary.endTime)}</span>
      <small>Loaded ${escapeHtml(documentModel.loadedAt)}</small>
    </div>
  `;

  const metricList = document.createElement('div');
  metricList.className = 'summary-metrics';
  for (const metric of documentModel.summary.metrics) {
    const pill = document.createElement('div');
    pill.className = `metric metric-${metric.tone ?? 'neutral'}`;
    pill.innerHTML = `<span class="metric-label">${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.value)}</strong>`;
    metricList.append(pill);
  }

  summary.append(headline, metricList);
}

/** Creates the static tree panel shell. */
function createTreePanelShell(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'panel-shell';

  const header = document.createElement('header');
  header.className = 'panel-header';
  header.innerHTML = `
    <div>
      <p class="panel-title">Build Tree</p>
      <p class="panel-subtitle" data-role="tree-root-label"></p>
    </div>
  `;

  const container = document.createElement('div');
  container.className = 'tree-container';
  container.setAttribute('data-role', 'tree-container');

  const tree = document.createElement('div');
  tree.className = 'tree';
  tree.setAttribute('data-role', 'tree');
  container.append(tree);

  wrapper.append(header, container);
  return wrapper;
}

/** Updates the searchable tree pane. */
function updateTreePanel(shell: HTMLElement, rootNode: BinlogNodeViewModel): void {
  const subtitle = shell.querySelector<HTMLElement>('[data-role="tree-root-label"]');
  const tree = shell.querySelector<HTMLElement>('[data-role="tree"]');
  if (!subtitle || !tree) {
    return;
  }

  subtitle.textContent = rootNode.label;
  tree.innerHTML = '';

  const query = getSearchQuery();
  const filteredNode = filterNode(rootNode, query);
  if (!filteredNode) {
    const empty = document.createElement('div');
    empty.className = 'empty-tree';
    empty.textContent = 'No matches';
    tree.append(empty);
    return;
  }

  tree.append(createTreeBranch(filteredNode, query.length > 0, 0));
}

/** Creates one branch in the rendered tree. */
function createTreeBranch(node: BinlogNodeViewModel, expandedByDefault: boolean, depth: number): HTMLElement {
  if (node.children.length === 0) {
    return createTreeLeaf(node, depth);
  }

  const rootNodeId = getLoadedDocument()?.rootNode.id;
  const branch = document.createElement('div');
  branch.className = 'tree-branch';

  const row = document.createElement('div');
  row.className = 'tree-row';

  const isExpanded = expandedByDefault || expandedNodeIds.has(node.id) || shouldAutoExpand(node, depth, false, rootNodeId);
  if (isExpanded) {
    expandedNodeIds.add(node.id);
  }

  const toggle = createTreeToggle(node, isExpanded);
  row.append(toggle, createNodeButton(node));
  branch.append(row);

  const children = document.createElement('div');
  children.className = 'tree-children';
  for (const child of node.children) {
    children.append(createTreeBranch(child, expandedByDefault, depth + 1));
  }

  children.hidden = !isExpanded;
  branch.append(children);

  return branch;
}

/** Decides whether a branch should be expanded by default. */
function shouldAutoExpand(
  node: BinlogNodeViewModel,
  depth: number,
  expandedByDefault: boolean,
  rootNodeId: string | undefined,
): boolean {
  if (expandedByDefault || node.id === rootNodeId) {
    return true;
  }

  if (node.id.startsWith('group:') || node.isLowRelevance) {
    return false;
  }

  return depth < 2 && isBuildFlowNode(node);
}

/** Identifies nodes that are useful to expose in the default execution view. */
function isBuildFlowNode(node: BinlogNodeViewModel): boolean {
  return buildFlowNodeKinds.has(node.kind.toLowerCase());
}

/** Creates one clickable leaf entry in the tree. */
function createTreeLeaf(node: BinlogNodeViewModel, depth: number): HTMLElement {
  const leaf = document.createElement('div');
  leaf.className = 'tree-leaf';

  const row = document.createElement('div');
  row.className = 'tree-row';
  row.style.setProperty('--tree-depth', String(depth));
  row.append(createTreeSpacer(), createNodeButton(node));

  leaf.append(row);
  return leaf;
}

/** Creates the toggle button used to expand and collapse one branch. */
function createTreeToggle(node: BinlogNodeViewModel, isExpanded: boolean): HTMLButtonElement {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tree-toggle';
  toggle.setAttribute('aria-label', isExpanded ? 'Collapse node' : 'Expand node');
  toggle.setAttribute('aria-expanded', String(isExpanded));
  toggle.textContent = isExpanded ? '▾' : '▸';
  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const shouldExpand = !expandedNodeIds.has(node.id);
    if (shouldExpand) {
      expandedNodeIds.add(node.id);
    } else {
      expandedNodeIds.delete(node.id);
    }

    const branch = toggle.closest<HTMLElement>('.tree-branch');
    const children = branch?.querySelector<HTMLElement>(':scope > .tree-children');
    setBranchExpanded(toggle, children, shouldExpand);
  });
  return toggle;
}

/** Creates a spacer that keeps leaf rows aligned with branch rows. */
function createTreeSpacer(): HTMLElement {
  const spacer = document.createElement('span');
  spacer.className = 'tree-toggle-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  return spacer;
}

/** Creates the interactive button used for both leaves and branches. */
function createNodeButton(node: BinlogNodeViewModel): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tree-node kind-${node.kind.toLowerCase()}`;
  button.dataset.nodeId = node.id;
  if (node.id === selectedNodeId) {
    button.classList.add('selected');
  }
  if (node.isLowRelevance) {
    button.classList.add('low-relevance');
  }

  const meta = [node.kind, node.durationText].filter(Boolean).join(' • ');
  button.innerHTML = `
    <span class="tree-node-main">
      <span class="tree-node-title">${escapeHtml(node.title)}</span>
      <span class="tree-node-meta">${escapeHtml(meta)}</span>
    </span>
    <span class="tree-node-label">${escapeHtml(node.label)}</span>
  `;
  button.addEventListener('click', () => {
    selectNode(node.id, button);
  });
  return button;
}

/** Creates the static details panel shell. */
function createDetailsPanelShell(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'panel-shell details';

  const header = document.createElement('header');
  header.className = 'panel-header details-header';
  header.innerHTML = `
    <div>
      <p class="panel-title">Properties</p>
      <h3 data-role="details-title"></h3>
      <p class="panel-subtitle" data-role="details-kind"></p>
    </div>
  `;

  const content = document.createElement('div');
  content.className = 'details-content';
  content.setAttribute('data-role', 'details-content');

  wrapper.append(header, content);
  return wrapper;
}

/** Updates the details pane for the selected node. */
function updateDetailsPanel(shell: HTMLElement, rootNode: BinlogNodeViewModel): void {
  const node = getSelectedNode(rootNode);

  const title = shell.querySelector<HTMLElement>('[data-role="details-title"]');
  const kind = shell.querySelector<HTMLElement>('[data-role="details-kind"]');
  const content = shell.querySelector<HTMLElement>('[data-role="details-content"]');
  if (!title || !kind || !content) {
    return;
  }

  title.textContent = node.title;
  kind.textContent = node.kind;
  content.replaceChildren(createDetailsTable(node));
}

/** Updates selection styles and refreshes only the details pane. */
function selectNode(nodeId: string, button: HTMLButtonElement): void {
  if (selectedNodeId === nodeId) {
    return;
  }

  getSelectedTreeNodeButton()?.classList.remove('selected');
  selectedNodeId = nodeId;
  button.classList.add('selected');

  const documentModel = getLoadedDocument();
  if (!documentModel) {
    return;
  }

  const shell = getLoadedShell();
  if (shell) {
    updateDetailsPanel(shell, documentModel.rootNode);
  }
}

/** Initializes or preserves branch expansion state for the current document. */
function syncExpansionState(documentModel: BinlogDocumentViewModel): void {
  const nodeIds = new Set(collectNodeIds(documentModel.rootNode));
  if (expansionStateFilePath !== documentModel.filePath) {
    expandedNodeIds = collectDefaultExpandedNodeIds(documentModel.rootNode);
    expansionStateFilePath = documentModel.filePath;
    return;
  }

  expandedNodeIds = new Set([...expandedNodeIds].filter((nodeId) => nodeIds.has(nodeId)));
  if (expandedNodeIds.size === 0) {
    expandedNodeIds = collectDefaultExpandedNodeIds(documentModel.rootNode);
  }
}

/** Collects the branch ids that should start expanded for a newly loaded document. */
function collectDefaultExpandedNodeIds(rootNode: BinlogNodeViewModel): Set<string> {
  const expandedIds = new Set<string>();

  const visit = (node: BinlogNodeViewModel, depth: number): void => {
    if (node.children.length === 0) {
      return;
    }

    if (shouldAutoExpand(node, depth, false, rootNode.id)) {
      expandedIds.add(node.id);
    }

    for (const child of node.children) {
      visit(child, depth + 1);
    }
  };

  visit(rootNode, 0);
  return expandedIds;
}

/** Collects every node id present in the current tree. */
function collectNodeIds(node: BinlogNodeViewModel): string[] {
  const nodeIds = [node.id];
  for (const child of node.children) {
    nodeIds.push(...collectNodeIds(child));
  }
  return nodeIds;
}

/** Captures scroll positions before the main content is rerendered. */
function captureScrollPositions(): void {
  treeScrollTop = getLoadedShell()?.querySelector<HTMLElement>('.tree-container')?.scrollTop ?? treeScrollTop;
  detailsScrollTop = getLoadedShell()?.querySelector<HTMLElement>('.details-content')?.scrollTop ?? detailsScrollTop;
}

/** Restores scroll positions after the content has been rerendered. */
function restoreScrollPositions(root: HTMLElement): void {
  root.querySelector<HTMLElement>('.tree-container')?.scrollTo({ top: treeScrollTop });
  root.querySelector<HTMLElement>('.details-content')?.scrollTo({ top: detailsScrollTop });
}

/** Renders one details value cell and links source files back into VS Code. */
function renderDetailValue(node: BinlogNodeViewModel, key: string, value: string): HTMLTableCellElement {
  const cell = document.createElement('td');
  if ((key === 'Source File' || key === 'SourceFilePath') && node.sourceFile) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'details-link';
    button.textContent = node.line ? `${value}:${node.line}` : value;
    button.addEventListener('click', () => {
      vscode.postMessage({
        type: 'openSourceLocation',
        path: node.sourceFile!,
        line: node.line,
      });
    });
    cell.append(button);
    return cell;
  }

  cell.textContent = value;
  return cell;
}

/** Creates the details table for the selected node. */
function createDetailsTable(node: BinlogNodeViewModel): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'details-table';

  const tableHead = document.createElement('thead');
  tableHead.innerHTML = '<tr><th>Property</th><th>Value</th></tr>';

  const body = document.createElement('tbody');
  for (const detail of node.details) {
    const row = document.createElement('tr');
    const valueCell = renderDetailValue(node, detail.key, detail.value);
    row.innerHTML = `<th>${escapeHtml(detail.key)}</th>`;
    row.append(valueCell);
    body.append(row);
  }

  table.append(tableHead, body);
  return table;
}

/** Filters a tree node while preserving matching ancestors. */
function filterNode(node: BinlogNodeViewModel, query: string): BinlogNodeViewModel | undefined {
  if (query.length === 0) {
    return node;
  }

  const childMatches = node.children
    .map((child) => filterNode(child, query))
    .filter((child): child is BinlogNodeViewModel => child !== undefined);

  const matchesSelf = matchesNodeQuery(node, query);

  if (!matchesSelf && childMatches.length === 0) {
    return undefined;
  }

  return {
    ...node,
    children: childMatches,
    childCount: childMatches.length,
  };
}

/** Locates a node by id inside the exported tree. */
function findNodeById(node: BinlogNodeViewModel, nodeId: string): BinlogNodeViewModel | undefined {
  if (node.id === nodeId) {
    return node;
  }

  for (const child of node.children) {
    const match = findNodeById(child, nodeId);
    if (match) {
      return match;
    }
  }

  return undefined;
}

/** Renders the failed-state card. */
function renderFailure(state: Extract<BinlogEditorState, { kind: 'failed' }>): string {
  return `
    <section class="empty-state failure-state">
      <h2>${escapeHtml(state.error.message)}</h2>
      <p>${escapeHtml(state.fileName)}</p>
      <p class="muted">${escapeHtml(state.error.detail ?? '')}</p>
      <pre>${escapeHtml([state.error.stdout, state.error.stderr].filter(Boolean).join('\n\n'))}</pre>
    </section>
  `;
}

/** Resolves the next selected node id for a freshly loaded document. */
function resolveSelectedNodeId(documentModel: BinlogDocumentViewModel): string {
  return selectedNodeId && findNodeById(documentModel.rootNode, selectedNodeId)?.id
    ? selectedNodeId
    : documentModel.rootNode.id;
}

/** Resets local tree state when the viewer leaves the loaded state. */
function resetViewState(): void {
  selectedNodeId = undefined;
  expandedNodeIds.clear();
  expansionStateFilePath = undefined;
  searchCacheDocumentKey = undefined;
  nodeSearchTextCache = new Map();

  if (searchRenderTimer !== undefined) {
    window.clearTimeout(searchRenderTimer);
    searchRenderTimer = undefined;
  }
}

/** Returns the loaded document when the viewer is in the loaded state. */
function getLoadedDocument(): BinlogDocumentViewModel | undefined {
  return currentState?.kind === 'loaded' ? currentState.document : undefined;
}

/** Returns the current loaded shell element when present. */
function getLoadedShell(): HTMLElement | null {
  return viewerElements?.content.querySelector<HTMLElement>('.viewer-shell') ?? null;
}

/** Returns the current search query in normalized form. */
function getSearchQuery(): string {
  return viewerElements?.searchInput?.value.trim().toLowerCase() ?? '';
}

/** Returns the selected tree node button when one exists. */
function getSelectedTreeNodeButton(): HTMLButtonElement | null {
  return getLoadedShell()?.querySelector<HTMLButtonElement>('.tree-node.selected') ?? null;
}

/** Updates the DOM for one branch toggle. */
function setBranchExpanded(toggle: HTMLButtonElement, children: HTMLElement | null | undefined, isExpanded: boolean): void {
  if (children) {
    children.hidden = !isExpanded;
  }

  toggle.setAttribute('aria-label', isExpanded ? 'Collapse node' : 'Expand node');
  toggle.setAttribute('aria-expanded', String(isExpanded));
  toggle.textContent = isExpanded ? '▾' : '▸';
}

/** Returns the selected node or the tree root when nothing is selected. */
function getSelectedNode(rootNode: BinlogNodeViewModel): BinlogNodeViewModel {
  return selectedNodeId ? findNodeById(rootNode, selectedNodeId) ?? rootNode : rootNode;
}

/** Checks whether the node or any displayed fields match the active query. */
function matchesNodeQuery(node: BinlogNodeViewModel, query: string): boolean {
  return getNodeSearchText(node).includes(query);
}

/** Refreshes the search-text cache when a new document payload is loaded. */
function syncSearchTextCache(documentModel: BinlogDocumentViewModel): void {
  const nextKey = `${documentModel.filePath}:${documentModel.loadedAt}`;
  if (searchCacheDocumentKey === nextKey) {
    return;
  }

  searchCacheDocumentKey = nextKey;
  nodeSearchTextCache = new Map();
}

/** Returns the normalized search text for a node, computing it lazily once per loaded document. */
function getNodeSearchText(node: BinlogNodeViewModel): string {
  const cached = nodeSearchTextCache.get(node.id);
  if (cached !== undefined) {
    return cached;
  }

  const searchText = [node.title, node.label, node.kind, node.sourceFile, ...node.details.map((detail) => `${detail.key} ${detail.value}`)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  nodeSearchTextCache.set(node.id, searchText);
  return searchText;
}

/** Reads and validates the static DOM elements required by the viewer. */
function getViewerElements(): ViewerElements {
  return {
    appShell: requireElement('[data-role="app-shell"]'),
    fileName: requireElement('[data-role="file-name"]'),
    status: requireElement('[data-role="status"]'),
    content: requireElement('[data-role="content"]'),
    reloadButton: document.querySelector<HTMLButtonElement>('[data-role="reload"]'),
    searchInput: document.querySelector<HTMLInputElement>('[data-role="search"]'),
  };
}

/** Returns a required DOM element or throws when the webview markup is inconsistent. */
function requireElement<TElement extends HTMLElement>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

/** Escapes a string before inserting it into HTML. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

main();