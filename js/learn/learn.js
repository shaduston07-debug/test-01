// Inkwell Learning — the "Learning" tab: tracks → courses → lessons, with live demos, quizzes,
// challenges that open a ready-made canvas in the Studio, sources, and saved progress.
import { $, $$, h, toast, confirmDialog } from '../util.js';
import { ICONS } from '../icons.js';
import { Doc, Layer, Track } from '../doc.js';
import { touch } from '../history.js';
import * as store from '../storage.js';
import * as UI from '../ui.js';
import { presetGuide, fitGuide } from '../perspective.js';
import { TRACKS, COURSES, findLesson } from './courses.js';
import { DEMOS } from './demos.js';
import { ART } from './art.js';
import { GUIDE_FOR, kindInfo, levelsOf, drawGuideInto } from './exercises.js';

let app = null;
let cleanups = [];
const P = () => store.prefs.get('learn.progress', { done: {}, quiz: {}, challenges: {}, last: null });
const saveP = (p) => store.prefs.set('learn.progress', p);
const key = (c, l) => c + '/' + l;
// CSS custom properties can't be set through style objects
const withC = (color, el) => { el.style.setProperty('--c', color); return el; };

function stopDemos() { for (const f of cleanups) { try { f && f(); } catch { /* ignore */ } } cleanups = []; }

export function initLearning(a) {
  app = a;
  for (const b of $$('.app-tab')) b.addEventListener('click', () => showTab(b.dataset.tab));
  for (const b of $$('.app-tab[data-tab="learn"] .at-ico')) b.innerHTML = ICONS.learn;
  showTab(store.prefs.get('learn.tab', 'studio'), true);
}

// 'studio' (the gallery) or 'learn'
export function showTab(tab, quiet = false) {
  store.prefs.set('learn.tab', tab);
  for (const b of $$('.app-tab')) b.classList.toggle('on', b.dataset.tab === tab);
  if (app && app.doc) return; // a canvas is open: the tab applies when you go back
  $('#gallery').hidden = tab !== 'studio';
  $('#learning').hidden = tab !== 'learn';
  if (tab === 'learn') { if (!$('#learn-body').childElementCount || !quiet) route(currentRoute); }
  else stopDemos();
}
export const currentTab = () => store.prefs.get('learn.tab', 'studio');

let currentRoute = store.prefs.get('learn.route', { view: 'home' });
function route(r) {
  currentRoute = r; store.prefs.set('learn.route', r);
  stopDemos();
  const body = $('#learn-body');
  body.innerHTML = '';
  $('#learning').scrollTop = 0;
  if (r.view === 'course') renderCourse(body, r.course);
  else if (r.view === 'lesson') renderLesson(body, r.course, r.lesson);
  else renderHome(body);
}

function courseProgress(c, p = P()) {
  const n = c.lessons.length, d = c.lessons.filter((l) => p.done[key(c.id, l.id)]).length;
  return { n, d, pct: n ? d / n : 0 };
}
const bar = (pct, color) => h('div', { class: 'ln-bar' }, h('i', { style: { width: Math.round(pct * 100) + '%', background: color || 'var(--accent)' } }));

