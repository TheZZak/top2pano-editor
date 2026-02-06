// Exporter — Top2Pano-friendly PNG
// Produces:
// - `floorplan_1024.png` (square, padded, background-filled, black walls)
//
// Note: SVG + meta export code is kept but commented out for now.
(function () {
  // Hard guard: if this script is loaded/initialized twice (or a cached older copy also runs),
  // avoid wiring multiple exporters.
  if (typeof window !== "undefined") {
    if (window.__TOP2PANO_EXPORT_INIT__ === true) return;
    window.__TOP2PANO_EXPORT_INIT__ = true;
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function toBlobAsync(canvas, type = "image/png", quality) {
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((b) => resolve(b), type, quality);
      } catch (e) {
        reject(e);
      }
    });
  }

  function parseViewBox(vb) {
    const parts = String(vb || "").trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
    return { x: 0, y: 0, w: 1100, h: 700 };
  }

  function squareViewBox(b, padding = 40) {
    const x = b.x - padding;
    const y = b.y - padding;
    const w = b.w + padding * 2;
    const h = b.h + padding * 2;
    const size = Math.max(w, h);
    const sx = x - (size - w) / 2;
    const sy = y - (size - h) / 2;
    return { x: sx, y: sy, w: size, h: size };
  }

  function unionBBox(a, b) {
    if (!a) return b;
    if (!b) return a;
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w);
    const y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function computeContentBBox(svgEl) {
    // Use visible plan content, not the current zoom/pan viewBox.
    const ids = ["boxRoom", "boxwall", "boxcarpentry", "boxEnergy", "boxFurniture", "boxText"];
    let bbox = null;
    for (let i = 0; i < ids.length; i++) {
      const el = svgEl.querySelector(`#${ids[i]}`);
      if (!el) continue;
      try {
        // If empty group, getBBox may throw in some browsers.
        const b = el.getBBox();
        if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.width) && Number.isFinite(b.height) && (b.width > 0 || b.height > 0)) {
          bbox = unionBBox(bbox, { x: b.x, y: b.y, w: b.width, h: b.height });
        }
      } catch (_) { }
    }
    if (bbox) return bbox;
    return parseViewBox(svgEl.getAttribute("viewBox"));
  }

  function absolutizeImageHrefs(svgRoot) {
    const base = (typeof window !== "undefined" && window.location && window.location.origin) ? window.location.origin : "";
    if (!base) return;
    const imgs = svgRoot.querySelectorAll("image");
    imgs.forEach((img) => {
      const href = img.getAttribute("href") || img.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
      const h = String(href);
      if (!h) return;
      if (h.startsWith("http://") || h.startsWith("https://") || h.startsWith("data:") || h.startsWith("blob:")) return;
      const clean = h.startsWith("./") ? h.slice(2) : h;
      const abs = base.replace(/\/$/, "") + "/" + clean.replace(/^\//, "");
      img.setAttribute("href", abs);
      img.setAttributeNS("http://www.w3.org/1999/xlink", "href", abs);
      img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", abs);
    });
  }

  function makeExportClone(svgEl, vb, opts) {
    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    clone.removeAttribute("style"); // Remove inline positioning

    // Remove editor-only layers.
    const removeIds = ["boxgrid", "boxbind", "boxArea", "boxRib", "boxScale", "boxDebug", "boxpath"];
    for (let i = 0; i < removeIds.length; i++) {
      const el = clone.querySelector(`#${removeIds[i]}`);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    if (opts && opts.hideText) {
      const t = clone.querySelector("#boxText");
      if (t && t.parentNode) t.parentNode.removeChild(t);
    }

    // Add a background rect so exported images match expected look.
    const bg = (opts && opts.background) ? opts.background : "#f0f0f0";
    const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bgRect.setAttribute("x", String(vb.x));
    bgRect.setAttribute("y", String(vb.y));
    bgRect.setAttribute("width", String(vb.w));
    bgRect.setAttribute("height", String(vb.h));
    bgRect.setAttribute("fill", bg);
    // Insert first so everything renders on top.
    clone.insertBefore(bgRect, clone.firstChild);

    // Make walls pure black (Top2Pano uses black pixels to detect walls).
    const wallGroup = clone.querySelector("#boxwall");
    if (wallGroup) {
      wallGroup.querySelectorAll("path, rect, line, polyline, polygon").forEach((el) => {
        if (el.getAttribute("fill") && el.getAttribute("fill") !== "none") el.setAttribute("fill", "#000");
        if (el.getAttribute("stroke") && el.getAttribute("stroke") !== "none") el.setAttribute("stroke", "#000");
      });
    }

    absolutizeImageHrefs(clone);
    return clone;
  }

  function serialize(svgNode) {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(svgNode);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("FileReader failed"));
        reader.readAsDataURL(blob);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function inlineAllSvgImages(svgRoot) {
    // Inline images to avoid broken-image placeholders when rasterizing SVG->PNG.
    const imgs = Array.from(svgRoot.querySelectorAll("image"));
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const href =
        img.getAttribute("href") ||
        img.getAttributeNS("http://www.w3.org/1999/xlink", "href") ||
        "";
      const h = String(href);
      if (!h) continue;
      if (h.startsWith("data:")) continue;
      // Skip blob (can't be fetched reliably) and keep it as-is.
      if (h.startsWith("blob:")) continue;
      try {
        const res = await fetch(h, { cache: "force-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        if (!dataUrl) throw new Error("empty data url");
        img.setAttribute("href", dataUrl);
        img.setAttributeNS("http://www.w3.org/1999/xlink", "href", dataUrl);
        img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", dataUrl);
      } catch (_) {
        // If we can't inline it, hide it so it won't show a "broken image" icon.
        img.setAttribute("visibility", "hidden");
      }
    }
  }

  // function exportSVG(cleanSvgString) {
  //   downloadBlob(new Blob([cleanSvgString], { type: "image/svg+xml;charset=utf-8" }), "floorplan.svg");
  //   if (window.$) $("#boxinfo").html("Exported <b>floorplan.svg</b>");
  // }

  function svgStringToImage(svgString) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  async function exportTop2Pano() {
    const svgEl = document.getElementById("lin");
    if (!svgEl) {
      alert("No floor plan found.");
      return;
    }

    const exportPx = 1024;
    const meterUnitsPerMeter = (typeof meter !== "undefined" && Number.isFinite(Number(meter))) ? Number(meter) : 60;

    // Use plan bounds, not current zoom/pan.
    const contentB = computeContentBBox(svgEl);
    const vb = squareViewBox(contentB, 60);

    // Full render SVG (with textures/objects).
    const cloneFull = makeExportClone(svgEl, vb, { background: "#f0f0f0", hideText: true });
    // Wall mask SVG (for enforcing walls as pure black).
    // Keep `boxcarpentry` but paint it white so doors/windows create openings in the mask.
    const cloneWalls = makeExportClone(svgEl, vb, { background: "#ffffff", hideText: true });
    // Remove non-wall layers (keep carpentry to punch holes).
    ["boxRoom", "boxEnergy", "boxFurniture", "boxText"].forEach((id) => {
      const el = cloneWalls.querySelector(`#${id}`);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    // Paint door/window geometry white in the mask so those pixels are not treated as wall.
    try {
      const carp = cloneWalls.querySelector("#boxcarpentry");
      if (carp) {
        carp.querySelectorAll("path, rect, line, polyline, polygon, circle, ellipse").forEach((el) => {
          if (el.getAttribute("fill") && el.getAttribute("fill") !== "none") el.setAttribute("fill", "#fff");
          if (el.getAttribute("stroke") && el.getAttribute("stroke") !== "none") el.setAttribute("stroke", "#fff");
          el.setAttribute("opacity", "1");
        });
        // Hide any images in carpentry (shouldn't exist, but just in case).
        carp.querySelectorAll("image").forEach((img) => img.setAttribute("visibility", "hidden"));
      }
    } catch (_) { }

    // Inline images before rasterizing so the PNG can't end up with broken icons.
    await Promise.all([
      inlineAllSvgImages(cloneFull),
      inlineAllSvgImages(cloneWalls),
    ]);

    const svgFullStr = serialize(cloneFull);
    const svgWallsStr = serialize(cloneWalls);

    // Rasterize both.
    const [imgFull, imgWalls] = await Promise.all([
      svgStringToImage(svgFullStr),
      svgStringToImage(svgWallsStr),
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = exportPx;
    canvas.height = exportPx;
    const ctx = canvas.getContext("2d");

    const wallsCanvas = document.createElement("canvas");
    wallsCanvas.width = exportPx;
    wallsCanvas.height = exportPx;
    const wctx = wallsCanvas.getContext("2d");

    // Draw to canvases.
    ctx.clearRect(0, 0, exportPx, exportPx);
    ctx.drawImage(imgFull, 0, 0, exportPx, exportPx);
    wctx.clearRect(0, 0, exportPx, exportPx);
    wctx.drawImage(imgWalls, 0, 0, exportPx, exportPx);

    // Postprocess:
    // - Enforce walls as pure black
    // - Avoid any other pure-black pixels (e.g. dark furniture) becoming "wall"
    const data = ctx.getImageData(0, 0, exportPx, exportPx);
    const wdata = wctx.getImageData(0, 0, exportPx, exportPx);
    const d = data.data;
    const wd = wdata.data;
    for (let i = 0; i < d.length; i += 4) {
      const isWall = (wd[i] <= 10 && wd[i + 1] <= 10 && wd[i + 2] <= 10);
      if (isWall) {
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 255;
      } else {
        // Lift near-black pixels so Top2Pano doesn't treat them as walls.
        if (d[i] <= 5 && d[i + 1] <= 5 && d[i + 2] <= 5) {
          d[i] = 10; d[i + 1] = 10; d[i + 2] = 10; d[i + 3] = 255;
        } else {
          d[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(data, 0, 0);

    // Save PNG (only output for now)
    const pngBlob = await toBlobAsync(canvas, "image/png");
    if (pngBlob) downloadBlob(pngBlob, "floorplan_1024.png");

    // Optional: call local model server with the export.
    // This is the "pipeline" hook you asked for; it runs after the file is produced.
    // Disable by setting: window.TOP2PANO_RUN_LOCAL_MODEL = false
    const pipeline = (typeof window !== "undefined") ? window.Top2PanoModelPipeline : null;
    if (pipeline && pngBlob) {
      const cfg = pipeline.getConfig();
      if (cfg && cfg.enabled) {
        const wallMaskBlob = await toBlobAsync(wallsCanvas, "image/png").catch(() => null);
        const exportMeta = pipeline.buildExportMeta({ exportPx, viewBox: vb, meterUnitsPerMeter });
        try {
          if (window.$) $("#boxinfo").html("Exported <b>floorplan_1024.png</b><br/>Running local model…");
          const r = await pipeline.run({ floorplanBlob: pngBlob, wallMaskBlob, exportMeta });
          const out = r && r.out ? r.out : null;
          if (out && out.kind === "zip" && out.blob) {
            downloadBlob(out.blob, out.filename || "top2pano_outputs.zip");
            if (window.$) $("#boxinfo").html("Exported <b>floorplan_1024.png</b><br/>Downloaded <b>top2pano_outputs.zip</b>");
          } else if (out && out.kind === "json") {
            if (window.$) $("#boxinfo").html("Exported <b>floorplan_1024.png</b><br/>Model response: <code>JSON</code> (see console)");
            console.log("Top2Pano model JSON response:", out.json);
          } else if (out && out.blob) {
            downloadBlob(out.blob, out.filename || "top2pano_output.bin");
            if (window.$) $("#boxinfo").html("Exported <b>floorplan_1024.png</b><br/>Downloaded model output");
          } else if (r && r.skipped) {
            // noop
          } else {
            if (window.$) $("#boxinfo").html("Exported <b>floorplan_1024.png</b><br/>Model returned no outputs");
          }
        } catch (e) {
          console.warn("Local model call failed:", e);
          if (window.$) $("#boxinfo").html("Exported <b>floorplan_1024.png</b><br/><span style='color:#b44'>Local model not reachable (skipped)</span>");
        }
      }
    }

    // Meta export (disabled for now):
    // - pixel_scale is pixels-per-meter in the exported PNG.
    // const pxPerSvgUnit = exportPx / vb.w;
    // const pixelScale = pxPerSvgUnit * meterUnitsPerMeter;
    // const meta = {
    //   exportPx,
    //   viewBox: vb,
    //   meterUnitsPerMeter,
    //   pixelScale,
    //   notes: [
    //     "Top2Pano resizes inputs to 512x512 in its dataloaders.",
    //     "If you use `test_floorplan_dataset.py`, pass pixel_scale from this file.",
    //   ],
    // };
    // downloadBlob(new Blob([JSON.stringify(meta, null, 2)], { type: "application/json;charset=utf-8" }), "floorplan_meta.json");
    //
    // SVG export (disabled for now):
    // exportSVG(svgFullStr);

    if (window.$) $("#boxinfo").html("Exported <b>floorplan_1024.png</b>");
  }

  function bind() {
    const btn = document.getElementById("export_mode_v2");
    if (!btn) return;
    // Guard against double-binding if this script is accidentally loaded twice.
    if (btn.dataset && btn.dataset.exportBound === "1") return;
    if (btn.dataset) btn.dataset.exportBound = "1";
    btn.addEventListener("click", async (e) => {
      // Prevent accidental double-trigger (double click / touch quirks / multiple handlers).
      if (e && typeof e.preventDefault === "function") e.preventDefault();
      if (e && typeof e.stopPropagation === "function") e.stopPropagation();

      // Ignore double-click (2nd click has detail=2 in most browsers).
      if (e && typeof e.detail === "number" && e.detail > 1) return;

      if (btn.dataset && btn.dataset.exportBusy === "1") return;
      if (btn.dataset) btn.dataset.exportBusy = "1";

      const prevDisabled = btn.disabled;
      btn.disabled = true;
      try {
        await exportTop2Pano();
      } finally {
        // Small delay so a single gesture cannot trigger multiple times.
        setTimeout(() => {
          if (btn.dataset) btn.dataset.exportBusy = "0";
          btn.disabled = prevDisabled;
        }, 500);
      }
    });
  }

  // Bind even if script loads after DOMContentLoaded (dynamic script loader).
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
