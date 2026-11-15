// Cut study player: searches Sakugabooru (its public post API) and plays the cut straight from
// their server, with frame stepping. Nothing is downloaded or stored: only the search words and
// the ids of cuts you star are kept. Every cut shows its artist tags and links back to its page.
import { h } from '../util.js';
import * as store from '../storage.js';

export const SAKUGA = 'https://www.sakugabooru.com';
const SHOWS = [['jujutsu_kaisen', 'Jujutsu Kaisen'], ['hitori_no_shita', 'Hitori no Shita'], ['super_cube', 'Super Cube']];
const TOPICS = [['', 'Everything'], ['fighting', 'Fighting'], ['smears', 'Smears'], ['impact_frames', 'Impact frames'], ['running', 'Running'], ['hair', 'Hair'], ['fabric', 'Cloth'], ['effects', 'Effects'], ['character_acting', 'Acting']];

// GET JSON. The native app goes through Capacitor's HTTP plugin (no browser cross-origin
// limits); in a browser it is a plain fetch, which only works if the site allows it.
async function getJSON(url) {
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
    const http = cap.Plugins && cap.Plugins.CapacitorHttp;
    const r = http ? await http.get({ url, headers: { Accept: 'application/json' } }) : await cap.nativePromise('CapacitorHttp', 'request', { url, method: 'GET' });
    if (r.status && r.status >= 400) throw new Error('Sakugabooru answered ' + r.status);
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('Sakugabooru answered ' + r.status);
  return r.json();
}
// the bytes of a file, for saving a cut offline
async function getBytes(url) {
  const cap = window.Capacitor;
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
    const http = cap.Plugins && cap.Plugins.CapacitorHttp;
    const r = await (http ? http.get({ url, responseType: 'arraybuffer' }) : cap.nativePromise('CapacitorHttp', 'request', { url, method: 'GET', responseType: 'arraybuffer' }));
    if (r.status && r.status >= 400) throw new Error('answered ' + r.status);
    if (r.data instanceof ArrayBuffer) return r.data;
    const bin = atob(String(r.data)), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error('answered ' + r.status);
  return r.arrayBuffer();
}
const mime = (url) => (/\.webm(\?|$)/i.test(url) ? 'video/webm' : 'video/mp4');
const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
const isVideo = (p) => /\.(mp4|webm)(\?|$)/i.test(p.file_url || '') || ['mp4', 'webm'].includes(p.file_ext);
// posts for a tag query, with each tag's type (artist / copyright / …) when the site sends it
export async function searchCuts(tags, page = 1, base = SAKUGA) {
  const q = `${base}/post.json?api_version=2&include_tags=1&limit=24&page=${page}&tags=${encodeURIComponent(tags.trim())}`;
  const data = await getJSON(q);
  const posts = Array.isArray(data) ? data : data.posts || [], types = (!Array.isArray(data) && data.tags) || {};
  return posts.filter(isVideo).map((p) => {
    const all = String(p.tags || '').split(/\s+/).filter(Boolean);
    return {
      id: p.id, url: p.file_url, thumb: p.preview_url, w: p.width, h: p.height, source: p.source || '',
      artists: all.filter((t) => types[t] === 'artist'), shows: all.filter((t) => types[t] === 'copyright'), tags: all,
      page: `${base}/post/show/${p.id}`,
    };
  });
}
const pretty = (t) => t.replace(/_/g, ' ');

