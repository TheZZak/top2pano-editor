// Exporter (WYSIWYG) — SVG only
// Exports the current SVG canvas as `floorplan.svg` using the current viewBox (zoom/pan).
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

  function exportSVG() {
    const svgEl = document.getElementById("lin");
    if (!svgEl) {
      alert("No floor plan found.");
      return;
    }

    const clone = svgEl.cloneNode(true);

    // Keep current viewBox (zoom/pan).
    const vb = svgEl.getAttribute("viewBox") || "0 0 1100 700";
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("viewBox", vb);
    clone.removeAttribute("style"); // Remove inline positioning

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);

    downloadBlob(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }), "floorplan.svg");
    if (window.$) $("#boxinfo").html("Exported <b>floorplan.svg</b>");
  }

  // Wire button
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("export_mode_v2");
    if (!btn) return;
    // Guard against double-binding if this script is accidentally loaded twice.
    if (btn.dataset && btn.dataset.exportBound === "1") return;
    if (btn.dataset) btn.dataset.exportBound = "1";
    btn.addEventListener("click", (e) => {
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
        exportSVG();
      } finally {
        // Small delay so a single gesture cannot trigger multiple downloads.
        setTimeout(() => {
          if (btn.dataset) btn.dataset.exportBusy = "0";
          btn.disabled = prevDisabled;
        }, 1200);
      }
    });
  });
})();
