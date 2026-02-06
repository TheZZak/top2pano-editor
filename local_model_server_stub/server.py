from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from typing import Annotated

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response


app = FastAPI(title="Top2Pano Local Model Server (stub)", version="0.1.0")

# You will call this server from a different origin (e.g. http://127.0.0.1:8000).
# This stub enables permissive CORS so browser fetch works during local dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.post("/api/v1/top2pano/generate")
async def generate(
    floorplan: Annotated[UploadFile, File(..., description="floorplan_1024.png")],
    wall_mask: UploadFile | None = File(default=None, description="wall_mask_1024.png"),
    meta: Annotated[str, Form(..., description="JSON string")] = "{}",
    scene: str | None = Form(default=None, description="Optional JSON scene snapshot"),
) -> Response:
    """
    Stub endpoint that mimics a "local deployed model" API.

    Replace the body of this function with your real model inference:
    - save inputs
    - run top2pano pipeline
    - produce outputs: panorama.png, depth.png, etc.
    - return them as a zip (or switch to a job-based API)
    """
    try:
        meta_obj = json.loads(meta) if meta else {}
    except Exception:
        meta_obj = {"_meta_parse_error": True, "_meta_raw": meta}

    scene_obj = None
    if scene:
        try:
            scene_obj = json.loads(scene)
        except Exception:
            scene_obj = {"_scene_parse_error": True, "_scene_raw": scene}

    floorplan_bytes = await floorplan.read()
    wall_mask_bytes = await wall_mask.read() if wall_mask is not None else None

    # For now: return a zip that includes inputs + meta, and placeholder outputs.
    # This lets you verify the editor->server pipeline without a model.
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("inputs/floorplan_1024.png", floorplan_bytes)
        if wall_mask_bytes is not None:
            z.writestr("inputs/wall_mask_1024.png", wall_mask_bytes)
        z.writestr("inputs/meta.json", json.dumps(meta_obj, indent=2, ensure_ascii=False))
        if scene_obj is not None:
            z.writestr("inputs/scene.json", json.dumps(scene_obj, indent=2, ensure_ascii=False))

        z.writestr(
            "outputs/README.txt",
            "\n".join(
                [
                    "This is a stub output archive.",
                    "Replace local_model_server_stub/server.py with real inference code.",
                    "",
                    "Expected real outputs could include:",
                    "- outputs/panorama.png",
                    "- outputs/depth.png",
                    "- outputs/debug/*.png",
                    "",
                    f"generated_at={datetime.now(timezone.utc).isoformat()}",
                ]
            ),
        )

        # "Fake" outputs so the client has something to download.
        # We just copy the floorplan as a placeholder.
        z.writestr("outputs/panorama_PLACEHOLDER.png", floorplan_bytes)

    mem.seek(0)
    zip_bytes = mem.getvalue()

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="top2pano_outputs.zip"',
        },
    )