// Same layout as the Studio start screen: the three mode cards on top choose Illustrate /
// Animate / Webtoon, and the lessons below are picture cards like your canvases.
const TRACK_UI = { illustration: ['paint', 'Illustrate', 'Perspective, backgrounds, faces, colour'], animation: ['anim', 'Animate', 'Timing, motion, walk cycles, colouring'], webtoon: ['toon', 'Webtoon', 'Panels, dialogue, colour, publishing'] };
const lessonThumb = (c, l) => {
  const b = l && l.body.find((x) => x && x.art);
  if (b) return ART[b.art[0]] && ART[b.art[0]].src;
  for (const x of c.lessons) { const a = x.body.find((y) => y && y.art); if (a && ART[a.art[0]]) return ART[a.art[0]].src; }
  return '';
};
function renderHome(body) {
  const p = P();
  const track = store.prefs.get('learn.track', 'illustration');
  const last = p.last && findLesson(p.last.course, p.last.lesson);
  body.append(h('header', { class: 'gal-head' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }), 'Inkwell ', h('em', {}, 'Learning')),
    h('div', { class: 'gal-actions glass' },
      last && last.lesson ? h('button', { class: 'pill primary', onclick: () => route({ view: 'lesson', course: last.course.id, lesson: last.lesson.id }) }, '▶ Continue: ' + last.lesson.title) : null,
      h('button', { class: 'pill', onclick: creditsDialog }, 'Credits'))));
  const modes = h('div', { class: 'gal-modes' });
  for (const t of TRACKS) {
    const [ico, name, sub] = TRACK_UI[t.id];
    const cs = COURSES.filter((c) => c.track === t.id), n = cs.reduce((a, c) => a + c.lessons.length, 0), d = cs.reduce((a, c) => a + courseProgress(c, p).d, 0);
    modes.append(h('button', { class: 'mode-card' + (t.id === track ? ' on' : ''), onclick: () => { store.prefs.set('learn.track', t.id); route({ view: 'home' }); } },
      h('span', { class: 'mc-ico ' + ico }), h('b', {}, name), h('small', {}, `${sub} · ${d}/${n} done`)));
  }
  body.append(modes);
  const used = new Set();
  for (const c of COURSES.filter((x) => x.track === track)) {
    const pr = courseProgress(c, p);
    const head = withC(c.color, h('div', { class: 'ln-course-row' },
      h('div', {}, h('h2', {}, c.title), h('p', {}, c.blurb)),
      h('div', { class: 'ln-course-prog' }, h('small', {}, `${pr.d} of ${pr.n} done`), bar(pr.pct, c.color))));
    const grid = h('div', { class: 'gal-grid ln-lesson-grid' });
    c.lessons.forEach((l, i) => {
      const done = !!p.done[key(c.id, l.id)];
      const own = l.body.find((x) => x && x.art), url = own && ART[own.art[0]] ? ART[own.art[0]].src : '';
      const fresh = url && !used.has(url); if (fresh) used.add(url);
      const kind = GUIDE_FOR[key(c.id, l.id)];
      const thumb = h('button', { class: 'gal-thumb ln-thumb', onclick: () => route({ view: 'lesson', course: c.id, lesson: l.id }) },
        fresh ? h('img', { src: url, alt: '', loading: 'lazy' }) : kind ? exercisePreview(c, l, kind) : null,
        h('span', { class: 'ln-thumb-num' }, done ? '✓' : String(i + 1)));
      withC(c.color, thumb);
      grid.append(h('div', { class: 'gal-card' + (done ? ' ln-done' : '') }, thumb,
        h('div', { class: 'gal-meta' }, h('b', {}, l.title), h('span', { class: 'badge' }, done ? '✓ Done' : `${l.min} min`)),
        h('small', { class: 'hint' }, `Lesson ${i + 1} · try it · quiz · 4 exercises`)));
    });
    const capDone = !!p.challenges[key(c.id, 'capstone')];
    const capThumb = withC(c.color, h('button', { class: 'gal-thumb ln-thumb ln-cap-thumb', onclick: () => route({ view: 'course', course: c.id }) }, h('span', {}, '★'), h('b', {}, 'Final project')));
    grid.append(h('div', { class: 'gal-card' }, capThumb, h('div', { class: 'gal-meta' }, h('b', {}, c.capstone.title.replace('Capstone: ', '')), h('span', { class: 'badge' }, capDone ? '✓ Done' : 'Project')), h('small', { class: 'hint' }, 'Use it on your own idea')));
    body.append(h('section', { class: 'ln-course-sec' }, head, grid));
  }
  body.append(h('div', { class: 'ln-foot' },
    h('p', {}, 'The lessons follow long-established, human-made teaching (Loomis, Drawabox, Ctrl+Paint, Gurney, Ekman, The Illusion of Life, The Animator\'s Survival Kit, McCloud, Blambot, WEBTOON\'s creator guides). Example artwork is real: public-domain masters and Pepper&Carrot by David Revoy (CC BY 4.0). No AI-generated pictures.'),
    h('button', { class: 'pill', onclick: async () => { if (await confirmDialog('Reset all Learning progress?', 'Reset', true)) { saveP({ done: {}, quiz: {}, challenges: {}, last: null }); route({ view: 'home' }); } } }, 'Reset progress')));
}

