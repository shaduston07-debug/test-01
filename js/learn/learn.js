// Inkwell Learning — the "Learning" tab: tracks → courses → lessons, with live demos, quizzes,
// challenges that open a ready-made canvas in the Studio, sources, and saved progress.
import { $, $$, h, toast, confirmDialog } from '../util.js';
import { ICONS } from '../icons.js';
import { Doc } from '../doc.js';
import * as store from '../storage.js';
import * as UI from '../ui.js';
import { presetGuide, fitGuide } from '../perspective.js';
import { TRACKS, COURSES, findLesson } from './courses.js';
import { DEMOS } from './demos.js';

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

function renderHome(body) {
  const p = P();
  const total = COURSES.reduce((a, c) => a + c.lessons.length, 0), done = Object.keys(p.done).length;
  const hero = h('div', { class: 'ln-hero' },
    h('div', {}, h('h1', {}, 'Inkwell ', h('em', {}, 'Learning')),
      h('p', {}, 'Interactive courses in perspective, backgrounds, faces, colour, grading, animation and webtoons. Every lesson has a live demo, a quiz, a challenge that opens straight in the Studio, and the human-made sources it is built on.')),
    h('div', { class: 'ln-hero-stat' }, h('b', {}, `${done} / ${total}`), h('small', {}, 'lessons done'), bar(total ? done / total : 0)));
  body.append(hero);
  if (p.last) {
    const { course, lesson } = findLesson(p.last.course, p.last.lesson);
    if (course && lesson) body.append(h('button', { class: 'ln-continue', onclick: () => route({ view: 'lesson', course: course.id, lesson: lesson.id }) },
      h('span', { class: 'ln-dot', style: { background: course.color } }), h('div', {}, h('small', {}, 'Continue where you left off'), h('b', {}, `${course.title} · ${lesson.title}`)), h('span', { class: 'ln-go' }, '›')));
  }
  for (const t of TRACKS) {
    body.append(h('div', { class: 'ln-track-head' }, h('h2', {}, t.title), h('span', {}, t.blurb)));
    const grid = h('div', { class: 'ln-grid' });
    for (const c of COURSES.filter((x) => x.track === t.id)) {
      const pr = courseProgress(c, p);
      grid.append(h('button', { class: 'ln-card', onclick: () => route({ view: 'course', course: c.id }) },
        h('div', { class: 'ln-card-top', style: { background: `linear-gradient(135deg, ${c.color}, ${c.color}55)` } }, h('span', {}, `${c.lessons.length} lessons`), c.id === 'perspective' ? h('span', { class: 'ln-new' }, 'NEW TOOL') : null),
        h('b', {}, c.title), h('p', {}, c.blurb), bar(pr.pct, c.color), h('small', {}, pr.d ? `${pr.d} of ${pr.n} done` : 'Start course')));
    }
    body.append(grid);
  }
  body.append(h('div', { class: 'ln-foot' },
    h('p', {}, 'How the courses are made: the lessons follow long-established, human-made teaching (Loomis, Drawabox, Ctrl+Paint, Gurney, Ekman, The Illusion of Life, The Animator\'s Survival Kit, McCloud, Blambot, WEBTOON\'s own creator guides). Every demo is drawn live in code, with no AI-generated pictures. Free assets recommended are CC0/CC-BY (Kenney, Quaternius, Poly Haven, Blender Studio, Pepper&Carrot).'),
    h('button', { class: 'pill', onclick: async () => { if (await confirmDialog('Reset all Learning progress?', 'Reset', true)) { saveP({ done: {}, quiz: {}, challenges: {}, last: null }); route({ view: 'home' }); } } }, 'Reset progress')));
}

function crumbs(...parts) {
  return h('div', { class: 'ln-crumbs' }, ...parts.flatMap((p, i) => [i ? h('span', {}, '›') : null, p.go ? h('button', { onclick: p.go }, p.label) : h('b', {}, p.label)]));
}

