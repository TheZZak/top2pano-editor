# Top2Pano Editor

A browser-based floorplan editor that exports images for the Top2Pano AI model.

---

## Run Locally (All Platforms)

### Prerequisites

- **Python 3.x** installed ([Download Python](https://www.python.org/downloads/))
- A modern web browser (Chrome, Firefox, Safari, Edge)

---

## Option 1: Editor Only (Simplest)

Just want to draw floor plans and export PNG images? Follow your platform:

### macOS / Linux

```bash
# Open Terminal, navigate to this folder
cd top2pano-editor

# Start the server
python3 -m http.server 8000

# Open browser → http://127.0.0.1:8000
```

### Windows (Command Prompt)

```cmd
:: Open Command Prompt, navigate to this folder
cd top2pano-editor

:: Start the server
python -m http.server 8000

:: Open browser → http://127.0.0.1:8000
```

### Windows (PowerShell)

```powershell
# Open PowerShell, navigate to this folder
cd top2pano-editor

# Start the server
python -m http.server 8000

# Open browser → http://127.0.0.1:8000
```

**Done!** Draw walls, doors, windows, furniture → Click **Export** → Get `floorplan_1024.png`

---

## Option 2: Editor + Model Server

Want the editor to also call a model server when exporting? You need **2 terminals**.

### macOS / Linux

**Terminal 1 — Model Server:**
```bash
# From the project ROOT folder (parent of top2pano-editor)
cd /path/to/EDITOR

# Create virtual environment
python3 -m venv .venv_server
source .venv_server/bin/activate

# Install dependencies
pip install -r top2pano-editor/local_model_server_stub/requirements.txt

# Start server
uvicorn top2pano-editor.local_model_server_stub.server:app --host 127.0.0.1 --port 5055
```

**Terminal 2 — Editor:**
```bash
cd top2pano-editor
python3 -m http.server 8000
```

**Open browser:** http://127.0.0.1:8000

---

### Windows (Command Prompt)

**Terminal 1 — Model Server:**
```cmd
:: From the project ROOT folder (parent of top2pano-editor)
cd C:\path\to\EDITOR

:: Create virtual environment
python -m venv .venv_server
.venv_server\Scripts\activate

:: Install dependencies
pip install -r top2pano-editor\local_model_server_stub\requirements.txt

:: Start server
uvicorn top2pano-editor.local_model_server_stub.server:app --host 127.0.0.1 --port 5055
```

**Terminal 2 — Editor:**
```cmd
cd top2pano-editor
python -m http.server 8000
```

**Open browser:** http://127.0.0.1:8000

---

### Windows (PowerShell)

**Terminal 1 — Model Server:**
```powershell
# From the project ROOT folder (parent of top2pano-editor)
cd C:\path\to\EDITOR

# Create virtual environment
python -m venv .venv_server
.\.venv_server\Scripts\Activate.ps1

# Install dependencies
pip install -r top2pano-editor\local_model_server_stub\requirements.txt

# Start server
uvicorn top2pano-editor.local_model_server_stub.server:app --host 127.0.0.1 --port 5055
```

**Terminal 2 — Editor:**
```powershell
cd top2pano-editor
python -m http.server 8000
```

**Open browser:** http://127.0.0.1:8000

---

## Verify Everything Works

### Check the Editor
Open http://127.0.0.1:8000 in your browser. You should see the floor plan editor.

### Check the Model Server
Run this command (or open in browser):

**macOS / Linux:**
```bash
curl http://127.0.0.1:5055/healthz
```

**Windows (PowerShell):**
```powershell
Invoke-WebRequest -Uri http://127.0.0.1:5055/healthz
```

**Windows (Command Prompt):**
```cmd
:: Open in browser: http://127.0.0.1:5055/healthz
```

**Expected response:** `{"ok":true}`

---

## Network Access (Other Devices)

To access from another device on your network (phone, tablet, another computer):

### macOS / Linux

```bash
# Model server (bind to all interfaces)
uvicorn top2pano-editor.local_model_server_stub.server:app --host 0.0.0.0 --port 5055

# Editor (bind to all interfaces)
python3 -m http.server 8000 --bind 0.0.0.0
```

Find your IP:
```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'
```

### Windows

```cmd
:: Model server (bind to all interfaces)
uvicorn top2pano-editor.local_model_server_stub.server:app --host 0.0.0.0 --port 5055

:: Editor (bind to all interfaces)
python -m http.server 8000 --bind 0.0.0.0
```

Find your IP:
```cmd
ipconfig
:: Look for "IPv4 Address" under your active adapter
```

Then access from other devices at: `http://YOUR_IP:8000`

---

## Common Issues

| Issue | Platform | Solution |
|-------|----------|----------|
| `python3` not found | Windows | Use `python` instead of `python3` |
| `python` not found | All | Install Python from python.org, check "Add to PATH" during install |
| Port 8000 in use | All | Use a different port: `python -m http.server 8080` |
| Permission denied | macOS/Linux | Don't use `sudo`. If port < 1024, use higher port number |
| Firewall blocking | Windows | Allow Python through Windows Firewall when prompted |
| PowerShell script blocked | Windows | Run `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser` |
| Can't activate venv | Windows | Use `Scripts\activate` (not `bin/activate`) |

---

## Quick Reference

| What | macOS/Linux | Windows |
|------|-------------|---------|
| Python command | `python3` | `python` |
| Activate venv | `source .venv/bin/activate` | `.venv\Scripts\activate` |
| Path separator | `/` | `\` |
| Stop server | `Ctrl+C` | `Ctrl+C` |

---

## What Gets Exported

When you click **Export**:

1. **Always downloads:** `floorplan_1024.png` (1024×1024 floor plan image)
2. **If model server running:** `top2pano_outputs.zip` (model outputs)

---

## Configuration (Optional)

Configure in browser DevTools (F12 → Console):

```javascript
// Disable model server calls (just export PNG)
window.TOP2PANO_RUN_LOCAL_MODEL = false;

// Change model server URL
window.TOP2PANO_MODEL_API_BASE = "http://127.0.0.1:5055";

// Include scene data in exports
window.TOP2PANO_MODEL_INCLUDE_SCENE = true;
```

---

## Project Files

```
top2pano-editor/
├── index.html              # Main page (open in browser)
├── editor.js               # Drawing tools logic
├── export.js               # PNG export + model calls
├── model_pipeline.js       # HTTP client for model server
├── css/style.css           # Styling
└── local_model_server_stub/
    ├── server.py           # FastAPI model server (stub)
    └── requirements.txt    # Python packages needed
```

---

## License

MIT License - See [LICENSE](LICENSE) file.