// a small picture of the lesson's first guided exercise (used when the lesson has no artwork of its own)
function exercisePreview(c, l, kind) {
  const W = 960, H = 720, cv = h('canvas', { class: 'ln-thumb-prev' }); cv.width = 480; cv.height = 360;
  const s = l.challenge.studio || {};
  const fake = { width: W, height: H, mode: s.mode || 'paint', anim: { length: s.len || 48 }, persp: null };
  if (s.persp) presetGuide(fake, s.persp.type, { horizon: s.persp.horizon });
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  drawGuideInto(tmp, fake, kind, 0).then(() => { const x = cv.getContext('2d'); x.fillStyle = '#fbfaf7'; x.fillRect(0, 0, 480, 360); x.drawImage(tmp, 0, 0, 480, 360); }).catch(() => {});
  return cv;
}
function backBar(c, extra) {
  const [, name] = TRACK_UI[c.track];
  return h('div', { class: 'ln-backbar' },
    h('button', { class: 'pill', onclick: () => { store.prefs.set('learn.track', c.track); route({ view: 'home' }); } }, '‹ ' + name),
    h('span', { class: 'ln-backbar-title' }, c.title), extra || null);
}
function crumbs(...parts) {
  return h('div', { class: 'ln-crumbs' }, ...parts.flatMap((p, i) => [i ? h('span', {}, '›') : null, p.go ? h('button', { onclick: p.go }, p.label) : h('b', {}, p.label)]));
}

function renderCourse(body, cid) {
  const c = COURSES.find((x) => x.id === cid); if (!c) return route({ view: 'home' });
  const p = P(), pr = courseProgress(c, p);
  const track = TRACKS.find((t) => t.id === c.track);
  body.append(backBar(c));
  body.append(withC(c.color, h('div', { class: 'ln-course-head' },
    h('h1', {}, c.title), h('p', {}, c.blurb),
    h('div', { class: 'ln-outcome' }, h('b', {}, 'By the end of this course: '), c.outcome),
    bar(pr.pct, c.color), h('small', {}, `${pr.d} of ${pr.n} lessons done`))));
  const list = h('ol', { class: 'ln-lessons' });
  c.lessons.forEach((l, i) => {
    const done = !!p.done[key(c.id, l.id)], ch = !!p.challenges[key(c.id, l.id)];
    list.append(h('li', {}, h('button', { class: done ? 'done' : '', onclick: () => route({ view: 'lesson', course: c.id, lesson: l.id }) },
      h('span', { class: 'ln-num', style: done ? { background: c.color, color: '#111' } : {} }, done ? '✓' : String(i + 1)),
      h('div', {}, h('b', {}, l.title), h('small', {}, `${l.min} min · demo · ${l.quiz.length}-question quiz · challenge${ch ? ' ✓' : ''}`)),
      h('span', { class: 'ln-go' }, '›'))));
  });
  body.append(list);
  // capstone
  const cap = c.capstone, capDone = !!p.challenges[key(c.id, 'capstone')];
  body.append(withC(c.color, h('div', { class: 'ln-capstone' },
    h('small', {}, 'FINAL PROJECT'), h('h2', {}, cap.title), h('p', {}, cap.text),
    h('div', { class: 'ln-ideas' }, h('b', {}, 'Ideas to apply it to: '), cap.ideas.join(' · ')),
    h('div', { class: 'ln-row' },
      h('button', { class: 'pill primary', onclick: () => openChallenge(c, { id: 'capstone', title: cap.title }, { title: cap.title, text: cap.text, steps: ['Plan with thumbnails first.', 'Use the lessons\' exercises as your checklist.', 'Make it about YOUR idea.'], studio: cap.studio }) }, 'Start in the Studio'),
      h('button', { class: 'pill' + (capDone ? ' on' : ''), onclick: () => { const q = P(); q.challenges[key(c.id, 'capstone')] = !capDone; saveP(q); route(currentRoute); } }, capDone ? '✓ Finished' : 'Mark as finished')))));
}