export function sakugaPlayer(host, o = {}) {
  const base = o.base || SAKUGA;
  const st = { show: store.prefs.get('sakuga.show', SHOWS[0][0]), topic: '', artist: '', text: '', page: 1, list: [], cur: null, fps: 24, starred: store.prefs.get('sakuga.stars', []) };
  // presets (lessons open the player on a show, an artist or a tag)
  if (o.show != null) st.show = o.show;
  if (o.artist) { st.artist = o.artist; if (o.show == null) st.show = ''; }
  if (o.topic) st.topic = o.topic;
  if (o.text) st.text = o.text;
  const root = h('div', { class: 'sk' });
  host.append(root);
  // ── search ──
  const chipsRow = (items, get, set) => {
    const el = h('div', { class: 'lx-chips' });
    const draw = () => { el.innerHTML = ''; for (const [v, label] of items) el.append(h('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); draw(); run(1); } }, label)); };
    draw(); el.redraw = draw; return el;
  };
  const showRow = chipsRow([...SHOWS, ['', 'Any show'], ['★', '★ Starred'], ['⬇', '⬇ Offline']], () => st.show, (v) => { st.show = v; if (v !== '⬇') store.prefs.set('sakuga.show', v); });
  const topicRow = chipsRow(TOPICS, () => st.topic, (v) => { st.topic = v; });
  const input = h('input', { class: 'text-in', placeholder: 'Artist or tag (for example an animator’s name)', value: '' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { st.text = input.value; st.artist = ''; run(1); } });
  const go = h('button', { class: 'lx-btn', onclick: () => { st.text = input.value; st.artist = ''; run(1); } }, 'Search');
  const artistChip = h('div', { class: 'sk-artist' });
  const status = h('div', { class: 'lx-note' });
  const grid = h('div', { class: 'sk-grid' });
  const more = h('button', { class: 'lx-btn ghost', hidden: true, onclick: () => run(st.page + 1) }, 'More cuts');
  // ── player ──
  const video = h('video', { class: 'sk-video', playsinline: '', 'webkit-playsinline': '', loop: '', muted: '', preload: 'metadata' });
  video.muted = true; video.loop = true; video.playsInline = true;
  const info = h('div', { class: 'sk-info' });
  const counter = h('span', { class: 'sk-count' }, '');
  const playBtn = h('button', { class: 'lx-btn', onclick: () => (video.paused ? video.play().catch(() => {}) : video.pause()) }, '▶ Play');
  const stepBy = (n) => { video.pause(); video.currentTime = Math.max(0, Math.min((video.duration || 1e9) - 0.001, video.currentTime + n / st.fps)); };
  const scrub = h('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'sk-scrub' });
  scrub.addEventListener('input', () => { if (video.duration) { video.pause(); video.currentTime = (scrub.value / 1000) * video.duration; } });
  const speeds = h('div', { class: 'lx-chips' });
  for (const [v, label] of [[1, '1×'], [0.5, '½'], [0.25, '¼'], [0.1, '⅒']]) speeds.append(h('button', { class: v === 1 ? 'on' : '', onclick: (e) => { video.playbackRate = v; for (const b of speeds.children) b.classList.toggle('on', b === e.currentTarget); } }, label));
  const fpsSel = h('div', { class: 'lx-chips' });
  for (const v of [24, 30, 12]) fpsSel.append(h('button', { class: v === 24 ? 'on' : '', title: 'Frame rate used for stepping and the counter', onclick: (e) => { st.fps = v; for (const b of fpsSel.children) b.classList.toggle('on', b === e.currentTarget); tick(); } }, v + ' fps'));
  const star = h('button', { class: 'lx-btn ghost', onclick: () => toggleStar() }, '☆ Star');
  const offBtn = h('button', { class: 'lx-btn ghost', onclick: () => toggleOffline() }, '⬇ Save offline');
  const refBtn = h('button', { class: 'lx-btn', title: 'Draw over this cut in an Animate canvas', onclick: () => useAsReference() }, '✎ Use as reference');
  const fullBtn = h('button', { class: 'lx-btn ghost', title: 'Full screen', onclick: () => { player.classList.toggle('sk-full'); fullBtn.textContent = player.classList.contains('sk-full') ? '✕ Close' : '⛶ Full screen'; } }, '⛶ Full screen');
  // like a native player: tap = play / pause, drag sideways = scrub frame by frame
  let drag = null;
  video.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, t: video.currentTime, moved: false, was: !video.paused }; video.setPointerCapture(e.pointerId); });
  video.addEventListener('pointermove', (e) => { if (!drag) return; const dx = e.clientX - drag.x; if (!drag.moved && Math.abs(dx) < 8) return; drag.moved = true; video.pause(); const fr = Math.round(dx / 9); video.currentTime = Math.max(0, Math.min((video.duration || 1e9) - 0.001, drag.t + fr / st.fps)); });
  const endDrag = () => { if (!drag) return; if (!drag.moved) (video.paused ? video.play().catch(() => {}) : video.pause()); drag = null; };
  video.addEventListener('pointerup', endDrag); video.addEventListener('pointercancel', () => { drag = null; });
  const onKey = (e) => { if (player.hidden || !root.isConnected || /INPUT|TEXTAREA/.test(e.target.tagName)) return; if (e.key === ' ') { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); } else if (e.key === ',' || e.key === 'ArrowLeft') stepBy(-1); else if (e.key === '.' || e.key === 'ArrowRight') stepBy(1); };
  window.addEventListener('keydown', onKey);
  const controls = h('div', { class: 'lx-controls' }, playBtn,
    h('button', { class: 'lx-btn ghost', onclick: () => stepBy(-1) }, '◀ frame'), h('button', { class: 'lx-btn ghost', onclick: () => stepBy(1) }, 'frame ▶'), counter, speeds, fpsSel, star, offBtn, refBtn, fullBtn);
  const player = h('div', { class: 'sk-player', hidden: true }, video, scrub, controls, info);
  const tick = () => {
    const f = Math.floor(video.currentTime * st.fps + 0.001) + 1, tot = video.duration ? Math.round(video.duration * st.fps) : 0;
    counter.textContent = tot ? `frame ${Math.min(f, tot)} / ${tot}` : '';
    if (video.duration && document.activeElement !== scrub) scrub.value = Math.round((video.currentTime / video.duration) * 1000);
  };
  for (const ev of ['timeupdate', 'seeked', 'loadedmetadata']) video.addEventListener(ev, tick);
  video.addEventListener('play', () => { playBtn.textContent = '❚❚ Pause'; }); video.addEventListener('pause', () => { playBtn.textContent = '▶ Play'; });
  video.addEventListener('error', () => { if (st.cur) info.prepend(h('div', { class: 'sk-err' }, 'This cut would not play here. ', h('a', { href: st.cur.page, target: '_blank', rel: 'noopener' }, 'Open it on Sakugabooru'))); });
  let raf = 0; const loopTick = () => { if (!video.paused) tick(); raf = requestAnimationFrame(loopTick); }; raf = requestAnimationFrame(loopTick);
  const isStar = (c) => st.starred.some((s) => s.id === c.id);
  const saved = (c) => { const s2 = st.starred.find((q) => q.id === c.id); return !!(s2 && s2.offline); };
  const keep = (c, extra = {}) => ({ id: c.id, url: c.url, thumb: c.thumb, artists: c.artists, shows: c.shows, tags: c.tags.slice(0, 30), page: c.page, w: c.w, h: c.h, source: c.source, offline: !!c.offline, size: c.size || 0, ...extra });
  const setStars = (list) => { st.starred = list.slice(0, 400); store.prefs.set('sakuga.stars', st.starred); };
  const thumbs = new Map(); // object URLs of saved thumbnails
  const offlineLabel = () => { const c = st.cur; offBtn.textContent = c && saved(c) ? '✓ Offline · remove' : '⬇ Save offline'; };
  // ── use the cut as a reference in an Animate canvas ──
  async function cutBlob(c) {
    if (saved(c)) { const rec = await store.getCut('cut:' + c.id).catch(() => null); if (rec && rec.bytes) return new Blob([rec.bytes], { type: rec.type || 'video/mp4' }); }
    return new Blob([await getBytes(c.url)], { type: mime(c.url) });
  }
  async function useAsReference() {
    const c = st.cur, A = window.inkwell; if (!c || !A || refBtn.dataset.busy) return;
    const name = (c.artists[0] ? pretty(c.artists[0]) : c.shows[0] ? pretty(c.shows[0]) : 'cut') + ' #' + c.id;
    const go = async (intoOpen) => {
      refBtn.dataset.busy = '1'; refBtn.textContent = 'Loading…';
      try {
        video.pause();
        const blob = await cutBlob(c);
        if (!intoOpen) {
          const { Doc } = await import('../doc.js');
          const k = Math.min(1, 1920 / (c.w || 1920)), W = Math.round((c.w || 1920) * k) || 1920, H = Math.round((c.h || 1080) * k) || 1080;
          const d = Doc.create({ name: 'Study · ' + name, mode: 'animate', width: W - (W % 2), height: H - (H % 2) });
          d.anim.fps = st.fps;
          o.onLeave && o.onLeave();
          await A.openDoc(d);
        }
        const Media = await import('../media.js');
        await Media.importVideoBlob(A, blob, name, { reference: true });
      } catch (e) { status.textContent = 'Could not load this cut (' + (e.message || 'network') + '). Save it offline first, or check the connection.'; }
      delete refBtn.dataset.busy; refBtn.textContent = '✎ Use as reference';
    };
    const open = A.doc && A.doc.mode === 'animate' && !document.querySelector('#studio').hidden;
    if (!open) return go(false);
    const { dialog } = await import('../util.js');
    dialog({ title: 'Use as reference', body: h('p', {}, `Add “${name}” as a reference track to “${A.doc.name}”, or start a new animation canvas sized to the cut?`), actions: [
      { label: 'Cancel' }, { label: 'New canvas', onClick: () => { go(false); } }, { label: 'Add to this canvas', primary: true, onClick: () => { go(true); } }] });
  }
  async function toggleOffline() {
    const c = st.cur; if (!c || offBtn.dataset.busy) return;
    if (saved(c)) {
      await store.deleteCut('cut:' + c.id).catch(() => {});
      setStars(st.starred.map((q) => (q.id === c.id ? { ...q, offline: false, size: 0 } : q)));
      c.offline = false; offlineLabel(); usage(); if (st.show === '⬇') drawGrid();
      return;
    }
    offBtn.dataset.busy = '1'; offBtn.textContent = 'Saving…';
    try {
      const bytes = await getBytes(c.url);
      let thumb = null; if (c.thumb) { try { thumb = await getBytes(c.thumb); } catch { /* no thumbnail offline */ } }
      await store.putCut({ id: 'cut:' + c.id, bytes, type: mime(c.url), thumb, added: Date.now() });
      c.offline = true; c.size = bytes.byteLength;
      setStars([keep(c, { offline: true, size: bytes.byteLength }), ...st.starred.filter((q) => q.id !== c.id)]);
      star.textContent = '★ Starred'; status.textContent = `Saved for offline (${mb(bytes.byteLength)}). It now plays without internet.`;
      store.requestPersistence && store.requestPersistence();
    } catch (e) {
      status.textContent = 'Could not save this cut (' + (e.message || 'network') + '). Saving needs the iPad app and an internet connection.';
    }
    delete offBtn.dataset.busy; offlineLabel(); usage();
  }
  const useNote = h('div', { class: 'sk-dim sk-usage' });
  function usage() { const off = st.starred.filter((q) => q.offline), n = off.reduce((a, q) => a + (q.size || 0), 0); useNote.textContent = off.length ? `${off.length} cut${off.length === 1 ? '' : 's'} saved offline · ${mb(n)} on this device` : ''; }
  let objUrl = null;
  const toggleStar = () => {
    const c = st.cur; if (!c) return;
    if (isStar(c) && saved(c)) { status.textContent = 'This cut is saved offline: remove the offline copy first.'; return; }
    setStars(isStar(c) ? st.starred.filter((q) => q.id !== c.id) : [keep(c), ...st.starred]);
    star.textContent = isStar(c) ? '★ Starred' : '☆ Star';
    if (st.show === '★') drawGrid();
  };
  const open = (c) => {
    st.cur = c; player.hidden = false;
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    video.src = c.url;
    if (saved(c)) store.getCut('cut:' + c.id).then((rec) => { if (rec && rec.bytes && st.cur === c) { objUrl = URL.createObjectURL(new Blob([rec.bytes], { type: rec.type || 'video/mp4' })); video.src = objUrl; video.play().catch(() => {}); } }).catch(() => {});
    offlineLabel();
    video.playbackRate = 1; for (const b of speeds.children) b.classList.toggle('on', b.textContent === '1×');
    video.play().catch(() => {});
    star.textContent = isStar(c) ? '★ Starred' : '☆ Star';
    info.innerHTML = '';
    const artistBtns = c.artists.length ? c.artists.map((a) => h('button', { class: 'sk-tag artist', title: 'More cuts by this artist', onclick: () => { st.artist = a; st.text = ''; input.value = ''; st.show = ''; showRow.redraw(); run(1); } }, pretty(a))) : [h('span', { class: 'sk-dim' }, 'artist not tagged')];
    info.append(h('div', {}, h('b', {}, 'Animation: '), ...artistBtns),
      h('div', {}, h('b', {}, 'From: '), h('span', {}, c.shows.map(pretty).join(', ') || '—'), ' · ', h('a', { href: c.page, target: '_blank', rel: 'noopener' }, 'Open on Sakugabooru #' + c.id)),
      h('div', { class: 'sk-tags' }, ...c.tags.filter((t) => !c.artists.includes(t) && !c.shows.includes(t)).slice(0, 14).map((t) => h('button', { class: 'sk-tag', onclick: () => { st.text = t; input.value = t; st.artist = ''; run(1); } }, pretty(t)))));
    player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    for (const b of grid.children) b.classList.toggle('on', b.dataset.id === String(c.id));
  };
  const drawGrid = () => {
    const list = st.show === '★' ? st.starred : st.show === '⬇' ? st.starred.filter((q) => q.offline) : st.list;
    grid.innerHTML = '';
    for (const c of list) {
      const b = h('button', { class: 'sk-cut' + (st.cur && st.cur.id === c.id ? ' on' : ''), title: c.artists.map(pretty).join(', '), onclick: () => open(c) },
        c.thumb ? h('img', { src: thumbs.get(c.id) || c.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null, h('span', {}, (saved(c) ? '⬇ ' : '') + (c.artists.length ? pretty(c.artists[0]) : '#' + c.id)));
      b.dataset.id = c.id; grid.append(b);
      // saved cuts show their saved thumbnail (works with no connection)
      if (saved(c) && !thumbs.has(c.id)) store.getCut('cut:' + c.id).then((rec) => { if (!rec || !rec.thumb) return; const u = URL.createObjectURL(new Blob([rec.thumb])); thumbs.set(c.id, u); const im = b.querySelector('img'); if (im) im.src = u; else b.prepend(h('img', { src: u, alt: '' })); }).catch(() => {});
    }
  };
  let ticket = 0;
  async function run(page) {
    artistChip.innerHTML = '';
    if (st.artist) artistChip.append(h('span', {}, 'Artist: ', h('b', {}, pretty(st.artist))), h('button', { class: 'sk-tag', onclick: () => { st.artist = ''; run(1); } }, '× clear'));
    if (st.show === '⬇') { more.hidden = true; const n = st.starred.filter((q) => q.offline).length; status.textContent = n ? `${n} cut${n === 1 ? '' : 's'} saved on this device: they play without internet.` : 'Nothing saved yet: open a cut and tap ⬇ Save offline.'; drawGrid(); return; }
    if (st.show === '★') { more.hidden = true; status.textContent = st.starred.length ? `${st.starred.length} starred cut${st.starred.length === 1 ? '' : 's'}` : 'No starred cuts yet: open a cut and tap ☆ Star.'; drawGrid(); return; }
    // tapping an artist switches to "Any show"; picking a show afterwards narrows it again
    const tags = [st.show, st.artist, st.topic, st.text.trim().toLowerCase().replace(/\s+/g, '_')].filter(Boolean).join(' ');
    const my = ++ticket; st.page = page;
    status.textContent = 'Searching Sakugabooru…'; more.hidden = true;
    if (page === 1) { st.list = []; drawGrid(); }
    try {
      const got = await searchCuts(tags, page, base);
      if (my !== ticket) return;
      st.list = page === 1 ? got : st.list.concat(got);
      status.textContent = st.list.length ? `${st.list.length} cut${st.list.length === 1 ? '' : 's'} for “${pretty(tags) || 'everything'}” · tap one to play` : `No cuts found for “${pretty(tags)}”. Try another tag, or check the spelling on the site.`;
      more.hidden = got.length < 12;
      drawGrid();
    } catch (e) {
      if (my !== ticket) return;
      if (st.starred.some((q) => q.offline)) { st.show = '⬇'; showRow.redraw(); drawGrid(); status.textContent = 'No connection to Sakugabooru: showing the cuts saved on this device.'; return; }
      status.innerHTML = '';
      status.append('Could not reach Sakugabooru from here (' + (e.message || 'network') + '). In the iPad app it needs an internet connection; in a web browser the site may block the request. ', h('a', { href: `${base}/post?tags=${encodeURIComponent(tags)}`, target: '_blank', rel: 'noopener' }, 'Open this search on Sakugabooru'));
    }
  }
  usage();
  root.append(h('div', { class: 'sk-search' }, showRow, topicRow, h('div', { class: 'sk-row' }, input, go), artistChip), player, status, grid, more, useNote,
    h('div', { class: 'lx-note' }, 'Cuts are streamed from sakugabooru.com and stay the property of their studios and animators. ⬇ Save offline keeps a copy on this device for your own study. Tap the video to play or pause, drag across it to scrub frame by frame, and tap an artist’s name to see more of their work.'));
  if (!navigator.onLine && st.starred.some((q) => q.offline)) st.show = '⬇', showRow.redraw();
  run(1);
  return () => { cancelAnimationFrame(raf); ticket++; window.removeEventListener('keydown', onKey); if (objUrl) URL.revokeObjectURL(objUrl); for (const u of thumbs.values()) URL.revokeObjectURL(u); try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* ignore */ } };
}
