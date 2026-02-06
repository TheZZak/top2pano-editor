# Top2Pano local model server (stub)

This folder is a **tiny HTTP API stub** that the editor can call when you press **Export**.

## What it does

- Exposes `POST /api/v1/top2pano/generate`
- Accepts:
  - `floorplan` (PNG file)
  - `wall_mask` (PNG file, optional)
  - `meta` (JSON string)
-  - `scene` (JSON string, optional; editor sends it only if enabled)
- Returns: `top2pano_outputs.zip` (inputs + placeholder outputs)

## Run it

From the repo root:

```bash
python3 -m venv .venv_top2pano_stub
source .venv_top2pano_stub/bin/activate
pip install -r top2pano-editor/local_model_server_stub/requirements.txt
uvicorn top2pano-editor.local_model_server_stub.server:app --host 127.0.0.1 --port 5055 --reload
```

Health check:

```bash
curl http://127.0.0.1:5055/healthz
```

## Editor config

The editor defaults to calling:

- base: `http://127.0.0.1:5055`
- path: `/api/v1/top2pano/generate`

Override in DevTools console:

```js
window.TOP2PANO_MODEL_API_BASE = "http://127.0.0.1:5055";
window.TOP2PANO_MODEL_API_PATH = "/api/v1/top2pano/generate";
```

Enable sending the optional `scene` payload (disabled by default):

```js
window.TOP2PANO_MODEL_INCLUDE_SCENE = true;
```

Disable the model call (export will still download `floorplan_1024.png`):

```js
window.TOP2PANO_RUN_LOCAL_MODEL = false;
```

