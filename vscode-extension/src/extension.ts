import * as vscode from 'vscode';

// ─── API Client ───────────────────────────────────────────────────────────────

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('qlab');
  return {
    apiUrl: cfg.get<string>('apiUrl', 'http://localhost:8000'),
    apiKey: cfg.get<string>('apiKey', ''),
  };
}

async function qlabFetch(path: string): Promise<unknown> {
  const { apiUrl, apiKey } = getConfig();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  const res = await fetch(`${apiUrl}${path}`, { headers });
  if (!res.ok) throw new Error(`Q-Lab API error: ${res.status}`);
  return res.json();
}

// ─── Tree Data Providers ──────────────────────────────────────────────────────

class RunItem extends vscode.TreeItem {
  constructor(
    public readonly run: Record<string, unknown>,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(
      (run.circuit_name as string) || (run.run_id as string),
      collapsibleState
    );
    this.description = `${(run.backend as string) || ''} · ${run.status as string}`;
    this.tooltip = `Run ${run.run_id as string}\nHealth: ${
      run.health_score != null
        ? (run.health_score as number).toFixed(1)
        : 'N/A'
    }/100`;
    this.iconPath = new vscode.ThemeIcon(
      run.status === 'completed'
        ? 'check'
        : run.status === 'failed'
        ? 'error'
        : 'sync~spin'
    );
    this.contextValue = 'qlabRun';
    this.command = {
      command: 'qlab.openRunInBrowser',
      title: 'Open Run',
      arguments: [run.run_id as string],
    };
  }
}

class RunsProvider implements vscode.TreeDataProvider<RunItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    RunItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: RunItem): RunItem {
    return element;
  }

  async getChildren(): Promise<RunItem[]> {
    try {
      const data = (await qlabFetch('/api/v1/runs?page_size=20')) as Record<
        string,
        unknown
      >;
      const runs = (data.runs ||
        data.items ||
        data) as Array<Record<string, unknown>>;
      const list = Array.isArray(runs) ? runs : [];
      return list
        .slice(0, 20)
        .map(
          (r) =>
            new RunItem(r, vscode.TreeItemCollapsibleState.None)
        );
    } catch {
      return [
        new RunItem(
          {
            run_id: 'error',
            circuit_name: 'Could not connect to Q-Lab',
            status: 'error',
          },
          vscode.TreeItemCollapsibleState.None
        ),
      ];
    }
  }
}

class BackendItem extends vscode.TreeItem {
  constructor(backend: Record<string, unknown>) {
    super(
      (backend.backend as string) || (backend.name as string) || 'Unknown',
      vscode.TreeItemCollapsibleState.None
    );
    const ok = backend.operational !== false;
    this.description = ok
      ? `✓ Queue: ${(backend.queue_depth as string | number) ?? '?'}`
      : '✗ Offline';
    this.iconPath = new vscode.ThemeIcon(ok ? 'circle-filled' : 'circle-slash');
    const t1 =
      backend.t1_us != null
        ? (backend.t1_us as number).toFixed(1)
        : '?';
    const t2 =
      backend.t2_us != null
        ? (backend.t2_us as number).toFixed(1)
        : '?';
    this.tooltip = `T1: ${t1}µs · T2: ${t2}µs`;
  }
}

class BackendsProvider implements vscode.TreeDataProvider<BackendItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    BackendItem | undefined
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(el: BackendItem): BackendItem {
    return el;
  }

  async getChildren(): Promise<BackendItem[]> {
    try {
      const data = await qlabFetch('/api/v1/live-monitor/status');
      const list = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : ((data as Record<string, unknown>).backends as Array<
            Record<string, unknown>
          >) || [];
      return list.map((b) => new BackendItem(b));
    } catch {
      return [
        new BackendItem({ backend: 'Could not connect', operational: false }),
      ];
    }
  }
}

// ─── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const runsProvider = new RunsProvider();
  const backendsProvider = new BackendsProvider();

  vscode.window.registerTreeDataProvider('qlab-runs', runsProvider);
  vscode.window.registerTreeDataProvider('qlab-backends', backendsProvider);

  // Auto-refresh every 60 seconds
  const timer = setInterval(() => {
    runsProvider.refresh();
    backendsProvider.refresh();
  }, 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push(
    vscode.commands.registerCommand('qlab.showRuns', () => {
      runsProvider.refresh();
    }),

    vscode.commands.registerCommand('qlab.openDashboard', () => {
      const { apiUrl } = getConfig();
      vscode.env.openExternal(
        vscode.Uri.parse(apiUrl.replace(':8000', ':3000') + '/runs')
      );
    }),

    vscode.commands.registerCommand(
      'qlab.openRunInBrowser',
      (runId: string) => {
        const { apiUrl } = getConfig();
        vscode.env.openExternal(
          vscode.Uri.parse(
            apiUrl.replace(':8000', ':3000') + `/runs/${runId}`
          )
        );
      }
    ),

    vscode.commands.registerCommand('qlab.showCalibration', async () => {
      try {
        const data = await qlabFetch('/api/v1/live-monitor/status');
        const backends = Array.isArray(data)
          ? (data as Array<Record<string, unknown>>)
          : ((data as Record<string, unknown>).backends as Array<
              Record<string, unknown>
            >) || [];
        if (!backends.length) {
          vscode.window.showInformationMessage(
            'No backend data available'
          );
          return;
        }
        const items = backends.map((b) => ({
          label: (b.backend as string) || 'Unknown',
          description: `Health: ${
            (b.alert_level as string) || 'ok'
          } · Queue: ${
            (b.queue_depth as string | number) ?? '?'
          } · T1: ${
            b.t1_us != null ? (b.t1_us as number).toFixed(1) : '?'
          }µs`,
        }));
        await vscode.window.showQuickPick(items, {
          title: 'Q-Lab Backend Calibration',
          placeHolder: 'Select backend for details',
        });
      } catch {
        vscode.window.showErrorMessage(
          'Could not fetch calibration data from Q-Lab'
        );
      }
    }),

    vscode.commands.registerCommand('qlab.submitCircuit', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
      }
      vscode.window.showInformationMessage(
        'Q-Lab: Add `import qlab; qlab.init()` to your script and run it — Q-Lab captures automatically!'
      );
    }),

    vscode.commands.registerCommand(
      'qlab.copyRunId',
      async (item: RunItem) => {
        if (item?.run?.run_id) {
          await vscode.env.clipboard.writeText(item.run.run_id as string);
          vscode.window.showInformationMessage(
            `Copied run ID: ${item.run.run_id as string}`
          );
        }
      }
    )
  );

  vscode.window.showInformationMessage(
    'Q-Lab extension activated. Tracking quantum experiments.'
  );
}

export function deactivate(): void {}