function renderLesson(body, cid, lid) {
  const { course: c, lesson: l } = findLesson(cid, lid);
  if (!c || !l) return route({ view: 'home' });
  const p = P(); p.last = { course: cid, lesson: lid }; saveP(p);
  const idx = c.lessons.indexOf(l), track = TRACKS.find((t) => t.id === c.track);
  const jump = (id) => () => { const el = document.getElementById(id); el && el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  body.append(backBar(c, h('div', { class: 'ln-steps' },
    h('button', { onclick: jump('ln-s-learn') }, '1 Learn'), h('button', { onclick: jump('ln-s-quiz') }, '2 Quiz'), h('button', { class: 'go', onclick: jump('ln-s-practise') }, '3 Practise'))));
  const art = h('article', { class: 'ln-lesson' }); art.style.setProperty('--c', c.color);
  art.append(h('small', { class: 'ln-kicker', id: 'ln-s-learn' }, `Lesson ${idx + 1} of ${c.lessons.length} · ${l.min} min`), h('h1', {}, l.title));
  for (const b of l.body) {
    if (typeof b === 'string') { art.append(h('div', { class: 'ln-text', html: b })); continue; }
    if (b.art) { art.append(gallery(b)); continue; }
    const fig = h('figure', { class: 'ln-demo' });
    const host = h('div', { class: 'ln-demo-host' });
    fig.append(h('div', { class: 'ln-demo-tag' }, '● INTERACTIVE'), host);
    if (b.caption) fig.append(h('figcaption', {}, b.caption));
    art.append(fig);
    try { const f = DEMOS[b.demo] && DEMOS[b.demo](host); cleanups.push(f); } catch (e) { console.error(e); host.textContent = 'This demo could not start: ' + e.message; }
  }
  // key takeaways
  art.append(h('div', { class: 'ln-keys' }, h('b', {}, 'Remember'), h('ul', {}, ...l.keys.map((k) => h('li', {}, k)))));
  // quiz
  const qz = quiz(c, l); qz.id = 'ln-s-quiz'; art.append(qz);
  // challenge
  const ch = l.challenge, chDone = !!p.challenges[key(c.id, l.id)];
  const kind = GUIDE_FOR[key(c.id, l.id)], reached = (p.levels && p.levels[key(c.id, l.id)]) || 0;
  art.append(h('div', { class: 'ln-challenge', id: 'ln-s-practise' },
    h('small', {}, 'PRACTISE IN THE STUDIO'), h('h2', {}, ch.title), h('p', {}, ch.text),
    kind ? h('div', { class: 'ln-ladder' }, ...levelsOf(kind).map((name, i) => h('button', { class: 'ln-rung' + (i < reached ? ' done' : '') + (i === Math.min(reached, 3) ? ' next' : ''), onclick: () => openChallenge(c, l, ch, i) },
      h('span', {}, i < reached ? '✓' : String(i + 1)), h('b', {}, name), h('small', {}, kindInfo(kind).tips[i].split('. ')[0].replace(/\.$/, '') + '.')))) : h('ol', {}, ...ch.steps.map((s) => h('li', {}, s))),
    kind ? h('p', { class: 'hint' }, 'Each exercise opens with its help drawn right in the canvas, on a locked Guide layer. Every next exercise takes some help away, until you draw it on your own.') : null,
    h('div', { class: 'ln-row' },
      h('button', { class: 'pill primary', onclick: () => openChallenge(c, l, ch, kind ? Math.min(reached, 3) : 0) }, kind ? (reached ? `Continue: exercise ${Math.min(reached, 3) + 1}` : 'Start exercise 1') : 'Practise in the Studio'),
      h('button', { class: 'pill' + (chDone ? ' on' : ''), onclick: () => { const q = P(); q.challenges[key(c.id, l.id)] = !chDone; saveP(q); route(currentRoute); } }, chDone ? '✓ Challenge done' : 'Mark challenge done'))));
  // sources
  art.append(h('div', { class: 'ln-sources' }, h('b', {}, 'Sources & further study'),
    h('ul', {}, ...l.sources.map(([label, url]) => h('li', {}, url ? h('a', { href: url, target: '_blank', rel: 'noopener' }, label) : h('span', {}, label + ' (book)'))))));
  // nav
  const prev = c.lessons[idx - 1], next = c.lessons[idx + 1];
  const done = !!p.done[key(c.id, l.id)];
  art.append(h('div', { class: 'ln-nav' },
    prev ? h('button', { class: 'pill', onclick: () => route({ view: 'lesson', course: c.id, lesson: prev.id }) }, '‹ ' + prev.title) : h('span'),
    h('button', { class: 'pill' + (done ? ' on' : ' primary'), onclick: () => { const q = P(); if (done) delete q.done[key(c.id, l.id)]; else q.done[key(c.id, l.id)] = Date.now(); saveP(q); if (!done && next) route({ view: 'lesson', course: c.id, lesson: next.id }); else route(currentRoute); } }, done ? '✓ Completed' : next ? 'Complete & next ›' : 'Complete course ✓'),
    next ? h('button', { class: 'pill', onclick: () => route({ view: 'lesson', course: c.id, lesson: next.id }) }, next.title + ' ›') : h('button', { class: 'pill', onclick: () => route({ view: 'course', course: c.id }) }, 'Final project ›')));
  body.append(art);
}

// real artwork (public domain / CC0 / CC BY), with credits; tap to see it large
const credit = (a) => `${a.artist}${a.year ? ', ' + a.year : ''} · ${a.license}`;
function gallery(b) {
  const items = b.art.map((id) => [id, ART[id]]).filter(([, a]) => a);
  const fig = h('figure', { class: 'ln-art' + (items.length === 1 ? ' one' : '') });
  const grid = h('div', { class: 'ln-art-grid' });
  items.forEach(([id, a], i) => {
    const note = b.notes && b.notes[id];
    grid.append(h('button', { class: 'ln-art-item', onclick: () => lightbox(items, i, b.notes) },
      h('img', { src: a.src, alt: a.title, loading: 'lazy' }),
      h('span', { class: 'ln-art-cap' }, h('b', {}, a.title), h('small', {}, credit(a))),
      note ? h('span', { class: 'ln-art-note' }, note) : null));
  });
  fig.append(h('div', { class: 'ln-art-tag' }, '◆ STUDY REAL ARTWORK'), grid);
  if (b.caption) fig.append(h('figcaption', {}, b.caption));
  return fig;
}
function lightbox(items, i, notes) {
  const box = h('div', { class: 'ln-lightbox', onclick: (e) => { if (e.target === box) close(); } });
  const img = h('img'), cap = h('div', { class: 'ln-lb-cap' });
  const show = () => {
    const [id, a] = items[i];
    img.src = a.src; img.alt = a.title;
    cap.innerHTML = '';
    cap.append(h('b', {}, a.title), h('span', {}, credit(a) + ' · '), h('a', { href: a.page, target: '_blank', rel: 'noopener' }, 'source'),
      notes && notes[id] ? h('p', {}, notes[id]) : null);
  };
  const close = () => { box.remove(); removeEventListener('keydown', key); };
  const go = (d) => { i = (i + d + items.length) % items.length; show(); };
  const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); };
  addEventListener('keydown', key);
  box.append(h('button', { class: 'ln-lb-x', onclick: close }, '×'), img, cap);
  if (items.length > 1) box.append(h('button', { class: 'ln-lb-prev', onclick: () => go(-1) }, '‹'), h('button', { class: 'ln-lb-next', onclick: () => go(1) }, '›'));
  document.body.append(box);
  show();
}
function creditsDialog() {
  const list = h('div', { class: 'ln-credits' }, h('p', {}, 'Lesson artwork is real, human-made art used under its licence: public domain or CC0 (Wikimedia Commons and The Metropolitan Museum of Art open access) and Pepper&Carrot by David Revoy, licensed CC BY 4.0. Every demo is drawn by the app itself.'),
    ...Object.values(ART).map((a) => h('div', {}, h('b', {}, a.title), ' — ', credit(a), ' · ', h('a', { href: a.page, target: '_blank', rel: 'noopener' }, 'source'))));
  import('../util.js').then(({ dialog }) => dialog({ title: 'Artwork credits', body: list, wide: true, actions: [{ label: 'Close', primary: true }] }));
}

