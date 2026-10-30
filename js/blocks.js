/*
 * Media blocks inside a note: audio recordings and images (sketches join in
 * for moving). Each block sits on its own line and can be dragged by its
 * handle (finger, pencil or mouse) or moved a line up/down from its toolbar.
 */
const Blocks = (() => {
  const BLOCKS = '.audio-clip, .image-block, .sketch';
  const BLOCK_TAGS = /^(DIV|P|H[1-6]|UL|OL|LI|FIGURE|BLOCKQUOTE|PRE|TABLE)$/;
  const esc = s => Definitions.escape(s);

  let editor;
  let scroller;
  let onChange;
  let flash;
  let bar;          // floating toolbar for the selected block
  let selected = null;

  /* ---------- Inserting ---------- */

  let savedRange = null;

  // Remember where the caret is before a toolbar button takes over.
  function rememberCaret() {
    const sel = getSelection();
    savedRange = sel.rangeCount && editor.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  }

  function insert(html) {
    editor.focus();
    const sel = getSelection();
    sel.removeAllRanges();
    if (savedRange && editor.contains(savedRange.startContainer)) {
      sel.addRange(savedRange);
    } else {
      const end = document.createRange();
      end.selectNodeContents(editor);
      end.collapse(false);
      sel.addRange(end);
    }
    const markup = html + '<div><br></div>';
    if (!document.execCommand('insertHTML', false, markup)) editor.insertAdjacentHTML('beforeend', markup);
    savedRange = null;
  }

  // Put the playable/viewable source on a just-inserted block.
  function attach(ref, url) {
    const el = editor.querySelector(`[data-media="${CSS.escape(ref)}"]`);
    const target = el && el.querySelector('img, audio');
    if (target) target.src = url;
    return el;
  }

  const handle = `<span class="block-handle" aria-label="Drag to move" title="Drag to move">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></span>`;

  /* ---------- Audio recording ---------- */

  let recorder = null;
  let recording = null;   // { stream, chunks, started, type, timer, keep }
  const recordBar = () => document.querySelector('#record-bar');

  const formatTime = sec => {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  async function startRecording() {
    if (recording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      flash('Recording isn’t available here. Use the full-screen app (Safari, Add to Home Screen).');
      return;
    }
    if (Cloud.onClaude) {
      flash('claude.ai pages can\u2019t use the microphone. Record in the full-screen Inkwell app.');
      return;
    }
    rememberCaret();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      flash(err && err.name === 'NotAllowedError'
        ? 'Microphone access is off. Allow it in Settings › Safari › Microphone (or this page’s settings).'
        : 'Couldn’t start recording on this device.');
      return;
    }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg']
      .find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    recording = { stream, chunks: [], started: Date.now(), type, keep: false };
    recorder.ondataavailable = e => { if (e.data && e.data.size) recording.chunks.push(e.data); };
    recorder.onstop = finishRecording;
    recorder.start(250);

    const barEl = recordBar();
    barEl.hidden = false;
    const time = barEl.querySelector('.rec-time');
    time.textContent = '0:00';
    recording.timer = setInterval(() => { time.textContent = formatTime((Date.now() - recording.started) / 1000); }, 250);
    showLevel(stream);
  }

  // A small live input meter so it's obvious the microphone is hearing you.
  function showLevel(stream) {
    const meter = recordBar().querySelector('.rec-level span');
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!recording) return ctx.close();
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        meter.style.transform = `scaleX(${Math.min(1, Math.sqrt(sum / data.length) * 4)})`;
        requestAnimationFrame(tick);
      };
      tick();
    } catch { /* no meter, recording still works */ }
  }

  function stopRecording(keep) {
    if (!recording) return;
    recording.keep = keep;
    recording.ended = Date.now();
    recorder.stop();
  }

  async function finishRecording() {
    const rec = recording;
    recording = null;
    clearInterval(rec.timer);
    rec.stream.getTracks().forEach(t => t.stop());
    recordBar().hidden = true;
    if (!rec.keep || !rec.chunks.length) return;
    const blob = new Blob(rec.chunks, { type: recorder.mimeType || rec.type || 'audio/webm' });
    const seconds = (rec.ended - rec.started) / 1000;
    const title = 'Recording, ' + new Date(rec.started).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    try {
      const { ref, url } = await Media.save(blob, 'audio');
      insert(clipHTML(ref, seconds, title));
      attach(ref, url);
      onChange();
    } catch {
      flash('Couldn’t save the recording: this device’s storage is full or blocked.');
    }
  }

  function clipHTML(ref, seconds, title) {
    return `<div class="audio-clip" contenteditable="false" data-media="${esc(ref)}" data-duration="${seconds.toFixed(1)}">` +
      handle +
      '<button class="clip-play" aria-label="Play"><svg viewBox="0 0 24 24" aria-hidden="true"><path class="i-play" d="M8 5l11 7-11 7z"/><path class="i-pause" d="M8 5v14M16 5v14"/></svg></button>' +
      `<span class="clip-body"><span class="clip-title">${esc(title)}</span><span class="clip-bar"><span class="clip-progress"></span></span></span>` +
      `<span class="clip-time">${formatTime(seconds)}</span>` +
      '<audio preload="metadata"></audio></div>';
  }

  /* ---------- Images ---------- */

  const MAX_SIDE = 1800;

  // Shrink big photos so notes stay quick to load and share.
  async function prepare(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) return file; // GIFs keep their animation
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      if (scale === 1 && file.type !== 'image/heic' && file.type !== 'image/heif' && file.size < 1.5e6) return file;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      return await new Promise(r => canvas.toBlob(b => r(b || file), type, 0.86));
    } catch {
      return file;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function insertImages(files) {
    const images = [...files].filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    for (const file of images) {
      try {
        const { ref, url } = await Media.save(await prepare(file), 'image');
        insert(`<figure class="image-block" contenteditable="false" data-media="${esc(ref)}" data-size="l">${handle}` +
          `<img alt="" draggable="false"${ref.startsWith('idb:') ? '' : ` src="${esc(url)}"`}></figure>`);
        attach(ref, url);
      } catch {
        flash('Couldn’t add that image: this device’s storage is full or blocked.');
      }
    }
    onChange();
  }

  function pickImages() {
    rememberCaret();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.addEventListener('change', () => insertImages(input.files));
    input.click();
  }

  /* ---------- Playback ---------- */

  function togglePlay(clip) {
    const audio = clip.querySelector('audio');
    if (!audio.src) return flash('This recording isn’t on this device.');
    editor.querySelectorAll('.audio-clip audio').forEach(a => { if (a !== audio) a.pause(); });
    if (audio.paused) audio.play().catch(() => flash('Couldn’t play this recording.'));
    else audio.pause();
  }

  function updateClip(audio) {
    const clip = audio.closest('.audio-clip');
    if (!clip) return;
    const total = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : parseFloat(clip.dataset.duration) || 0;
    clip.classList.toggle('playing', !audio.paused && !audio.ended);
    clip.querySelector('.clip-progress').style.transform = `scaleX(${total ? audio.currentTime / total : 0})`;
    clip.querySelector('.clip-time').textContent = audio.paused && audio.currentTime === 0
      ? formatTime(total) : formatTime(audio.currentTime) + ' / ' + formatTime(total);
  }

  /* ---------- Selecting and moving blocks ---------- */

  // Group stray top-level text into lines so every line is one element.
  function tidyLines() {
    let line = null;
    for (const node of [...editor.childNodes]) {
      const isBlock = node.nodeType === Node.ELEMENT_NODE && (BLOCK_TAGS.test(node.tagName) || node.matches(BLOCKS));
      if (isBlock) {
        line = null;
        continue;
      }
      if (node.nodeType === Node.TEXT_NODE && !node.data.trim() && !line) continue;
      if (!line) {
        line = document.createElement('div');
        node.before(line);
      }
      line.append(node);
      if (node.nodeName === 'BR') line = null;
    }
    // A block that ended up inside a line of text gets a line of its own.
    for (const block of editor.querySelectorAll(BLOCKS)) {
      let top = block;
      while (top.parentNode !== editor) top = top.parentNode;
      if (top !== block) top.after(block);
    }
  }

  const lines = () => [...editor.children];

  function select(block) {
    if (selected) selected.classList.remove('selected');
    selected = block;
    if (!block) {
      bar.hidden = true;
      return;
    }
    block.classList.add('selected');
    bar.querySelector('.bar-sizes').hidden = !block.matches('.image-block');
    bar.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', b.dataset.size === block.dataset.size));
    const del = bar.querySelector('[data-block="delete"]');
    del.classList.remove('armed');
    del.textContent = 'Delete';
    bar.hidden = false;
    placeBar();
  }

  function placeBar() {
    if (!selected || bar.hidden) return;
    const r = selected.getBoundingClientRect();
    const top = r.top - bar.offsetHeight - 8;
    bar.style.top = (top > 60 ? top : r.bottom + 8) + 'px';
    bar.style.left = Math.max(12, Math.min(r.left + r.width / 2 - bar.offsetWidth / 2, window.innerWidth - bar.offsetWidth - 12)) + 'px';
  }

  function move(block, direction) {
    tidyLines();
    const all = lines();
    const i = all.indexOf(block);
    const target = all[i + direction];
    if (!target) return;
    if (direction < 0) target.before(block);
    else target.after(block);
    block.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    onChange();
    setTimeout(placeBar, 250);
  }

  // Dragging by the handle: a line shows where the block will land.
  let drag = null;

  function startDrag(e, block) {
    e.preventDefault();
    tidyLines();
    select(null);
    const indicator = document.createElement('div');
    indicator.className = 'drop-line';
    document.body.append(indicator);
    block.classList.add('dragging');
    drag = { block, indicator, pointerId: e.pointerId, target: null, after: false };
    try { e.target.setPointerCapture(e.pointerId); } catch { /* still works without capture */ }
    dragTo(e.clientY);
  }

  function dragTo(y) {
    const others = lines().filter(l => l !== drag.block);
    if (!others.length) return;
    let target = others[others.length - 1];
    let after = true;
    for (const line of others) {
      const r = line.getBoundingClientRect();
      if (y < r.top + r.height / 2) {
        target = line;
        after = false;
        break;
      }
    }
    drag.target = target;
    drag.after = after;
    const r = target.getBoundingClientRect();
    const ed = editor.getBoundingClientRect();
    Object.assign(drag.indicator.style, { top: (after ? r.bottom : r.top) - 1 + 'px', left: ed.left + 'px', width: ed.width + 'px' });
    // Scroll when dragging near the top or bottom edge.
    const box = scroller.getBoundingClientRect();
    if (y < box.top + 50) scroller.scrollTop -= 12;
    else if (y > box.bottom - 50) scroller.scrollTop += 12;
  }

  function endDrag(drop) {
    if (!drag) return;
    const { block, indicator, target, after } = drag;
    drag = null;
    indicator.remove();
    block.classList.remove('dragging');
    if (drop && target) {
      if (after) target.after(block);
      else target.before(block);
      onChange();
    }
  }

  /* ---------- Wiring ---------- */

  function init(options) {
    ({ editor, scroller, onChange, flash } = options);

    bar = document.createElement('div');
    bar.className = 'block-bar';
    bar.hidden = true;
    bar.innerHTML = `
      <button data-block="up" aria-label="Move up a line"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
      <button data-block="down" aria-label="Move down a line"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg></button>
      <span class="bar-sizes">
        <button data-size="s">S</button><button data-size="m">M</button><button data-size="l">L</button>
      </span>
      <button data-block="delete" class="danger">Delete</button>`;
    document.body.append(bar);
    bar.addEventListener('mousedown', e => e.preventDefault());
    bar.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (!btn || !selected) return;
      if (btn.dataset.size) {
        selected.dataset.size = btn.dataset.size;
        onChange();
        select(selected);
        return;
      }
      if (btn.dataset.block === 'up') return move(selected, -1);
      if (btn.dataset.block === 'down') return move(selected, 1);
      if (btn.dataset.block === 'delete') {
        if (!btn.classList.contains('armed')) {
          btn.classList.add('armed');
          btn.textContent = 'Tap again';
          return;
        }
        const gone = selected;
        select(null);
        gone.remove();
        onChange();
      }
    });

    // Clicks on blocks: play, seek, select. Runs before the editor's word lookups.
    editor.addEventListener('click', e => {
      const block = e.target.closest(BLOCKS);
      if (!block || block.matches('.sketch')) {
        if (!e.target.closest('.block-bar')) select(null);
        return;
      }
      if (e.target.closest('.block-handle')) return;
      const play = e.target.closest('.clip-play');
      if (play) return togglePlay(block);
      const track = e.target.closest('.clip-bar');
      const audio = block.querySelector('audio');
      if (track && audio && audio.src && isFinite(audio.duration)) {
        const r = track.getBoundingClientRect();
        audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
        return;
      }
      select(selected === block ? null : block);
    }, true);

    // Media events don't bubble, but they do pass through the capture phase.
    for (const type of ['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata']) {
      editor.addEventListener(type, e => { if (e.target.tagName === 'AUDIO') updateClip(e.target); }, true);
    }

    editor.addEventListener('pointerdown', e => {
      const h = e.target.closest('.block-handle');
      if (h) startDrag(e, h.closest(BLOCKS));
    });
    window.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.pointerId) dragTo(e.clientY); });
    window.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.pointerId) endDrag(true); });
    window.addEventListener('pointercancel', () => endDrag(false));

    document.addEventListener('mousedown', e => {
      if (selected && !selected.contains(e.target) && !bar.contains(e.target)) select(null);
    });
    scroller.addEventListener('scroll', placeBar);
    window.addEventListener('resize', placeBar);

    // Images dropped onto the note.
    editor.addEventListener('dragover', e => {
      if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
    });
    editor.addEventListener('drop', e => {
      const files = [...(e.dataTransfer.files || [])].filter(f => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      const pos = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      savedRange = pos && editor.contains(pos.startContainer) ? pos : null;
      insertImages(files);
    });

    const recBar = recordBar();
    recBar.addEventListener('click', e => {
      const btn = e.target.closest('[data-rec]');
      if (btn) stopRecording(btn.dataset.rec === 'stop');
    });
  }

  return {
    init,
    rememberCaret,
    startRecording,
    pickImages,
    insertImages,
    deselect: () => select(null),
    get recording() { return !!recording; },
  };
})();
