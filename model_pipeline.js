// Local model pipeline helper for Top2Pano Editor.
//
// Responsibilities:
// - Build *minimal, stable* export metadata (scale, viewBox, etc.)
// - (Optionally) attach a lightweight scene snapshot (walls/objects/rooms)
// - Call a locally deployed model server over HTTP (multipart/form-data)
//
// This file intentionally keeps "what to send" separate from export rasterization.
(function () {
  if (typeof window === "undefined") return;
  if (window.Top2PanoModelPipeline) return;

  function getConfig() {
    // These can be set from DevTools without editing code:
    //   window.TOP2PANO_MODEL_API_BASE = "http://127.0.0.1:5055"
    //   window.TOP2PANO_MODEL_API_PATH = "/api/v1/top2pano/generate"
    //   window.TOP2PANO_RUN_LOCAL_MODEL = false
    //   window.TOP2PANO_MODEL_INCLUDE_SCENE = true
    const apiBase = window.TOP2PANO_MODEL_API_BASE || "http://127.0.0.1:5055";
    const apiPath = window.TOP2PANO_MODEL_API_PATH || "/api/v1/top2pano/generate";
    const enabled = window.TOP2PANO_RUN_LOCAL_MODEL !== false;
    const includeScene = window.TOP2PANO_MODEL_INCLUDE_SCENE === true;
    return { apiBase, apiPath, enabled, includeScene };
  }

  function computePixelScale({ exportPx, viewBoxW, meterUnitsPerMeter }) {
    // pixelScale = pixels-per-meter in the exported PNG (Top2Pano expects this).
    const pxPerSvgUnit = exportPx / viewBoxW;
    return pxPerSvgUnit * meterUnitsPerMeter;
  }

  function buildExportMeta({ exportPx, viewBox, meterUnitsPerMeter }) {
    const pixelScale = computePixelScale({
      exportPx,
      viewBoxW: viewBox.w,
      meterUnitsPerMeter,
    });

    return {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      editor: { name: "top2pano-editor" },
      export: {
        sizePx: exportPx,
        viewBox,
        meterUnitsPerMeter,
        pixelScale,
      },
    };
  }

  function safePlainValue(v) {
    if (v == null) return null;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    if (Array.isArray(v)) return v.map(safePlainValue);
    if (typeof v === "object") {
      const out = {};
      for (const k of Object.keys(v)) {
        // Skip known non-serializable / heavy fields from editor runtime objects.
        if (k === "graph" || k === "bbox" || k === "realBbox") continue;
        out[k] = safePlainValue(v[k]);
      }
      return out;
    }
    return String(v);
  }

  function collectSceneSnapshot() {
    // NOTE: This is optional and disabled by default.
    // Keep it compact and deterministic.
    const snapshot = {
      walls: [],
      objects: [],
      rooms: [],
      counts: { walls: 0, objects: 0, rooms: 0 },
    };

    if (typeof window.WALLS !== "undefined" && Array.isArray(window.WALLS)) {
      snapshot.walls = window.WALLS.map((w) => ({
        start: w && w.start ? { x: w.start.x, y: w.start.y } : null,
        end: w && w.end ? { x: w.end.x, y: w.end.y } : null,
        thick: w && typeof w.thick !== "undefined" ? w.thick : null,
        type: w && w.type ? w.type : null,
      }));
    }

    if (typeof window.OBJDATA !== "undefined" && Array.isArray(window.OBJDATA)) {
      snapshot.objects = window.OBJDATA.map((o) =>
        safePlainValue({
          family: o.family,
          class: o.class,
          type: o.type,
          x: o.x,
          y: o.y,
          angle: o.angle,
          angleSign: o.angleSign,
          size: o.size,
          thick: o.thick,
          value: o.value, // furniture: { src, label, lockAspect... }
        })
      );
    }

    if (typeof window.ROOM !== "undefined" && Array.isArray(window.ROOM)) {
      snapshot.rooms = window.ROOM.map((r) =>
        safePlainValue({
          name: r.name,
          color: r.color,
          area: r.area,
          surface: r.surface,
          showSurface: r.showSurface,
          coords: r.coords,
        })
      );
    }

    snapshot.counts = {
      walls: snapshot.walls.length,
      objects: snapshot.objects.length,
      rooms: snapshot.rooms.length,
    };
    return snapshot;
  }

  async function callLocalModel({ floorplanBlob, wallMaskBlob, meta, scene }) {
    const cfg = getConfig();
    const endpoint = cfg.apiBase.replace(/\/$/, "") + cfg.apiPath;

    const fd = new FormData();
    fd.append("floorplan", floorplanBlob, "floorplan_1024.png");
    if (wallMaskBlob) fd.append("wall_mask", wallMaskBlob, "wall_mask_1024.png");
    fd.append("meta", JSON.stringify(meta || {}));
    if (scene) fd.append("scene", JSON.stringify(scene));

    const res = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      body: fd,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Model server error HTTP ${res.status}${txt ? `: ${txt}` : ""}`);
    }

    const contentType = String(res.headers.get("content-type") || "");
    if (contentType.includes("application/zip") || contentType.includes("application/octet-stream")) {
      const blob = await res.blob();
      let filename = "top2pano_outputs.zip";
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)/i);
      if (m && m[1]) filename = decodeURIComponent(String(m[1]).replace(/"/g, ""));
      return { kind: "zip", blob, filename };
    }

    if (contentType.includes("application/json")) {
      const json = await res.json();
      return { kind: "json", json };
    }

    const blob = await res.blob();
    return { kind: "file", blob, filename: "top2pano_output.bin" };
  }

  async function run({ floorplanBlob, wallMaskBlob, exportMeta }) {
    const cfg = getConfig();
    if (!cfg.enabled) return { skipped: true };

    const scene = cfg.includeScene ? collectSceneSnapshot() : null;
    const out = await callLocalModel({ floorplanBlob, wallMaskBlob, meta: exportMeta, scene });
    return { skipped: false, out };
  }

  window.Top2PanoModelPipeline = {
    getConfig,
    buildExportMeta,
    collectSceneSnapshot,
    run,
  };
})();