function renderCourse(body, cid) {
  const c = COURSES.find((x) => x.id === cid); if (!c) return route({ view: 'home' });
  const p = P(), pr = courseProgress(c, p);
  const track = TRACKS.find((t) => t.id === c.track);
  body.append(crumbs({ label: 'Learning', go: () => route({ view: 'home' }) }, { label: track.title }, { label: c.title }));
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
      h('button', { class: 'pill primary', onclick: () => openChallenge(c, { id: 'capstone', title: cap.title }, { title: cap.title, text: cap.text, steps: ['Plan with thumbnails first.', 'Use the lessons\' challenges as your checklist.', 'Make it about YOUR idea.'], studio: cap.studio }) }, 'Start in the Studio'),
      h('button', { class: 'pill' + (capDone ? ' on' : ''), onclick: () => { const q = P(); q.challenges[key(c.id, 'capstone')] = !capDone; saveP(q); route(currentRoute); } }, capDone ? '✓ Finished' : 'Mark as finished')))));
}

function renderLesson(body, cid, lid) {
  const { course: c, lesson: l } = findLesson(cid, lid);
  if (!c || !l) return route({ view: 'home' });
  const p = P(); p.last = { course: cid, lesson: lid }; saveP(p);
  const idx = c.lessons.indexOf(l), track = TRACKS.find((t) => t.id === c.track);
  body.append(crumbs({ label: 'Learning', go: () => route({ view: 'home' }) }, { label: c.title, go: () => route({ view: 'course', course: c.id }) }, { label: `Lesson ${idx + 1}` }));
  const art = h('article', { class: 'ln-lesson' }); art.style.setProperty('--c', c.color);
  art.append(h('small', { class: 'ln-kicker' }, `${track.title} · ${c.title} · Lesson ${idx + 1} of ${c.lessons.length} · ${l.min} min`), h('h1', {}, l.title));
  for (const b of l.body) {
    if (typeof b === 'string') { art.append(h('div', { class: 'ln-text', html: b })); continue; }
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
  art.append(quiz(c, l));
  // challenge
  const ch = l.challenge, chDone = !!p.challenges[key(c.id, l.id)];
  art.append(h('div', { class: 'ln-challenge' },
    h('small', {}, 'CHALLENGE'), h('h2', {}, ch.title), h('p', {}, ch.text),
    h('ol', {}, ...ch.steps.map((s) => h('li', {}, s))),
    h('div', { class: 'ln-row' },
      h('button', { class: 'pill primary', onclick: () => openChallenge(c, l, ch) }, 'Practise in the Studio'),
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

// open a fresh canvas set up for the challenge, with the brief in a floating window
async function openChallenge(c, l, ch) {
  const s = ch.studio || { mode: 'paint', w: 2048, h: 2048, name: ch.title };
  const doc = Doc.create({ name: s.name || ch.title, mode: s.mode, width: s.w, height: s.h });
  if (s.mode === 'animate') { doc.anim.fps = s.fps || 24; doc.anim.length = s.len || 48; }
  if (s.persp) presetGuide(doc, s.persp.type, { horizon: s.persp.horizon });
  stopDemos();
  app.returnTo = 'learn';
  $('#learning').hidden = true;
  await app.openDoc(doc);
  app.dirtySave = true; app.saveNow();
  if (s.persp) { app.setTool('persp'); fitGuide(app); }
  const body = h('div', { class: 'ln-brief' },
    h('small', {}, c.title.toUpperCase()), h('b', {}, ch.title), h('p', {}, ch.text),
    h('ol', {}, ...(ch.steps || []).map((x) => h('li', {}, x))),
    h('button', { class: 'pill', onclick: () => { const q = P(); q.challenges[key(c.id, l.id)] = true; saveP(q); toast('Challenge marked as done ✓'); } }, 'Mark challenge done'));
  setTimeout(() => UI.openFloating('learn-brief', 'Challenge', { width: 300, body }), 300);
}

// called by the Studio when a canvas closes
export function afterClose() {
  try { UI.closeFloat('learn-brief'); } catch { /* not open */ }
  const back = app.returnTo === 'learn' || currentTab() === 'learn';
  app.returnTo = null;
  if (back) { showTab('learn', true); route(currentRoute); return true; }
  return false;
}
