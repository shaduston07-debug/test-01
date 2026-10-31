// Photo & video import: insert a (private) photo, pick a single frame from a video, or
// import a video as animation drawings.
import { h, toast, dialog, field, switchRow, pickFile, makeCanvas, clamp } from './util.js';
import { Track } from './doc.js';
import { insertLayer } from './layers.js';

export async function insertPhoto(app, priv = false) {
  const [f] = await pickFile('image/*');
  if (f) app.insertImage(f, { private: priv });
}

function loadVideo(file) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.src = URL.createObjectURL(file);
    v.onloadeddata = () => res(v);
    v.onerror = () => rej(new Error('This video format can’t be read here'));
  });
}
const seek = (v, t) => new Promise((res) => {
  if (Math.abs(v.currentTime - t) < 1e-3 && v.readyState >= 2) return res();
  const done = () => { v.removeEventListener('seeked', done); res(); };
  v.addEventListener('seeked', done);
  v.currentTime = t;
});
function frameCanvas(v) {
  const c = makeCanvas(v.videoWidth, v.videoHeight);
  c.getContext('2d').drawImage(v, 0, 0);
  return c;
}

// Pick one frame of a video and insert it as a layer (or into the current drawing).
export async function insertVideoFrame(app) {
  const [f] = await pickFile('video/*');
  if (!f) return;
  let v;
  try { v = await loadVideo(f); } catch (e) { toast(e.message); return; }
  const preview = h('canvas', { class: 'video-preview' });
  preview.width = v.videoWidth; preview.height = v.videoHeight;
  const show = () => preview.getContext('2d').drawImage(v, 0, 0);
  show();
  let priv = false, busy = false, want = 0;
  const time = h('span', { class: 'hint' }, '0.0 s');
  const scrub = h('input', { type: 'range', min: 0, max: v.duration || 0, step: 0.01, value: '0' });
  scrub.oninput = async () => {
    want = parseFloat(scrub.value); time.textContent = want.toFixed(1) + ' s';
    if (busy) return; busy = true;
    while (true) { const t = want; await seek(v, t); show(); if (t === want) break; }
    busy = false;
  };
  const anim = app.doc.mode === 'animate';
  dialog({
    title: 'Insert from video', wide: true,
    body: h('div', {}, preview, h('div', { class: 'field' }, h('label', {}, 'Frame'), time, scrub),
      switchRow('Private (hidden from the time-lapse)', false, (x) => (priv = x)),
      anim ? h('p', { class: 'hint' }, 'To bring in the whole clip as animation drawings, use “Import video as animation”.') : null),
    actions: [{ label: 'Cancel' }, { label: 'Insert this frame', primary: true, onClick: async () => {
      await seek(v, parseFloat(scrub.value));
      await app.insertImage(frameCanvas(v), { name: f.name.replace(/\.[^.]+$/, '') + ' @' + parseFloat(scrub.value).toFixed(1) + 's', private: priv });
    } }],
    onClose: () => URL.revokeObjectURL(v.src),
  });
}

// Animation canvases: each sampled video frame becomes a drawing on a new "Video" track.
export async function importVideoAsAnimation(app) {
  const d = app.doc;
  if (d.mode !== 'animate') { toast('Open an Animate canvas to import a whole video'); return; }
  const [f] = await pickFile('video/*');
  if (!f) return;
  let v;
  try { v = await loadVideo(f); } catch (e) { toast(e.message); return; }
  const fps = d.anim.fps, dur = v.duration || 0;
  const free = Math.max(0, app.maxRaster() - d.rasterCount());
  let start = 0, end = Math.min(dur, free / fps), every = 1, priv = false;
  const count = () => Math.max(1, Math.floor(((end - start) * fps) / every));
  const info = h('p', { class: 'hint' });
  const upd = () => { info.textContent = `${count()} drawings at ${fps} fps (room for ${free} more at this canvas size)`; };
  upd();
  dialog({
    title: 'Import video as animation',
    body: h('div', {},
      field('Start', { min: 0, max: dur, step: 0.1, value: 0, fmt: (x) => x.toFixed(1) + ' s', onInput: (x) => { start = x; upd(); } }),
      field('End', { min: 0, max: dur, step: 0.1, value: end, fmt: (x) => x.toFixed(1) + ' s', onInput: (x) => { end = x; upd(); } }),
      field('Keep every Nth frame', { min: 1, max: 6, step: 1, value: 1, fmt: (x) => (x === 1 ? 'every frame' : `1 of ${x} (held ${x}×)`), onInput: (x) => { every = x; upd(); } }),
      switchRow('Private (hidden from the time-lapse)', false, (x) => (priv = x)), info),
    actions: [{ label: 'Cancel' }, { label: 'Import', primary: true, onClick: async () => {
      const n = count();
      if (n > free) { toast(`That needs ${n} drawings but there is room for ${free}. Shorten the clip or keep fewer frames.`, 4500); return false; }
      toast('Importing video…', 60000);
      const t = new Track({ name: f.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Video', private: priv });
      const s = Math.min(d.width / v.videoWidth, d.height / v.videoHeight);
      const w = v.videoWidth * s, hh = v.videoHeight * s;
      for (let i = 0; i < n; i++) {
        await seek(v, clamp(start + (i * every) / fps, 0, Math.max(0, dur - 0.001)));
        const cel = d.addCel(t, d.playhead + i * every, every);
        cel.canvas.getContext('2d').drawImage(v, (d.width - w) / 2, (d.height - hh) / 2, w, hh);
      }
      d.anim.length = Math.max(d.anim.length, d.playhead + n * every);
      insertLayer(app, t);
      app.timeline.refresh();
      URL.revokeObjectURL(v.src);
      toast(`Imported ${n} drawings`);
    } }],
  });
}
