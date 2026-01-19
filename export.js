// SVG-only export (WYSIWYG)
// Exports the current SVG canvas as `floorplan.svg` using the current viewBox (zoom/pan).
(function () {
  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function exportSvg() {
    const svgEl = document.getElementById("lin");
    if (!svgEl) return;

    const clone = svgEl.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    // Keep current camera viewBox (WYSIWYG)
    const vb = svgEl.getAttribute("viewBox");
    if (vb) clone.setAttribute("viewBox", vb);

    // Remove the absolute-positioning style to make the exported SVG cleaner.
    clone.removeAttribute("style");

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);
    downloadBlob(new Blob([svgString], { type: "image/svg+xml;charset=utf-8" }), "floorplan.svg");

    if (window.$) $("#boxinfo").html("Exported <b>floorplan.svg</b>");
  }

  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("export_mode");
    if (!btn) return;
    btn.addEventListener("click", exportSvg);
  });
})();

// Exporter (WYSIWYG) — SVG only
// Exports the canvas exactly as you see it.

(function () {
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
    $("#boxinfo").html("Exported <b>floorplan.svg</b>");
  }

  // Wire button
  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("export_mode");
    if (!btn) return;
    btn.addEventListener("click", exportSVG);
  });
})();
