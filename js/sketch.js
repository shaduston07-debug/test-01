/*
 * Pencil / stylus sketches.
 *
 * Strokes are captured with Pointer Events (pressure-sensitive with a pen),
 * stored as points, and turned into smooth filled outlines that render
 * identically on the drawing canvas and as an SVG inside the note.
 */
const Sketch = (() => {
  const W = 1000;
  const H = 625;
  const SIZES = { pen: [3, 6, 11], marker: [14, 24, 36] };
  const COLORS = ['ink', '#d9a300', '#d93a2b', '#2f6fd6', '#2f9e5b', '#8a4fd1'];

  const overlay = document.querySelector('#sketch-overlay');
  const canvas = overlay.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const hint = overlay.querySelector('.sketch-hint');
  const HINT = hint.innerHTML;

  let strokes = [];
  let undone = [];
  let current = null;
  let tool = 'pen';
  let color = 'ink';
  let sizeIndex = 1;
  let penSeen = false;   // once a pen is used, ignore touches (palm rejection)
  let resolve = null;

  /* ---------- Geometry ---------- */

  const r1 = n => Math.round(n * 10) / 10;

  function widthAt(stroke, pressure) {
    return stroke.tool === 'marker' ? stroke.size : stroke.size * (0.35 + 0.95 * pressure);
  }

  // A filled outline around the stroke's centre line, wider where pressed harder.
  function outline(stroke) {
    const pts = stroke.points;
    if (!pts.length) return '';
    if (pts.length === 1 || pts.every(p => p[0] === pts[0][0] && p[1] === pts[0][1])) {
      const [x, y, p] = pts[0];
      const r = widthAt(stroke, p) / 2;
      return `M${r1(x - r)} ${r1(y)}a${r1(r)} ${r1(r)} 0 1 0 ${r1(2 * r)} 0a${r1(r)} ${r1(r)} 0 1 0 ${r1(-2 * r)} 0Z`;
    }
    const left = [];
    const right = [];
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(i - 1, 0)];
      const next = pts[Math.min(i + 1, pts.length - 1)];
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const w = widthAt(stroke, pts[i][2]) / 2;
      left.push([pts[i][0] + nx * w, pts[i][1] + ny * w]);
      right.push([pts[i][0] - nx * w, pts[i][1] - ny * w]);
    }
    const smooth = (line, start) => {
      let d = start ? `M${r1(line[0][0])} ${r1(line[0][1])}` : `L${r1(line[0][0])} ${r1(line[0][1])}`;
      for (let i = 1; i < line.length - 1; i++) {
        const mx = (line[i][0] + line[i + 1][0]) / 2;
        const my = (line[i][1] + line[i + 1][1]) / 2;
        d += `Q${r1(line[i][0])} ${r1(line[i][1])} ${r1(mx)} ${r1(my)}`;
      }
      const last = line[line.length - 1];
      return d + `L${r1(last[0])} ${r1(last[1])}`;
    };
    const capEnd = widthAt(stroke, pts[pts.length - 1][2]) / 2;
    const capStart = widthAt(stroke, pts[0][2]) / 2;
    const rEnd = right[right.length - 1];
    return smooth(left, true) +
      `A${r1(capEnd)} ${r1(capEnd)} 0 0 0 ${r1(rEnd[0])} ${r1(rEnd[1])}` +
      smooth([...right].reverse(), false).replace(/^L[^QLA]*/, '') +
      `A${r1(capStart)} ${r1(capStart)} 0 0 0 ${r1(left[0][0])} ${r1(left[0][1])}Z`;
  }

  const opacity = s => (s.tool === 'marker' ? 0.35 : 1);

  function toSVG(list) {
    const paths = list.map(s =>
      `<path d="${outline(s)}" fill="${s.color === 'ink' ? 'currentColor' : s.color}"${s.tool === 'marker' ? ' fill-opacity="0.35"' : ''}/>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sketch">${paths}</svg>`;
  }

  // Markup for a sketch block inside a note.
  function html(list) {
    const data = JSON.stringify({ v: 1, strokes: list }).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    return `<div class="sketch" contenteditable="false" data-sketch="${data}">${toSVG(list)}</div>`;
  }

  function read(el) {
    try {
      return JSON.parse(el.dataset.sketch).strokes || [];
    } catch {
      return [];
    }
  }

  /* ---------- Canvas ---------- */

  function resize() {
    const wrap = canvas.parentElement;
    const pad = parseFloat(getComputedStyle(wrap).paddingLeft) * 2;
    const scale = Math.min((wrap.clientWidth - pad) / W, (wrap.clientHeight - pad) / H);
    const cssW = Math.floor(W * scale);
    const cssH = Math.floor(H * scale);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    redraw();
  }

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    const ink = getComputedStyle(canvas).color;
    for (const s of current ? [...strokes, current] : strokes) {
      ctx.globalAlpha = opacity(s);
      ctx.fillStyle = s.color === 'ink' ? ink : s.color;
      ctx.fill(new Path2D(outline(s)));
    }
    ctx.globalAlpha = 1;
    hint.innerHTML = HINT;
    hint.hidden = strokes.length > 0 || !!current;
  }

  function point(e) {
    const rect = canvas.getBoundingClientRect();
    // Mice and fingers report 0 or 0.5 pressure; give them a steady medium line.
    const pressure = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return [r1(((e.clientX - rect.left) / rect.width) * W), r1(((e.clientY - rect.top) / rect.height) * H), Math.round(pressure * 100) / 100];
  }

  function eraseAt(p) {
    const before = strokes.length;
    strokes = strokes.filter(s => !s.points.some(q =>
      Math.hypot(q[0] - p[0], q[1] - p[1]) < 10 + widthAt(s, q[2]) / 2));
    if (strokes.length !== before) {
      undone = [];
      redraw();
    }
  }

  let erasing = false;
  let activePointer = null;

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') penSeen = true;
    else if (e.pointerType === 'touch' && penSeen) return; // resting palm
    if (activePointer !== null) return;
    e.preventDefault();
    activePointer = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* keep drawing without capture */ }
    // The eraser end of a stylus (or its barrel button) erases.
    erasing = tool === 'eraser' || (e.buttons & 32) === 32;
    if (erasing) return eraseAt(point(e));
    current = { tool, color, size: SIZES[tool][sizeIndex], points: [point(e)] };
    redraw();
  });

  canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== activePointer) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = point(ev);
      if (erasing) {
        eraseAt(p);
        continue;
      }
      const last = current.points[current.points.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.5) continue;
      p[2] = Math.round((last[2] * 0.6 + p[2] * 0.4) * 100) / 100; // smooth pressure jitter
      current.points.push(p);
    }
    if (current) redraw();
  });

  function endStroke(e) {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    if (current) {
      strokes.push(current);
      undone = [];
      current = null;
      redraw();
    }
    erasing = false;
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);

  /* ---------- Toolbar ---------- */

  const toolButtons = overlay.querySelectorAll('[data-tool]');
  const sizeButtons = overlay.querySelectorAll('[data-size]');
  const swatches = overlay.querySelector('.swatches');

  swatches.innerHTML = COLORS.map(c =>
    `<button class="swatch" data-color="${c}" style="--swatch:${c === 'ink' ? 'var(--text)' : c}" aria-label="${c === 'ink' ? 'Ink' : c}"></button>`).join('');

  function syncToolbar() {
    toolButtons.forEach(b => b.classList.toggle('selected', b.dataset.tool === tool));
    sizeButtons.forEach(b => b.classList.toggle('selected', Number(b.dataset.size) === sizeIndex));
    swatches.querySelectorAll('.swatch').forEach(b => b.classList.toggle('selected', b.dataset.color === color));
  }

  overlay.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.tool) tool = btn.dataset.tool;
    if (btn.dataset.size) sizeIndex = Number(btn.dataset.size);
    if (btn.dataset.color) {
      color = btn.dataset.color;
      if (tool === 'eraser') tool = 'pen';
    }
    switch (btn.dataset.do) {
      case 'undo':
        if (strokes.length) undone.push(strokes.pop());
        redraw();
        break;
      case 'redo':
        if (undone.length) strokes.push(undone.pop());
        redraw();
        break;
      case 'clear':
        // Second tap clears (pop-up confirms aren't available everywhere).
        if (!strokes.length) break;
        if (!btn.classList.contains('armed')) {
          btn.classList.add('armed');
          hint.hidden = false;
          hint.textContent = 'Tap the bin again to clear the sketch';
          setTimeout(() => { btn.classList.remove('armed'); redraw(); }, 3000);
          break;
        }
        btn.classList.remove('armed');
        strokes = [];
        undone = [];
        redraw();
        break;
      case 'done':
        return close(strokes);
      case 'cancel':
        return close(null);
    }
    syncToolbar();
  });

  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') close(null);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      overlay.querySelector(`[data-do="${e.shiftKey ? 'redo' : 'undo'}"]`).click();
    }
  });

  window.addEventListener('resize', () => {
    if (!overlay.hidden) resize();
  });

  /* ---------- Open / close ---------- */

  // Resolves with the new list of strokes, or null if cancelled.
  function open(existing = []) {
    strokes = existing.map(s => ({ ...s, points: s.points.map(p => [...p]) }));
    undone = [];
    current = null;
    activePointer = null;
    erasing = false;
    overlay.hidden = false;
    document.body.classList.add('sketching');
    syncToolbar();
    resize();
    overlay.querySelector('[data-do="done"]').focus();
    return new Promise(r => { resolve = r; });
  }

  function close(result) {
    overlay.hidden = true;
    document.body.classList.remove('sketching');
    current = null;
    if (resolve) resolve(result);
    resolve = null;
  }

  return { open, html, read, toSVG };
})();