function quiz(c, l) {
  const box = h('div', { class: 'ln-quiz' }, h('b', {}, 'Check yourself'));
  let right = 0, answered = 0;
  const score = h('div', { class: 'ln-quiz-score' });
  l.quiz.forEach((q, qi) => {
    const fb = h('div', { class: 'ln-fb' });
    // shuffle answers once per render so the right one isn't always first
    const order = q.a.map((_, i) => i).sort(() => Math.random() - 0.5);
    const opts = h('div', { class: 'ln-opts' });
    let locked = false;
    for (const i of order) {
      const b = h('button', {}, q.a[i]);
      b.onclick = () => {
        if (locked) return;
        if (i === q.c) {
          locked = true; b.classList.add('right'); fb.textContent = '✓ ' + q.why; fb.className = 'ln-fb ok';
          answered++; right++;
        } else { b.classList.add('wrong'); fb.textContent = '✗ Not quite. Try again.'; fb.className = 'ln-fb no'; }
        if (answered === l.quiz.length) {
          score.textContent = 'All correct. Nice! The lesson is marked as complete.';
          const p = P(); p.quiz[key(c.id, l.id)] = Date.now(); p.done[key(c.id, l.id)] ||= Date.now(); saveP(p);
        }
      };
      opts.append(b);
    }
    box.append(h('div', { class: 'ln-q' }, h('p', {}, `${qi + 1}. ${q.q}`), opts, fb));
  });
  box.append(score);
  return box;
}

