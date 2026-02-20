// Procedural floorplan generator (v1) for Top2Pano Editor.
//
// - Rectangle-only outer shell
// - Simple 2x2 partition when {bedroom,kitchen,bathroom} exist
// - Places assets from `window.TOP2PANO_ASSETS.objects` as `editor.obj2D` furniture
//
// Exposes:
//   window.Top2PanoFloorplanGenerator.generate({ objects: ["bed", ...], seed?: number })
(function () {
  if (typeof window === "undefined") return;
  if (window.Top2PanoFloorplanGenerator) return;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function rect(x1, y1, x2, y2, tag) {
    return { x1, y1, x2, y2, tag: tag || "" };
  }

  function rectW(r) { return r.x2 - r.x1; }
  function rectH(r) { return r.y2 - r.y1; }

  function centerOf(r) {
    return { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
  }

  function inflateRect(r, pad) {
    return rect(r.x1 - pad, r.y1 - pad, r.x2 + pad, r.y2 + pad, r.tag);
  }

  function intersects(a, b) {
    return !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
  }

  function containsRect(container, inner) {
    return inner.x1 >= container.x1 && inner.y1 >= container.y1 && inner.x2 <= container.x2 && inner.y2 <= container.y2;
  }

  function getAssets() {
    const assets = window.TOP2PANO_ASSETS || {};
    return Array.isArray(assets.objects) ? assets.objects : [];
  }

  function assetById(id) {
    const list = getAssets();
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function normalizeObjectList(ids) {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < ids.length; i++) {
      const raw = String(ids[i] || "").trim();
      if (!raw) continue;
      const id = raw;
      if (seen.has(id)) continue;
      const a = assetById(id);
      if (!a) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  function pickObjectsAuto(rng) {
    // Produce a plausible program + objects without user typing.
    // Keep it simple for v1: weighted sampling + always include some core items if available.
    const available = new Set(getAssets().map((o) => o && o.id).filter(Boolean));
    const chosen = [];

    function want(id, p = 1.0) {
      if (!available.has(id)) return;
      if (p < 1.0 && rng() > p) return;
      if (!chosen.includes(id)) chosen.push(id);
    }

    // Core living
    want("sofa", 0.95);
    want("table", 0.9);

    // Bedroom
    want("bed", 0.75);
    want("tvstand", 0.5);

    // Bathroom
    want("toilet", 0.65);
    want("sink", 0.6);

    // Kitchen
    want("countertop", 0.7);
    want("fridge", 0.6);

    // Optional extras
    want("chair", 0.6);

    // Ensure at least something
    if (chosen.length === 0) {
      for (const id of ["sofa", "table", "bed", "toilet", "sink", "fridge", "countertop"]) {
        if (available.has(id)) { chosen.push(id); break; }
      }
    }

    return chosen;
  }

  const ROOM_TAGS = ["bathroom", "kitchen", "bedroom", "living"];

  function chooseSinkRoom(objectSet) {
    // Rule (as agreed):
    // - If toilet selected => sink goes to bathroom
    // - Else if countertop or fridge selected => sink goes to kitchen
    // - Else sink goes to bathroom
    if (objectSet.has("toilet")) return "bathroom";
    if (objectSet.has("countertop") || objectSet.has("fridge")) return "kitchen";
    return "bathroom";
  }

  function assignObjectsToRooms(objectIds) {
    // Returns:
    //  - assignment: { [id]: roomTag }
    //  - perRoom: { roomTag: string[] }
    const set = new Set(objectIds);
    const assignment = {};
    const perRoom = { bathroom: [], kitchen: [], bedroom: [], living: [] };

    const sinkRoom = set.has("sink") ? chooseSinkRoom(set) : null;

    function put(id, room) {
      assignment[id] = room;
      if (perRoom[room]) perRoom[room].push(id);
    }

    // Bathroom
    if (set.has("toilet")) put("toilet", "bathroom");
    if (set.has("sink") && sinkRoom === "bathroom") put("sink", "bathroom");

    // Kitchen
    if (set.has("fridge")) put("fridge", "kitchen");
    if (set.has("countertop")) put("countertop", "kitchen");
    if (set.has("sink") && sinkRoom === "kitchen") put("sink", "kitchen");

    // Bedroom
    if (set.has("bed")) put("bed", "bedroom");
    if (set.has("tvstand")) {
      // Prefer bedroom if it exists, otherwise allow living.
      put("tvstand", set.has("bed") ? "bedroom" : "living");
    }

    // Living
    if (set.has("sofa")) put("sofa", "living");
    if (set.has("table")) put("table", "living");
    if (set.has("chair")) put("chair", "living");

    // Anything unknown -> living (best effort)
    for (let i = 0; i < objectIds.length; i++) {
      const id = objectIds[i];
      if (assignment[id]) continue;
      put(id, "living");
    }

    return { assignment, perRoom };
  }

  function buildRoomProgram(perRoom) {
    return {
      bedroom: (perRoom.bedroom || []).length > 0,
      bathroom: (perRoom.bathroom || []).length > 0,
      kitchen: (perRoom.kitchen || []).length > 0,
      living: true,
    };
  }

  function getObjectSpec(id) {
    // Clearances in meters, later converted to editor units via `meter`.
    // Keep v1 minimal; tune later per asset.
    const base = {
      id,
      category: "free", // "wallAnchored" | "free"
      preferredRoom: "living", // bedroom|living|kitchen|bathroom
      clearanceM: { front: 0.5, side: 0.2, back: 0.05 },
    };

    if (id === "bed") return { ...base, category: "wallAnchored", preferredRoom: "bedroom", clearanceM: { front: 0.7, side: 0.35, back: 0.05 } };
    if (id === "sofa") return { ...base, category: "wallAnchored", preferredRoom: "living", clearanceM: { front: 0.6, side: 0.2, back: 0.05 } };
    if (id === "tvstand") return { ...base, category: "wallAnchored", preferredRoom: "bedroom", clearanceM: { front: 0.6, side: 0.1, back: 0.05 } };
    if (id === "table") return { ...base, category: "free", preferredRoom: "living", clearanceM: { front: 0.7, side: 0.4, back: 0.4 } };
    if (id === "chair") return { ...base, category: "free", preferredRoom: "living", clearanceM: { front: 0.4, side: 0.2, back: 0.2 } };
    if (id === "fridge") return { ...base, category: "wallAnchored", preferredRoom: "kitchen", clearanceM: { front: 0.9, side: 0.05, back: 0.05 } };
    if (id === "countertop") return { ...base, category: "wallAnchored", preferredRoom: "kitchen", clearanceM: { front: 0.9, side: 0.05, back: 0.05 } };
    if (id === "sink") return { ...base, category: "wallAnchored", preferredRoom: "bathroom", clearanceM: { front: 0.7, side: 0.1, back: 0.05 } };
    if (id === "toilet") return { ...base, category: "wallAnchored", preferredRoom: "bathroom", clearanceM: { front: 0.9, side: 0.2, back: 0.05 } };

    return base;
  }

  function computeRoomMinsM(program, perRoom) {
    // Minimum room sizes in meters (v1 heuristics).
    // Key driver: kitchen needs enough depth for counter + walkway.
    const mins = {
      living: { w: 4.2, h: 3.0 },
      bedroom: { w: 3.6, h: 2.8 },
      kitchen: { w: 4.2, h: 2.8 },
      bathroom: { w: 2.4, h: 2.2 },
    };

    // If countertop exists, increase kitchen min long side.
    const kitchenIds = (perRoom && perRoom.kitchen) ? perRoom.kitchen : [];
    if (kitchenIds.includes("countertop")) mins.kitchen.w = 4.6;
    if (kitchenIds.includes("fridge")) mins.kitchen.w = Math.max(mins.kitchen.w, 4.8);

    // If only bathroom exists (small apartment), allow living to shrink a bit.
    if (program.bathroom && !program.bedroom && !program.kitchen) {
      mins.living.w = 3.8; mins.living.h = 2.8;
    }

    // Ensure kitchen depth >= countertop depth + walkway.
    // Countertop image height is the depth in our rendering (defaultHeight).
    // Use ~0.95m walkway target.
    const walkway = 0.95;
    const counter = assetById("countertop");
    if (counter && kitchenIds.includes("countertop")) {
      const depthM = (Number(counter.defaultHeight) || 70) / (typeof window.meter !== "undefined" ? Number(window.meter) : 60);
      mins.kitchen.h = Math.max(mins.kitchen.h, depthM + walkway + 0.35);
    } else {
      mins.kitchen.h = Math.max(mins.kitchen.h, 2.4);
    }

    return mins;
  }

  function chooseShell(program, perRoom, rng) {
    // Compute shell size from minimum room sizes, then add a small slack for variety.
    const mins = computeRoomMinsM(program, perRoom);
    const slackW = 0.6 + rng() * 0.5;
    const slackH = 0.4 + rng() * 0.4;

    // For 4-room layout, use 2x2 grid constraints.
    if (program.bedroom && program.bathroom && program.kitchen) {
      const leftW = Math.max(mins.bedroom.w, mins.living.w);
      const rightW = Math.max(mins.kitchen.w, mins.bathroom.w);
      const totalW = leftW + rightW + slackW;
      const leftH = mins.bedroom.h + mins.living.h;
      const rightH = mins.kitchen.h + mins.bathroom.h;
      const totalH = Math.max(leftH, rightH) + slackH;
      return { wM: totalW, hM: totalH, mins };
    }

    // 3-room (living + kitchen + bathroom)
    if (!program.bedroom && program.kitchen && program.bathroom) {
      const leftW = mins.living.w;
      const rightW = Math.max(mins.kitchen.w, mins.bathroom.w);
      const totalW = leftW + rightW + slackW;
      const rightH = mins.kitchen.h + mins.bathroom.h;
      const totalH = Math.max(mins.living.h, rightH) + slackH;
      return { wM: totalW, hM: totalH, mins };
    }

    // 2-room (living + kitchen)
    if (program.kitchen && !program.bathroom && !program.bedroom) {
      const totalW = mins.living.w + mins.kitchen.w + slackW;
      const totalH = Math.max(mins.living.h, mins.kitchen.h) + slackH;
      return { wM: totalW, hM: totalH, mins };
    }

    // 2-room (living + bedroom)
    if (program.bedroom && !program.kitchen && !program.bathroom) {
      const totalW = Math.max(mins.living.w, mins.bedroom.w) + slackW;
      const totalH = mins.bedroom.h + mins.living.h + slackH;
      return { wM: totalW, hM: totalH, mins };
    }

    // living + bathroom
    if (program.bathroom && !program.kitchen && !program.bedroom) {
      const totalW = Math.max(mins.living.w, mins.bathroom.w + 1.4) + slackW;
      const totalH = Math.max(mins.living.h, mins.bathroom.h + 1.2) + slackH;
      return { wM: totalW, hM: totalH, mins };
    }

    // living only
    return { wM: mins.living.w + slackW, hM: mins.living.h + slackH, mins };
  }

  function partitionRooms(shellRect, program, perRoom, meterUnits, rng) {
    const x1 = shellRect.x1, y1 = shellRect.y1, x2 = shellRect.x2, y2 = shellRect.y2;
    const W = x2 - x1;
    const H = y2 - y1;

    // Layout matches the provided example when possible:
    // left column: bedroom (top) + living (bottom)
    // right column: kitchen (top) + bathroom (bottom)
    const rooms = [];

    if (program.bedroom && program.bathroom && program.kitchen) {
      const minsM = computeRoomMinsM(program, perRoom);
      const minsU = {
        living: { w: minsM.living.w * meterUnits, h: minsM.living.h * meterUnits },
        bedroom: { w: minsM.bedroom.w * meterUnits, h: minsM.bedroom.h * meterUnits },
        kitchen: { w: minsM.kitchen.w * meterUnits, h: minsM.kitchen.h * meterUnits },
        bathroom: { w: minsM.bathroom.w * meterUnits, h: minsM.bathroom.h * meterUnits },
      };

      // Medium variety: sometimes swap kitchen/bathroom vertical positions on the right side.
      const swapRight = rng() < 0.5;

      // Horizontal split (left: bedroom/living, right: kitchen/bathroom)
      const leftMinW = Math.max(minsU.bedroom.w, minsU.living.w);
      const rightMinW = Math.max(minsU.kitchen.w, minsU.bathroom.w);
      const extraW = Math.max(0, W - (leftMinW + rightMinW));
      const leftW = leftMinW + extraW * clamp(0.55 + (rng() - 0.5) * 0.10, 0.45, 0.65);
      const xSplit = x1 + leftW;

      // Left column vertical split
      const leftMinH = minsU.bedroom.h + minsU.living.h;
      const extraLeftH = Math.max(0, H - leftMinH);
      const bedH = minsU.bedroom.h + extraLeftH * clamp(0.45 + (rng() - 0.5) * 0.12, 0.30, 0.60);
      const yBed = y1 + bedH;

      // Right column vertical split (top/bottom mins depend on swap)
      const topRoom = swapRight ? "bathroom" : "kitchen";
      const botRoom = swapRight ? "kitchen" : "bathroom";
      const topMinH = minsU[topRoom].h;
      const botMinH = minsU[botRoom].h;
      const extraRightH = Math.max(0, H - (topMinH + botMinH));
      const topH = topMinH + extraRightH * clamp(0.52 + (rng() - 0.5) * 0.12, 0.35, 0.70);
      const yRightSplit = y1 + topH;

      rooms.push(rect(x1, y1, xSplit, yBed, "bedroom"));
      rooms.push(rect(x1, yBed, xSplit, y2, "living"));
      rooms.push(rect(xSplit, y1, x2, yRightSplit, topRoom));
      rooms.push(rect(xSplit, yRightSplit, x2, y2, botRoom));
      return rooms;
    }

    // Reduced layouts (rectangle-only), keeping kitchen/bathroom on the right side
    // so fixtures can anchor to outer walls (more realistic).
    if (program.bedroom && program.bathroom && !program.kitchen) {
      const bedFrac = 0.42 + (rng() - 0.5) * 0.06;
      const bathWM = 2.2;
      const bathHM = 2.0;
      const bathW = bathWM * meterUnits;
      const bathH = bathHM * meterUnits;
      const yBed = y1 + H * clamp(bedFrac, 0.30, 0.55);
      rooms.push(rect(x1, y1, x2, yBed, "bedroom"));
      rooms.push(rect(x1, yBed, x2, y2, "living"));
      rooms.push(rect(x2 - bathW, y2 - bathH, x2, y2, "bathroom"));
      return rooms;
    }

    if (!program.bedroom && program.kitchen && program.bathroom) {
      // living on left, kitchen top-right, bathroom bottom-right
      const minsM = computeRoomMinsM(program, perRoom);
      const livingMinW = minsM.living.w * meterUnits;
      const kitchenMinW = minsM.kitchen.w * meterUnits;
      const bathMinW = minsM.bathroom.w * meterUnits;
      const rightMinW = Math.max(kitchenMinW, bathMinW);
      const extraW = Math.max(0, W - (livingMinW + rightMinW));
      const livingW = livingMinW + extraW * clamp(0.60 + (rng() - 0.5) * 0.12, 0.45, 0.75);
      const xSplit = x1 + livingW;

      const kitchenMinH = minsM.kitchen.h * meterUnits;
      const bathMinH = minsM.bathroom.h * meterUnits;
      const extraH = Math.max(0, H - (kitchenMinH + bathMinH));
      const kitchenH = kitchenMinH + extraH * clamp(0.55 + (rng() - 0.5) * 0.12, 0.35, 0.75);
      const ySplit = y1 + kitchenH;

      rooms.push(rect(x1, y1, xSplit, y2, "living"));
      rooms.push(rect(xSplit, y1, x2, ySplit, "kitchen"));
      rooms.push(rect(xSplit, ySplit, x2, y2, "bathroom"));
      return rooms;
    }

    if (program.kitchen && !program.bathroom && !program.bedroom) {
      const minsM = computeRoomMinsM(program, perRoom);
      const livingMinW = minsM.living.w * meterUnits;
      const kitchenMinW = minsM.kitchen.w * meterUnits;
      const extraW = Math.max(0, W - (livingMinW + kitchenMinW));
      const livingW = livingMinW + extraW * clamp(0.55 + (rng() - 0.5) * 0.14, 0.40, 0.70);
      const xSplit = x1 + livingW;
      rooms.push(rect(x1, y1, xSplit, y2, "living"));
      rooms.push(rect(xSplit, y1, x2, y2, "kitchen"));
      return rooms;
    }

    if (program.bathroom && !program.kitchen && !program.bedroom) {
      // bathroom block in bottom-right, living everywhere else
      const bathWM = 2.2;
      const bathHM = 2.0;
      const bathW = bathWM * meterUnits;
      const bathH = bathHM * meterUnits;
      rooms.push(rect(x1, y1, x2, y2, "living"));
      rooms.push(rect(x2 - bathW, y2 - bathH, x2, y2, "bathroom"));
      return rooms;
    }

    if (program.bedroom && !program.kitchen && !program.bathroom) {
      // bedroom top, living bottom
      const bedFrac = 0.42 + (rng() - 0.5) * 0.06;
      const yBed = y1 + H * clamp(bedFrac, 0.30, 0.55);
      rooms.push(rect(x1, y1, x2, yBed, "bedroom"));
      rooms.push(rect(x1, yBed, x2, y2, "living"));
      return rooms;
    }

    rooms.push(rect(x1, y1, x2, y2, "living"));
    return rooms;
  }

  function buildWallsFromRooms(shellRect, rooms, thickOuter, thickInner) {
    // Walls are explicit segments. Build outer shell + partitions for rectangular splits.
    const walls = [];

    function add(xa, ya, xb, yb, thick, kind) {
      walls.push({ start: { x: xa, y: ya }, end: { x: xb, y: yb }, thick: thick, type: "normal", kind: kind || "inner" });
    }

    // Outer shell
    add(shellRect.x1, shellRect.y1, shellRect.x2, shellRect.y1, thickOuter, "outer");
    add(shellRect.x2, shellRect.y1, shellRect.x2, shellRect.y2, thickOuter, "outer");
    add(shellRect.x2, shellRect.y2, shellRect.x1, shellRect.y2, thickOuter, "outer");
    add(shellRect.x1, shellRect.y2, shellRect.x1, shellRect.y1, thickOuter, "outer");

    // Partitions: add walls between adjacent room rects if they share an edge.
    // This keeps v1 simple and deterministic.
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];

        // vertical shared boundary (a right == b left)
        if (Math.abs(a.x2 - b.x1) < 0.001 || Math.abs(b.x2 - a.x1) < 0.001) {
          const x = (Math.abs(a.x2 - b.x1) < 0.001) ? a.x2 : b.x2;
          const yTop = Math.max(a.y1, b.y1);
          const yBot = Math.min(a.y2, b.y2);
          if (yBot - yTop > 1) add(x, yTop, x, yBot, thickInner, "inner");
        }

        // horizontal shared boundary (a bottom == b top)
        if (Math.abs(a.y2 - b.y1) < 0.001 || Math.abs(b.y2 - a.y1) < 0.001) {
          const y = (Math.abs(a.y2 - b.y1) < 0.001) ? a.y2 : b.y2;
          const xLeft = Math.max(a.x1, b.x1);
          const xRight = Math.min(a.x2, b.x2);
          if (xRight - xLeft > 1) add(xLeft, y, xRight, y, thickInner, "inner");
        }
      }
    }

    return walls;
  }

  function placedRectFromObject(x, y, w, h, angleDeg) {
    const a = ((angleDeg % 180) + 180) % 180; // 0..179
    const rot90 = Math.abs(a - 90) < 0.001;
    const rw = rot90 ? h : w;
    const rh = rot90 ? w : h;
    return rect(x - rw / 2, y - rh / 2, x + rw / 2, y + rh / 2);
  }

  function buildPlacementCandidates(roomRect, objW, objH, meterUnits, rng, id, category, roomTag, avoidWallSide) {
    // Returns candidates {x,y,angle} in priority order.
    // Shrink the inner padding for small rooms (bathrooms) so wall-anchored objects
    // don't get forced into the middle.
    const roomMin = Math.min(roomRect.x2 - roomRect.x1, roomRect.y2 - roomRect.y1);
    const pad = Math.min(0.25 * meterUnits, Math.max(0.12 * meterUnits, roomMin * 0.06));
    const inner = rect(roomRect.x1 + pad, roomRect.y1 + pad, roomRect.x2 - pad, roomRect.y2 - pad);
    const c = centerOf(inner);

    const candidates = [];
    function push(x, y, angle) {
      // Add a tiny jitter so results aren't perfectly grid-aligned.
      const j = 0.08 * meterUnits;
      const dx = (rng() - 0.5) * j;
      const dy = (rng() - 0.5) * j;
      candidates.push({ x: x + dx, y: y + dy, angle });
    }

    const isAnchored = category === "wallAnchored";

    // corners / near walls
    push(inner.x1 + objW / 2, inner.y1 + objH / 2, 0); // top-left
    push(inner.x2 - objW / 2, inner.y1 + objH / 2, 0); // top-right
    push(inner.x1 + objW / 2, inner.y2 - objH / 2, 0); // bottom-left
    push(inner.x2 - objW / 2, inner.y2 - objH / 2, 0); // bottom-right

    // Random samples along walls (more variety)
    const samples = isAnchored ? 7 : 5;
    for (let i = 0; i < samples; i++) {
      const t = 0.18 + rng() * 0.64;
      push(inner.x1 + t * (inner.x2 - inner.x1), inner.y1 + objH / 2, 0); // top
      push(inner.x1 + t * (inner.x2 - inner.x1), inner.y2 - objH / 2, 0); // bottom
      push(inner.x1 + objH / 2, inner.y1 + t * (inner.y2 - inner.y1), 90); // left (rotated)
      push(inner.x2 - objH / 2, inner.y1 + t * (inner.y2 - inner.y1), 90); // right (rotated)
    }

    // center fallback only for free objects
    if (!isAnchored) push(c.x, c.y, 0);

    // Lightweight “style” tweaks for common objects (so outputs resemble the example)
    if (id === "bed") {
      return [
        { x: inner.x1 + objW / 2, y: inner.y1 + objH / 2, angle: 0 },
        { x: c.x, y: inner.y1 + objH / 2, angle: 0 },
        { x: inner.x1 + objH / 2, y: c.y, angle: 90 },
        ...candidates,
      ];
    }
    if (id === "sofa") {
      return [
        { x: c.x, y: inner.y2 - objH / 2, angle: 0 },
        { x: inner.x1 + objH / 2, y: c.y, angle: 90 },
        { x: inner.x2 - objH / 2, y: c.y, angle: 90 },
        ...candidates,
      ];
    }
    if (id === "countertop") {
      return [
        { x: c.x, y: inner.y1 + objH / 2, angle: 0 },
        { x: inner.x2 - objH / 2, y: c.y, angle: 90 },
        ...candidates,
      ];
    }
    if (id === "toilet") {
      // Prefer right wall for toilet (like typical bathroom layouts). If that side is already used, try bottom wall.
      const right = { x: inner.x2 - objH / 2, y: inner.y2 - objW / 2, angle: 90 };
      const bottom = { x: inner.x2 - objW / 2, y: inner.y2 - objH / 2, angle: 0 };
      const pri = (avoidWallSide === "right") ? [bottom, right] : [right, bottom];
      return [...pri, ...candidates];
    }
    if (id === "sink") {
      // Prefer right wall (upper) for sink; if that side is already used, try top wall.
      const right = { x: inner.x2 - objH / 2, y: inner.y1 + objW / 2, angle: 90 };
      const top = { x: c.x, y: inner.y1 + objH / 2, angle: 0 };
      const pri = (avoidWallSide === "right") ? [top, right] : [right, top];
      return [...pri, ...candidates];
    }
    if (id === "table") {
      return [
        { x: c.x, y: c.y, angle: 0 },
        { x: c.x, y: c.y + 0.2 * meterUnits, angle: 0 },
        ...candidates,
      ];
    }

    return candidates;
  }

  function placeObjectsInRooms(roomMap, objectIds, assignment, shellRect, meterUnits, rng, chairCount) {
    const placed = [];
    const skipped = [];
    const occupied = []; // inflated rects
    const usedWallSideByRoom = {}; // roomTag -> "right"|"left"|"top"|"bottom"

    function findPlaced(id, roomTag) {
      for (let i = placed.length - 1; i >= 0; i--) {
        const p = placed[i];
        if (!p) continue;
        if (p.id !== id) continue;
        if (roomTag && p.roomTag !== roomTag) continue;
        return p;
      }
      return null;
    }

    function inferWallSide(roomRect, obj) {
      if (!roomRect || !obj) return null;
      const eps = 0.18 * meterUnits;
      const a = ((Number(obj.angle) % 180) + 180) % 180;
      const rot90 = Math.abs(a - 90) < 2;
      if (rot90) {
        if (Math.abs(obj.x - roomRect.x2) < eps) return "right";
        if (Math.abs(obj.x - roomRect.x1) < eps) return "left";
      } else {
        if (Math.abs(obj.y - roomRect.y1) < eps) return "top";
        if (Math.abs(obj.y - roomRect.y2) < eps) return "bottom";
      }
      // Fallback based on proximity
      const d = {
        left: Math.abs(obj.x - roomRect.x1),
        right: Math.abs(obj.x - roomRect.x2),
        top: Math.abs(obj.y - roomRect.y1),
        bottom: Math.abs(obj.y - roomRect.y2),
      };
      let best = "right";
      let bestV = d.right;
      for (const k in d) {
        if (d[k] < bestV) { bestV = d[k]; best = k; }
      }
      return best;
    }

    function roomOuterSide(roomRect) {
      if (!roomRect || !shellRect) return "right";
      const eps = 0.5;
      if (Math.abs(roomRect.x2 - shellRect.x2) < eps) return "right";
      if (Math.abs(roomRect.x1 - shellRect.x1) < eps) return "left";
      if (Math.abs(roomRect.y1 - shellRect.y1) < eps) return "top";
      if (Math.abs(roomRect.y2 - shellRect.y2) < eps) return "bottom";
      return "right";
    }

    function innerRect(roomRect) {
      const roomMin = Math.min(roomRect.x2 - roomRect.x1, roomRect.y2 - roomRect.y1);
      const pad = Math.min(0.25 * meterUnits, Math.max(0.12 * meterUnits, roomMin * 0.06));
      return rect(roomRect.x1 + pad, roomRect.y1 + pad, roomRect.x2 - pad, roomRect.y2 - pad);
    }

    function tryPlaceAt(id, enforcedRoom, x, y, angle) {
      const asset = assetById(id);
      if (!asset || !asset.src) return null;
      const spec = getObjectSpec(id);
      const roomRect = roomMap[enforcedRoom];
      if (!roomRect) return null;

      const w = Number(asset.defaultWidth) || 120;
      const h = Number(asset.defaultHeight) || 120;

      const clearance = spec.clearanceM || { front: 0.6, side: 0.2, back: 0.05 };
      const pad = (spec.category === "wallAnchored")
        ? Math.max(clearance.side, clearance.back) * meterUnits
        : Math.max(clearance.front, clearance.side, clearance.back) * meterUnits;

      const r0 = placedRectFromObject(x, y, w, h, angle);
      const rInfl = inflateRect(r0, pad);
      if (!containsRect(roomRect, rInfl)) return null;
      for (let t = 0; t < occupied.length; t++) {
        if (intersects(rInfl, occupied[t])) return null;
      }
      occupied.push(rInfl);
      const value = { src: asset.src, label: asset.label || id, outline: false, autoSize: true, lockAspect: true };
      const obj = { id, x, y, angle, size: w, thick: h, value, roomTag: enforcedRoom };
      placed.push(obj);
      return obj;
    }

    function placeOne(id, roomTag) {
      const asset = assetById(id);
      if (!asset || !asset.src) return null;
      const spec = getObjectSpec(id);
      const enforcedRoom = assignment && assignment[id] ? assignment[id] : roomTag;
      const roomRect = roomMap[enforcedRoom] || roomMap[roomTag] || roomMap[spec.preferredRoom] || roomMap.living;
      if (!roomRect) return null;

      const w = Number(asset.defaultWidth) || 120;
      const h = Number(asset.defaultHeight) || 120;

      const clearance = spec.clearanceM || { front: 0.6, side: 0.2, back: 0.05 };
      // Uniform padding is a crude proxy for clearance. For wall-anchored objects, avoid
      // using "front" as padding in all directions, otherwise small rooms (bathroom)
      // force fixtures into the middle.
      const pad = (spec.category === "wallAnchored")
        ? Math.max(clearance.side, clearance.back) * meterUnits
        : Math.max(clearance.front, clearance.side, clearance.back) * meterUnits;

      const avoidSide = usedWallSideByRoom[enforcedRoom] || null;
      const candidates = buildPlacementCandidates(roomRect, w, h, meterUnits, rng, id, spec.category, enforcedRoom, avoidSide);

      // Shuffle lightly but deterministically: pick from first N using rng.
      const N = Math.min(5, candidates.length);
      const start = Math.floor(rng() * N);
      for (let k = 0; k < candidates.length; k++) {
        const c = candidates[(start + k) % candidates.length];
        const r0 = placedRectFromObject(c.x, c.y, w, h, c.angle);
        const rInfl = inflateRect(r0, pad);
        if (!containsRect(roomRect, rInfl)) continue;
        let ok = true;
        for (let t = 0; t < occupied.length; t++) {
          if (intersects(rInfl, occupied[t])) { ok = false; break; }
        }
        if (!ok) continue;
        occupied.push(rInfl);
        const value = { src: asset.src, label: asset.label || id, outline: false, autoSize: true, lockAspect: true };
        const obj = { id, x: c.x, y: c.y, angle: c.angle, size: w, thick: h, value, roomTag: enforcedRoom || spec.preferredRoom };
        placed.push(obj);

        // Track used wall side for better bathroom fixture layout
        try {
          const eps = 0.1 * meterUnits;
          const innerX1 = roomRect.x1 + eps;
          const innerX2 = roomRect.x2 - eps;
          const innerY1 = roomRect.y1 + eps;
          const innerY2 = roomRect.y2 - eps;
          let side = null;
          if (Math.abs(c.angle - 90) < 1) {
            if (Math.abs(c.x - innerX2) < eps * 2) side = "right";
            else if (Math.abs(c.x - innerX1) < eps * 2) side = "left";
          } else {
            if (Math.abs(c.y - innerY1) < eps * 2) side = "top";
            else if (Math.abs(c.y - innerY2) < eps * 2) side = "bottom";
          }
          if (side) usedWallSideByRoom[enforcedRoom] = side;
        } catch (_) { }

        return obj;
      }
      skipped.push(id);
      return null;
    }

    function placeTvStandSmart() {
      const enforcedRoom = assignment && assignment.tvstand ? assignment.tvstand : "living";
      const roomRect = roomMap[enforcedRoom];
      if (!roomRect) return null;
      const asset = assetById("tvstand");
      if (!asset || !asset.src) return null;

      const w = Number(asset.defaultWidth) || 200;
      const h = Number(asset.defaultHeight) || 40;
      const inner = innerRect(roomRect);

      const target = (enforcedRoom === "bedroom") ? (findPlaced("bed", "bedroom") || findPlaced("bed")) : (findPlaced("sofa", "living") || findPlaced("sofa"));
      if (target) {
        const side = inferWallSide(roomRect, target);
        const opp = (side === "left") ? "right" : (side === "right") ? "left" : (side === "top") ? "bottom" : (side === "bottom") ? "top" : "right";
        let x = (inner.x1 + inner.x2) / 2;
        let y = (inner.y1 + inner.y2) / 2;
        let ang = 0;
        if (opp === "left") { x = inner.x1 + h / 2; y = clamp(target.y, inner.y1 + w / 2, inner.y2 - w / 2); ang = 90; }
        if (opp === "right") { x = inner.x2 - h / 2; y = clamp(target.y, inner.y1 + w / 2, inner.y2 - w / 2); ang = 90; }
        if (opp === "top") { y = inner.y1 + h / 2; x = clamp(target.x, inner.x1 + w / 2, inner.x2 - w / 2); ang = 0; }
        if (opp === "bottom") { y = inner.y2 - h / 2; x = clamp(target.x, inner.x1 + w / 2, inner.x2 - w / 2); ang = 0; }
        const ok = tryPlaceAt("tvstand", enforcedRoom, x, y, ang);
        if (ok) return ok;
      }
      return placeOne("tvstand", enforcedRoom);
    }

    function placeChairsSmart(count) {
      const n = Math.max(0, Math.min(8, Number(count) || 0));
      if (!n) return;
      const chairAsset = assetById("chair");
      if (!chairAsset || !chairAsset.src) return;
      const cw = Number(chairAsset.defaultWidth) || 60;
      const ch = Number(chairAsset.defaultHeight) || 60;

      const table = findPlaced("table", "living") || findPlaced("table");
      if (table) {
        const tw = Number(table.size) || 120;
        const th = Number(table.thick) || 120;
        const gap = 0.22 * meterUnits;
        const dx = (tw / 2) + (cw / 2) + gap;
        const dy = (th / 2) + (ch / 2) + gap;
        const pts = [
          { x: table.x + dx, y: table.y, a: 0 },
          { x: table.x - dx, y: table.y, a: 0 },
          { x: table.x, y: table.y + dy, a: 0 },
          { x: table.x, y: table.y - dy, a: 0 },
          { x: table.x + dx, y: table.y + dy, a: 0 },
          { x: table.x - dx, y: table.y + dy, a: 0 },
          { x: table.x + dx, y: table.y - dy, a: 0 },
          { x: table.x - dx, y: table.y - dy, a: 0 },
        ];
        let placedN = 0;
        for (let i = 0; i < pts.length && placedN < n; i++) {
          if (tryPlaceAt("chair", "living", pts[i].x, pts[i].y, pts[i].a)) placedN++;
        }
        for (; placedN < n; placedN++) placeOne("chair", "living");
        return;
      }

      // TV seating: put chairs roughly between sofa and tvstand if both exist.
      const sofa = findPlaced("sofa", "living") || findPlaced("sofa");
      const tv = findPlaced("tvstand", "living") || findPlaced("tvstand");
      if (sofa && tv) {
        const midX = (sofa.x + tv.x) / 2;
        const midY = (sofa.y + tv.y) / 2;
        const spread = 0.55 * meterUnits;
        const pts = [
          { x: midX - spread, y: midY, a: 0 },
          { x: midX + spread, y: midY, a: 0 },
          { x: midX, y: midY - spread, a: 0 },
          { x: midX, y: midY + spread, a: 0 },
        ];
        let placedN = 0;
        for (let i = 0; i < pts.length && placedN < n; i++) {
          if (tryPlaceAt("chair", "living", pts[i].x, pts[i].y, pts[i].a)) placedN++;
        }
        for (; placedN < n; placedN++) placeOne("chair", "living");
        return;
      }

      for (let i = 0; i < n; i++) placeOne("chair", "living");
    }

    function placeKitchenRun() {
      const ids = objectIds.filter((id) => assignment[id] === "kitchen");
      if (!ids.length) return;
      const roomRect = roomMap.kitchen;
      if (!roomRect) return;

      // We only handle the known kitchen set in v1.
      const hasCounter = ids.includes("countertop");
      const hasFridge = ids.includes("fridge");
      const hasSink = ids.includes("sink");
      if (!hasCounter && !hasFridge && !hasSink) return;

      const outer = roomOuterSide(roomRect);
      const inner = innerRect(roomRect);

      // Determine orientation and the fixed coordinate for the chosen wall.
      const isVert = outer === "left" || outer === "right";
      const angle = isVert ? 90 : 0;

      // Pull object sizes
      function sizeOf(id) {
        const a = assetById(id);
        const w = Number(a && a.defaultWidth) || 120;
        const h = Number(a && a.defaultHeight) || 120;
        return { w, h };
      }
      const szCounter = hasCounter ? sizeOf("countertop") : null;
      const szFridge = hasFridge ? sizeOf("fridge") : null;
      const szSink = hasSink ? sizeOf("sink") : null;

      const gap = 0.15 * meterUnits;

      // Place countertop centered on the wall segment.
      if (hasCounter && szCounter) {
        if (isVert) {
          const x = outer === "right" ? (inner.x2 - szCounter.h / 2) : (inner.x1 + szCounter.h / 2);
          const y = (inner.y1 + inner.y2) / 2;
          tryPlaceAt("countertop", "kitchen", x, y, 90);
        } else {
          const y = outer === "bottom" ? (inner.y2 - szCounter.h / 2) : (inner.y1 + szCounter.h / 2);
          const x = (inner.x1 + inner.x2) / 2;
          tryPlaceAt("countertop", "kitchen", x, y, 0);
        }
      }

      // Place sink on the same wall run, offset from countertop center.
      if (hasSink && szSink) {
        if (isVert) {
          const x = outer === "right" ? (inner.x2 - szSink.h / 2) : (inner.x1 + szSink.h / 2);
          const y = inner.y1 + (inner.y2 - inner.y1) * (0.35 + rng() * 0.2);
          tryPlaceAt("sink", "kitchen", x, y, 90);
        } else {
          const y = outer === "bottom" ? (inner.y2 - szSink.h / 2) : (inner.y1 + szSink.h / 2);
          const x = inner.x1 + (inner.x2 - inner.x1) * (0.35 + rng() * 0.2);
          tryPlaceAt("sink", "kitchen", x, y, 0);
        }
      }

      // Place fridge at one end of the same wall run.
      if (hasFridge && szFridge) {
        if (isVert) {
          const x = outer === "right" ? (inner.x2 - szFridge.h / 2) : (inner.x1 + szFridge.h / 2);
          const y = inner.y2 - (szFridge.w / 2) - gap;
          tryPlaceAt("fridge", "kitchen", x, y, 90);
        } else {
          const y = outer === "bottom" ? (inner.y2 - szFridge.h / 2) : (inner.y1 + szFridge.h / 2);
          const x = inner.x2 - (szFridge.w / 2) - gap;
          tryPlaceAt("fridge", "kitchen", x, y, 0);
        }
      }
    }

    // Place anchored first by their enforced rooms (bathroom/kitchen/bedroom), then living.
    const set = new Set(objectIds);
    const order = [
      "toilet", "sink",          // bathroom
      // kitchen handled by a dedicated run first
      "bed",                     // bedroom
      "sofa",                    // living
      "tvstand",                 // tv after seating anchor
      "table",                   // living anchors/free
    ];

    // Kitchen run first (countertop + sink + fridge)
    // Uses enforced room assignment so sink won't accidentally be treated as bathroom here.
    try { placeKitchenRun(); } catch (_) { }

    for (let i = 0; i < order.length; i++) {
      const id = order[i];
      if (!set.has(id)) continue;
      if (id === "tvstand") placeTvStandSmart();
      else placeOne(id, assignment[id] || getObjectSpec(id).preferredRoom);
    }

    // Chairs (optional)
    const chairs = Number.isFinite(Number(chairCount))
      ? Math.max(0, Math.min(8, Number(chairCount)))
      : (set.has("chair") ? 2 : 0);
    placeChairsSmart(chairs);

    // Place any remaining items (best-effort)
    for (let i = 0; i < objectIds.length; i++) {
      const id = objectIds[i];
      if (placed.find((p) => p.id === id)) continue;
      placeOne(id, assignment[id] || getObjectSpec(id).preferredRoom);
    }

    return { placed, skipped };
  }

  function textureExists(id) {
    try {
      const assets = window.TOP2PANO_ASSETS || {};
      const list = Array.isArray(assets.textures) ? assets.textures : [];
      return list.some((t) => t && t.id === id);
    } catch (_) {
      return false;
    }
  }

  function ensureTexPatterns() {
    // Ensure the 3 recognized patterns exist in SVG defs.
    if (typeof window.ensureRoomTexturePattern !== "function") return;
    const assets = window.TOP2PANO_ASSETS || {};
    const list = Array.isArray(assets.textures) ? assets.textures : [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || !t.id) continue;
      if (t.id === "tex_wood" || t.id === "tex_tile" || t.id === "tex_bath") {
        window.ensureRoomTexturePattern(t);
      }
    }
  }

  function applyRoomMaterials(rooms) {
    // After `editor.architect`, ROOM polygons exist but we need to color them.
    // We map each polygon's centroid into our room rectangles by tag.
    if (typeof window.ROOM === "undefined" || !Array.isArray(window.ROOM)) return;
    if (typeof window.Rooms === "undefined") return;

    ensureTexPatterns();

    function centroid(coords) {
      if (!coords || !coords.length) return { x: 0, y: 0 };
      let sx = 0, sy = 0, n = 0;
      for (let i = 0; i < coords.length; i++) {
        const p = coords[i];
        if (!p) continue;
        sx += Number(p.x) || 0;
        sy += Number(p.y) || 0;
        n++;
      }
      return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
    }

    function tagForPoint(pt) {
      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        if (pt.x >= r.x1 && pt.x <= r.x2 && pt.y >= r.y1 && pt.y <= r.y2) return r.tag;
      }
      return "living";
    }

    for (let i = 0; i < window.ROOM.length; i++) {
      const poly = window.ROOM[i];
      const c = centroid(poly.coords);
      const tag = tagForPoint(c);
      // Enforce only the recognized texture IDs from assets.js
      if (tag === "bathroom") poly.color = textureExists("tex_bath") ? "tex_bath" : "tex_tile";
      else if (tag === "kitchen") poly.color = "tex_tile";
      else poly.color = "tex_wood";
    }

    // Re-render rooms with updated colors
    try {
      window.$ && window.$("#boxRoom").empty();
      window.$ && window.$("#boxSurface").empty();
      if (window.editor && typeof window.editor.roomMaker === "function") {
        window.editor.roomMaker(window.Rooms);
      }
    } catch (_) { }
  }

  function angleDeg(ax, ay, bx, by) {
    return (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  }

  function sharedEdge(a, b) {
    // Returns { orientation: "v"|"h", x or y, start, end } or null
    // vertical shared edge: a.x2 == b.x1 OR b.x2 == a.x1
    if (Math.abs(a.x2 - b.x1) < 0.001 || Math.abs(b.x2 - a.x1) < 0.001) {
      const x = (Math.abs(a.x2 - b.x1) < 0.001) ? a.x2 : b.x2;
      const y0 = Math.max(a.y1, b.y1);
      const y1 = Math.min(a.y2, b.y2);
      if (y1 - y0 > 1) return { orientation: "v", x, start: y0, end: y1 };
    }
    // horizontal shared edge: a.y2 == b.y1 OR b.y2 == a.y1
    if (Math.abs(a.y2 - b.y1) < 0.001 || Math.abs(b.y2 - a.y1) < 0.001) {
      const y = (Math.abs(a.y2 - b.y1) < 0.001) ? a.y2 : b.y2;
      const x0 = Math.max(a.x1, b.x1);
      const x1 = Math.min(a.x2, b.x2);
      if (x1 - x0 > 1) return { orientation: "h", y, start: x0, end: x1 };
    }
    return null;
  }

  function findWallForEdge(edge) {
    if (!edge) return null;
    const eps = 0.01;
    for (let i = 0; i < window.WALLS.length; i++) {
      const w = window.WALLS[i];
      if (!w || w.__gen_kind !== "inner") continue;
      if (!w.start || !w.end) continue;
      if (edge.orientation === "v") {
        if (Math.abs(w.start.x - edge.x) > eps || Math.abs(w.end.x - edge.x) > eps) continue;
        const y0 = Math.min(w.start.y, w.end.y);
        const y1 = Math.max(w.start.y, w.end.y);
        if (y1 < edge.start + 1 || y0 > edge.end - 1) continue;
        return w;
      } else {
        if (Math.abs(w.start.y - edge.y) > eps || Math.abs(w.end.y - edge.y) > eps) continue;
        const x0 = Math.min(w.start.x, w.end.x);
        const x1 = Math.max(w.start.x, w.end.x);
        if (x1 < edge.start + 1 || x0 > edge.end - 1) continue;
        return w;
      }
    }
    return null;
  }

  function addApertureOnWall(wall, x, y, size) {
    try {
      if (!wall || !wall.equations || !wall.equations.base) return null;
      const ang = (window.qSVG && typeof window.qSVG.angleDeg === "function")
        ? window.qSVG.angleDeg(wall.start.x, wall.start.y, wall.end.x, wall.end.y)
        : angleDeg(wall.start.x, wall.start.y, wall.end.x, wall.end.y);
      const obj = new window.editor.obj2D(
        "inWall",
        "doorWindow",
        "aperture",
        { x, y },
        ang,
        0,
        size,
        "normal",
        wall.thick
      );
      obj.limit = window.limitObj(wall.equations.base, obj.size, { x, y });
      obj.update();
      window.OBJDATA.push(obj);
      window.$ && window.$("#boxcarpentry").append(obj.graph);
      return obj;
    } catch (_) {
      return null;
    }
  }

  function addApertureDoors(rooms, shellRect, rng, meterUnits) {
    if (!rooms || rooms.length < 2) return;
    if (!window.WALLS || !window.OBJDATA || typeof window.limitObj !== "function") return;

    const doorSize = 1.0 * meterUnits; // ~1m
    const entrySize = 1.1 * meterUnits;

    // Add doors on shared edges involving living + key adjacencies.
    const requests = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const e = sharedEdge(a, b);
        if (!e) continue;
        const aTag = a.tag || "";
        const bTag = b.tag || "";
        const involvesLiving = aTag === "living" || bTag === "living";
        const isBedroomLiving = (aTag === "bedroom" && bTag === "living") || (bTag === "bedroom" && aTag === "living");
        if (involvesLiving || isBedroomLiving) {
          requests.push({ edge: e, aTag, bTag, size: doorSize });
        }
      }
    }

    // De-duplicate by orientation+coordinate (keep one door per partition segment)
    const used = new Set();
    for (let i = 0; i < requests.length; i++) {
      const r = requests[i];
      const key = r.edge.orientation === "v" ? `v:${r.edge.x.toFixed(2)}` : `h:${r.edge.y.toFixed(2)}`;
      if (used.has(key)) continue;
      used.add(key);
      const wall = findWallForEdge(r.edge);
      if (!wall) continue;

      if (r.edge.orientation === "v") {
        const y0 = Math.max(r.edge.start, Math.min(wall.start.y, wall.end.y));
        const y1 = Math.min(r.edge.end, Math.max(wall.start.y, wall.end.y));
        const yMid = y0 + (y1 - y0) * (0.35 + rng() * 0.3);
        addApertureOnWall(wall, r.edge.x, yMid, r.size);
      } else {
        const x0 = Math.max(r.edge.start, Math.min(wall.start.x, wall.end.x));
        const x1 = Math.min(r.edge.end, Math.max(wall.start.x, wall.end.x));
        const xMid = x0 + (x1 - x0) * (0.35 + rng() * 0.3);
        addApertureOnWall(wall, xMid, r.edge.y, r.size);
      }
    }

    // Add a single entry aperture on an outer wall (prefer bottom edge).
    try {
      const outerCandidates = [];
      for (let i = 0; i < window.WALLS.length; i++) {
        const w = window.WALLS[i];
        if (!w || w.__gen_kind !== "outer") continue;
        outerCandidates.push(w);
      }
      // Prefer bottom horizontal wall if present
      let entryWall = outerCandidates.find((w) => w.equations && w.equations.base && w.equations.base.A === "h" && Math.abs(w.start.y - shellRect.y2) < 0.01) || outerCandidates[0];
      if (entryWall) {
        const x0 = Math.min(entryWall.start.x, entryWall.end.x);
        const x1 = Math.max(entryWall.start.x, entryWall.end.x);
        const xMid = x0 + (x1 - x0) * (0.25 + rng() * 0.5);
        const y = entryWall.start.y;
        addApertureOnWall(entryWall, xMid, y, entrySize);
      }
    } catch (_) { }
  }

  function applyToEditorState({ walls, placedObjects, rooms, shellRect, seed }) {
    if (typeof window.resetCanvas === "function") {
      window.resetCanvas();
    } else {
      // best-effort fallback
      window.WALLS = [];
      window.OBJDATA = [];
      window.ROOM = [];
      window.$ && window.$("#boxwall").empty();
      window.$ && window.$("#boxRoom").empty();
      window.$ && window.$("#boxFurniture").empty();
    }

    // Build walls into editor WALLS
    window.WALLS = [];
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      const wallObj = new window.editor.wall(w.start, w.end, w.type || "normal", w.thick);
      wallObj.__gen_kind = w.kind || "inner";
      window.WALLS.push(wallObj);
    }

    // Build rooms via existing pipeline
    window.editor.architect(window.WALLS);

    // Apply materials
    applyRoomMaterials(rooms);

    // Place objects (furniture)
    window.OBJDATA = [];
    for (let i = 0; i < placedObjects.length; i++) {
      const p = placedObjects[i];
      const o = new window.editor.obj2D(
        "free",
        "furniture",
        p.id,
        { x: p.x, y: p.y },
        p.angle || 0,
        0,
        p.size,
        "normal",
        p.thick,
        p.value
      );
      o.update();
      window.OBJDATA.push(o);
      window.$ && window.$("#boxFurniture").append(o.graph);
    }

    // Add aperture doors on partitions + entry
    try {
      const rng = mulberry32((Number(seed) || Date.now()) >>> 0);
      const meterUnits = (typeof window.meter !== "undefined" && Number.isFinite(Number(window.meter))) ? Number(window.meter) : 60;
      addApertureDoors(rooms, shellRect, rng, meterUnits);
    } catch (_) { }

    // Normalize to natural image sizes if available
    try {
      if (typeof window.normalizeHomeObjectSizes === "function") window.normalizeHomeObjectSizes();
    } catch (_) { }

    // Save to history if available
    try {
      if (typeof window.save === "function") window.save();
    } catch (_) { }
  }

  function generate(params) {
    const objectsRaw = (params && Array.isArray(params.objects)) ? params.objects : [];
    const seed = (params && Number.isFinite(Number(params.seed))) ? Number(params.seed) : Date.now();
    const rng = mulberry32(seed);

    const meterUnits = (typeof window.meter !== "undefined" && Number.isFinite(Number(window.meter))) ? Number(window.meter) : 60;
    const thickOuter = (typeof window.wallSize !== "undefined" && Number.isFinite(Number(window.wallSize))) ? Number(window.wallSize) : 20;
    const thickInner = (typeof window.partitionSize !== "undefined" && Number.isFinite(Number(window.partitionSize)))
      ? Number(window.partitionSize)
      : Math.max(8, Math.round(thickOuter * 0.45));

    const auto = !!(params && params.auto);
    const chairCount = (params && Number.isFinite(Number(params.chairCount))) ? Number(params.chairCount) : undefined;

    const objectIdsBase = auto ? pickObjectsAuto(rng) : normalizeObjectList(objectsRaw);
    const roomAssignBase = assignObjectsToRooms(objectIdsBase);
    const programBase = buildRoomProgram(roomAssignBase.perRoom);

    // Fit into current viewBox (0..1100, 0..700) with margins.
    const margin = 80;
    const left0 = margin + (rng() * 20);
    const top0 = margin + (rng() * 20);

    // Retry placement a few times by expanding shell if key objects cannot be placed.
    const maxTries = 3;
    let final = null;
    // “TV implies chairs” (living-room TV should have seating even if user didn't tick chairs).
    const impliedChairs = (chairCount === undefined && objectIdsBase.includes("tvstand") && roomAssignBase.assignment && roomAssignBase.assignment.tvstand === "living")
      ? 2
      : undefined;
    const chairCountEffective = (chairCount !== undefined) ? chairCount : impliedChairs;

    for (let attempt = 0; attempt < maxTries; attempt++) {
      const shell = chooseShell(programBase, roomAssignBase.perRoom, rng);
      const growM = attempt * 0.5; // expand per attempt
      const shellW = (shell.wM + growM) * meterUnits;
      const shellH = (shell.hM + growM * 0.7) * meterUnits;
      const shellRect = rect(left0, top0, left0 + shellW, top0 + shellH, "shell");

      const roomRects = partitionRooms(shellRect, programBase, roomAssignBase.perRoom, meterUnits, rng);
      const roomMap = {};
      for (let i = 0; i < roomRects.length; i++) roomMap[roomRects[i].tag] = roomRects[i];

      const walls = buildWallsFromRooms(shellRect, roomRects, thickOuter, thickInner);
      const placement = placeObjectsInRooms(roomMap, objectIdsBase, roomAssignBase.assignment, shellRect, meterUnits, rng, chairCountEffective);
      const skipped = placement.skipped || [];

      // If we skipped any “core” objects, retry with larger shell.
      const core = new Set(["toilet", "sink", "countertop", "fridge", "bed", "sofa"]);
      const skippedCore = skipped.some((id) => core.has(id));
      final = {
        shellRect,
        roomRects,
        walls,
        placedObjects: placement.placed || [],
        skipped,
      };
      if (!skippedCore) break;
    }

    applyToEditorState({ walls: final.walls, placedObjects: final.placedObjects, rooms: final.roomRects, shellRect: final.shellRect, seed });

    return {
      seed,
      program: programBase,
      rooms: final.roomRects,
      objects: final.placedObjects,
      skipped: final.skipped || [],
      requested: objectIdsBase,
      assignment: roomAssignBase.assignment,
      shell: final.shellRect
    };
  }

  // --- UI glue (Generate modal) ---
  function bindUI() {
    const openBtn = document.getElementById("generate_mode");
    const modalEl = document.getElementById("generateModal");
    if (!openBtn || !modalEl) return;

    let modal;
    try { modal = new window.bootstrap.Modal(modalEl); } catch (_) { modal = null; }

    const idsEl = document.getElementById("gen_object_ids");
    const seedEl = document.getElementById("gen_seed");
    const autoEl = document.getElementById("gen_auto");
    const chairsEl = document.getElementById("gen_chairs");
    const listEl = document.getElementById("gen_object_list");
    const presetRecEl = document.getElementById("gen_preset_recommended");
    const selAllEl = document.getElementById("gen_select_all");
    const selNoneEl = document.getElementById("gen_select_none");
    const runEl = document.getElementById("gen_run");
    const clearEl = document.getElementById("gen_clear");

    function setChecked(ids, checked) {
      if (!listEl) return;
      const set = new Set(ids);
      const inputs = listEl.querySelectorAll("input[type='checkbox'][data-obj-id]");
      inputs.forEach((el) => {
        const id = el.getAttribute("data-obj-id");
        if (!id) return;
        if (checked === true) el.checked = set.has(id) || ids.length === 0;
        else if (checked === false) el.checked = false;
      });
    }

    function readChecked() {
      if (!listEl) return [];
      const out = [];
      const inputs = listEl.querySelectorAll("input[type='checkbox'][data-obj-id]");
      inputs.forEach((el) => {
        if (el.checked) {
          const id = el.getAttribute("data-obj-id");
          if (id) out.push(id);
        }
      });
      return out;
    }

    function renderObjectList() {
      if (!listEl) return;
      const objs = getAssets().slice().sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
      listEl.innerHTML = "";
      for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        if (!o || !o.id) continue;
        const row = document.createElement("label");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.padding = "4px 0";
        row.style.cursor = "pointer";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.setAttribute("data-obj-id", o.id);

        const name = document.createElement("span");
        name.textContent = o.label || o.id;
        name.style.flex = "1";

        const badge = document.createElement("span");
        badge.style.fontSize = "10px";
        badge.style.padding = "2px 6px";
        badge.style.borderRadius = "999px";
        badge.style.border = "1px solid rgba(0,0,0,0.15)";
        badge.style.opacity = "0.85";
        // Room badge mapping (real-life constraints)
        const id = o.id;
        let b = "Living";
        if (id === "toilet") b = "Bathroom";
        else if (id === "sink") b = "Bath/Kit";
        else if (id === "fridge" || id === "countertop") b = "Kitchen";
        else if (id === "bed") b = "Bedroom";
        else if (id === "tvstand") b = "Bed/Liv";
        badge.textContent = b;

        const meta = document.createElement("span");
        meta.textContent = `${o.defaultWidth || "?"}x${o.defaultHeight || "?"}`;
        meta.style.fontSize = "11px";
        meta.style.opacity = "0.65";

        row.appendChild(cb);
        row.appendChild(name);
        row.appendChild(badge);
        row.appendChild(meta);
        listEl.appendChild(row);
      }

      // Default preset (only on first render / empty state)
      setChecked(["bed", "sofa", "table", "toilet", "sink", "fridge", "countertop"], true);
    }

    // Render once; don't reset user selection on every open.
    renderObjectList();

    openBtn.addEventListener("click", function () {
      if (modal) modal.show();
      else modalEl.style.display = "block";
    });

    if (presetRecEl) presetRecEl.addEventListener("click", function () {
      setChecked(["bed", "sofa", "table", "toilet", "sink", "fridge", "countertop"], true);
    });
    if (selAllEl) selAllEl.addEventListener("click", function () {
      // ids=[] means treat as all in setChecked
      setChecked([], true);
    });
    if (selNoneEl) selNoneEl.addEventListener("click", function () {
      setChecked([], false);
    });

    function applyAutoUi() {
      const on = !!(autoEl && autoEl.checked);
      if (listEl) listEl.style.opacity = on ? "0.55" : "1";
      if (listEl) {
        const inputs = listEl.querySelectorAll("input[type='checkbox'][data-obj-id]");
        inputs.forEach((el) => { el.disabled = on; });
      }
    }
    if (autoEl) autoEl.addEventListener("change", applyAutoUi);
    applyAutoUi();

    if (clearEl) {
      clearEl.addEventListener("click", function () {
        if (typeof window.resetCanvas === "function") window.resetCanvas();
      });
    }

    if (runEl) {
      runEl.addEventListener("click", function () {
        const auto = !!(autoEl && autoEl.checked);
        const ids = auto ? [] : readChecked();
        // hidden fallback textarea (if someone enables it)
        if (!auto && ids.length === 0 && idsEl && String(idsEl.value || "").trim()) {
          const raw = String(idsEl.value || "");
          raw.split(",").map((s) => s.trim()).filter(Boolean).forEach((x) => ids.push(x));
        }
        if (!auto && ids.length === 0) {
          if (window.$) window.$("#boxinfo").html("Pick at least one object (or enable <b>Auto</b>).");
          return;
        }
        const seed = seedEl && String(seedEl.value || "").trim() ? Number(seedEl.value) : Date.now();
        const chairCount = chairsEl && String(chairsEl.value || "").trim() ? Number(chairsEl.value) : undefined;
        const res = generate({ objects: ids, seed, auto, chairCount });
        if (window.$) {
          const placedN = (res.objects || []).length;
          const reqN = (res.requested || []).length;
          const skipped = (res.skipped || []).filter(Boolean);
          const skippedMsg = skipped.length ? `<br/>Skipped: <span style='font-size:11px'>${skipped.join(", ")}</span>` : "";
          window.$("#boxinfo").html(`Generated plan (seed: <b>${res.seed}</b>)<br/>Placed: <b>${placedN}</b> / ${reqN}${skippedMsg}`);
        }
        if (modal) modal.hide();
      });
    }
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", bindUI);
  } else {
    bindUI();
  }

  window.Top2PanoFloorplanGenerator = {
    normalizeObjectList,
    inferProgram,
    getObjectSpec,
    generate,
  };
})();

