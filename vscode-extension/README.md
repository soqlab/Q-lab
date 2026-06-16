# Q-Lab VS Code Extension

Browse quantum experiment runs, view backend calibration, and open the Q-Lab dashboard — all without leaving VS Code.

## Installation

### From source (development)

```bash
cd vscode-extension
npm install
npm run compile
# Then press F5 in VS Code to launch the Extension Development Host
```

### From VSIX

```bash
npm run package   # produces qlab-vscode-0.1.0.vsix
code --install-extension qlab-vscode-0.1.0.vsix
```

## Configuration

Open VS Code Settings and search for **Q-Lab**:

| Setting | Default | Description |
|---------|---------|-------------|
| `qlab.apiUrl` | `http://localhost:8000` | Q-Lab backend URL |
| `qlab.apiKey` | _(empty)_ | API key from Q-Lab Settings > API Keys |
| `qlab.autoTrack` | `true` | Auto-track runs when Python files execute |

## Features

### Sidebar panels

Click the Q-Lab icon in the Activity Bar to open two tree views:

- **Recent Runs** — last 20 runs with status icons and health scores. Click any run to open it in the dashboard.
- **Backend Status** — live T1/T2/queue data for all connected backends.

Both panels auto-refresh every 60 seconds.

### Commands (Ctrl+Shift+P)

| Command | Description |
|---------|-------------|
| Q-Lab: Show Recent Runs | Refresh the runs panel |
| Q-Lab: Open Dashboard | Open the Q-Lab web dashboard in your browser |
| Q-Lab: Show Backend Calibration | Quick-pick list of backends with T1/T2/queue info |
| Q-Lab: Submit Current File | Instructions for auto-tracking with the Q-Lab SDK |
| Q-Lab: Copy Run ID | Copy a run ID to clipboard (right-click a run in the sidebar) |

### QASM syntax highlighting

`.qasm` files get full syntax highlighting: keywords, gate names, constants, comments, and numeric literals.

## Tracking experiments

Q-Lab captures experiments passively via the Python SDK. Add this to your Qiskit script:

```python
import qlab
qlab.init()   # connects to the backend at qlab.apiUrl
```

The extension then shows your new run in the sidebar within 60 seconds.