// Open a fresh canvas for the challenge. With a guide kind, the canvas gets a locked "Guide"
// layer (left out of exports) drawn for exercise `level`; the floating window steps through the
// four exercises, each on its own layer, with less help each time.
async function openChallenge(c, l, ch, level = 0) {
  const s = ch.studio || { mode: 'paint', w: 2048, h: 2048, name: ch.title };
  const kind = GUIDE_FOR[key(c.id, l.id)], K = kind && kindInfo(kind);
  const doc = Doc.create({ name: s.name || ch.title, mode: s.mode, width: s.w, height: s.h });
  if (s.mode === 'animate') { doc.anim.fps = s.fps || 24; doc.anim.length = s.len || 48; }
  if (s.persp) presetGuide(doc, s.persp.type, { horizon: s.persp.horizon });
  const ex = { c, l, ch, kind, K, level, doc, items: [] };
  if (K) await setupGuides(ex);
  stopDemos();
  app.returnTo = 'learn';
  $('#learning').hidden = true;
  await app.openDoc(doc);
  app.dirtySave = true; app.saveNow();
  if (s.persp && !K) { app.setTool('persp'); fitGuide(app); }
  else if (s.persp) { fitGuide(app); app.setTool('brush'); }
  setTimeout(() => briefWindow(ex), 300);
}

async function setupGuides(ex) {
  const d = ex.doc, W = d.width, H = d.height;
  if (d.mode === 'animate') {
    const g = new Track({ name: 'Guide (help)', opacity: 0.9 }); g.locked = true;
    d.addCel(g, 0, d.anim.length);
    d.tracks.unshift(g);
    ex.under = g.cels[0].canvas; ex.guideItem = g;
    const first = d.tracks[1]; first.name = 'Exercise ' + (ex.level + 1);
    ex.items[ex.level] = first; d.active = 1;
  } else {
    const g = new Layer(W, H, { name: 'Guide (help)', draft: true, locked: true });
    d.layers.unshift(g);
    ex.under = g.canvas; ex.guideItem = g;
    let first;
    if (d.mode === 'webtoon') { first = new Layer(W, H, { name: 'Exercise ' + (ex.level + 1), panelMask: false }); d.layers.splice(1, 0, first); }
    else { first = d.layers[1]; first.name = 'Exercise ' + (ex.level + 1); }
    if (ex.K.over) { const o = new Layer(W, H, { name: 'Line art (given)', locked: true, reference: true }); d.layers.splice(d.layers.indexOf(first) + 1, 0, o); ex.over = o.canvas; ex.overItem = o; }
    ex.items[ex.level] = first; d.active = d.layers.indexOf(first);
  }
  await drawLevel(ex);
}

async function drawLevel(ex) {
  const d = ex.doc, cur = ex.items[ex.level];
  if (ex.K.paint) {
    // grading: the "help" is the painting itself, on the exercise layer
    if (ex.level < 3 && cur.canvas) await drawGuideInto(cur.canvas, d, ex.kind, ex.level);
    const x = ex.under.getContext('2d'); x.clearRect(0, 0, ex.under.width, ex.under.height);
  } else if (ex.over) {
    const useOver = ex.level < 2;
    await drawGuideInto(useOver ? ex.over : ex.under, d, ex.kind, ex.level);
    const other = useOver ? ex.under : ex.over; other.getContext('2d').clearRect(0, 0, other.width, other.height);
  } else await drawGuideInto(ex.under, d, ex.kind, ex.level);
  for (const cv of [ex.under, ex.over, cur && cur.canvas].filter(Boolean)) touch(cv);
}

