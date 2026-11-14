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
  const root = h('div', { class: 'sk' });
  host.append(root);
  // ── search ──
  const chipsRow = (items, get, set) => {
    const el = h('div', { class: 'lx-chips' });
    const draw = () => { el.innerHTML = ''; for (const [v, label] of items) el.append(h('button', { class: get() === v ? 'on' : '', onclick: () => { set(v); draw(); run(1); } }, label)); };
    draw(); el.redraw = draw; return el;
  };
  const showRow = chipsRow([...SHOWS, ['', 'Any show'], ['★', '★ Starred']], () => st.show, (v) => { st.show = v; store.prefs.set('sakuga.show', v); });
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
  const controls = h('div', { class: 'lx-controls' }, playBtn,
    h('button', { class: 'lx-btn ghost', onclick: () => stepBy(-1) }, '◀ frame'), h('button', { class: 'lx-btn ghost', onclick: () => stepBy(1) }, 'frame ▶'), counter, speeds, fpsSel, star);
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
  const toggleStar = () => {
    const c = st.cur; if (!c) return;
    st.starred = isStar(c) ? st.starred.filter((s) => s.id !== c.id) : [{ id: c.id, url: c.url, thumb: c.thumb, artists: c.artists, shows: c.shows, tags: c.tags.slice(0, 30), page: c.page, w: c.w, h: c.h, source: c.source }, ...st.starred].slice(0, 200);
    store.prefs.set('sakuga.stars', st.starred); star.textContent = isStar(c) ? '★ Starred' : '☆ Star';
    if (st.show === '★') drawGrid();
  };
  const open = (c) => {
    st.cur = c; player.hidden = false;
    video.src = c.url; video.playbackRate = 1; for (const b of speeds.children) b.classList.toggle('on', b.textContent === '1×');
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
    const list = st.show === '★' ? st.starred : st.list;
    grid.innerHTML = '';
    for (const c of list) {
      const b = h('button', { class: 'sk-cut' + (st.cur && st.cur.id === c.id ? ' on' : ''), title: c.artists.map(pretty).join(', '), onclick: () => open(c) },
        c.thumb ? h('img', { src: c.thumb, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null, h('span', {}, c.artists.length ? pretty(c.artists[0]) : '#' + c.id));
      b.dataset.id = c.id; grid.append(b);
    }
  };
  let ticket = 0;
  async function run(page) {
    artistChip.innerHTML = '';
    if (st.artist) artistChip.append(h('span', {}, 'Artist: ', h('b', {}, pretty(st.artist))), h('button', { class: 'sk-tag', onclick: () => { st.artist = ''; run(1); } }, '× clear'));
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
      status.innerHTML = '';
      status.append('Could not reach Sakugabooru from here (' + (e.message || 'network') + '). In the iPad app it needs an internet connection; in a web browser the site may block the request. ', h('a', { href: `${base}/post?tags=${encodeURIComponent(tags)}`, target: '_blank', rel: 'noopener' }, 'Open this search on Sakugabooru'));
    }
  }
  root.append(h('div', { class: 'sk-search' }, showRow, topicRow, h('div', { class: 'sk-row' }, input, go), artistChip), player, status, grid, more,
    h('div', { class: 'lx-note' }, 'Cuts are streamed from sakugabooru.com and stay the property of their studios and animators; nothing is saved in the app. Tap an artist’s name under a cut to see more of their work.'));
  run(1);
  return () => { cancelAnimationFrame(raf); ticket++; try { video.pause(); video.removeAttribute('src'); video.load(); } catch { /* ignore */ } };
}