async function goLevel(ex, n) {
  if (!app.doc || app.doc !== ex.doc || n < 0 || n > 3 || n === ex.level) return;
  app.finishTransient && app.finishTransient();
  const d = ex.doc, prev = ex.items[ex.level];
  if (prev) prev.visible = false;
  ex.level = n;
  let cur = ex.items[n];
  if (!cur) {
    if (d.mode === 'animate') { cur = new Track({ name: 'Exercise ' + (n + 1) }); d.addCel(cur, 0, 1); d.tracks.push(cur); }
    else { cur = new Layer(d.width, d.height, { name: 'Exercise ' + (n + 1) }); const i = d.layers.indexOf(prev) + 1 || d.layers.length; d.layers.splice(i, 0, cur); }
    ex.items[n] = cur;
  }
  cur.visible = true;
  d.active = d.items.indexOf(cur);
  if (ex.guideItem) ex.guideItem.visible = true;
  await drawLevel(ex);
  const q = P(); q.levels ||= {}; const k = key(ex.c.id, ex.l.id); q.levels[k] = Math.max(q.levels[k] || 0, n); saveP(q);
  app.changed(); app.updateSliders && app.updateSliders();
  briefWindow(ex);
  toast(`Exercise ${n + 1}: ${levelsOf(ex.kind)[n]}`);
}

function briefWindow(ex) {
  try { UI.closeFloat('learn-brief'); } catch { /* not open */ }
  const { c, l, ch, K } = ex;
  const body = h('div', { class: 'ln-brief' }, h('small', {}, c.title.toUpperCase()), h('b', {}, ch.title));
  if (K) {
    body.append(...[
      h('div', { class: 'ln-brief-dots' }, ...levelsOf(ex.kind).map((n, i) => h('button', { class: i === ex.level ? 'on' : i < ex.level ? 'done' : '', title: n, onclick: () => goLevel(ex, i) }, String(i + 1)))),
      h('div', { class: 'ln-brief-level' }, `Exercise ${ex.level + 1} of 4 · ${levelsOf(ex.kind)[ex.level]}`),
      h('p', {}, K.tips[ex.level]),
      ex.level < 3 ? h('small', { class: 'hint' }, K.paint ? 'The painting is on your Exercise layer: grade it with Adjustments and blend-mode layers.' : 'The help is on the locked "Guide (help)" layer. It never shows up in exports.') : null,
      h('div', { class: 'ln-row' },
        ex.level > 0 ? h('button', { class: 'pill', onclick: () => goLevel(ex, ex.level - 1) }, '‹ More help') : null,
        ex.level < 3 ? h('button', { class: 'pill primary', onclick: () => goLevel(ex, ex.level + 1) }, 'Next: less help ›')
          : h('button', { class: 'pill primary', onclick: () => { const q = P(); q.challenges[key(c.id, l.id)] = true; q.levels ||= {}; q.levels[key(c.id, l.id)] = 4; saveP(q); toast('Challenge complete ✓ You did it on your own!'); } }, 'I did it ✓')),
      ex.guideItem && ex.level < 3 ? h('button', { class: 'pill ln-brief-hide', onclick: (e) => { ex.guideItem.visible = !ex.guideItem.visible; e.target.textContent = ex.guideItem.visible ? 'Hide the help for a moment' : 'Show the help'; app.changed(); } }, 'Hide the help for a moment') : null].filter(Boolean));
  } else {
    body.append(h('p', {}, ch.text), h('ol', {}, ...(ch.steps || []).map((x) => h('li', {}, x))),
      h('button', { class: 'pill', onclick: () => { const q = P(); q.challenges[key(c.id, l.id)] = true; saveP(q); toast('Challenge marked as done ✓'); } }, 'Mark challenge done'));
  }
  UI.openFloating('learn-brief', 'Exercise', { width: 310, body });
}

// called by the Studio when a canvas closes
export function afterClose() {
  try { UI.closeFloat('learn-brief'); } catch { /* not open */ }
  const back = app.returnTo === 'learn' || currentTab() === 'learn';
  app.returnTo = null;
  if (back) { showTab('learn', true); route(currentRoute); return true; }
  return false;
}
