/*
 * Sharing a note as PDF, Word, plain text, Markdown or a web page, and
 * backing up / restoring every note. Files go to the iPad share sheet
 * (AirDrop, Mail, Save to Files …), a download, or claude.ai's save dialog.
 */
const Exporter = (() => {
  const PAGE_WIDTH = 794; // A4 at 96 dpi

  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => { delete loaded[src]; reject(new Error('Could not load ' + src)); };
        document.head.append(s);
      });
    }
    return loaded[src];
  }

  const safeName = title => (title || 'Note').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Note';

  const loadImage = src => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  async function toPng(src, width, height) {
    const img = await loadImage(src);
    const c = document.createElement('canvas');
    c.width = width || img.naturalWidth;
    c.height = height || img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  const formatTime = sec => {
    const s = Math.max(0, Math.round(sec || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };

  /*
   * A self-contained copy of the note: pictures as data: URLs, sketches as
   * pictures (dark ink), recordings either kept as audio (web page) or
   * described in words (everything else).
   */
  async function prepare(note, { keepAudio = false } = {}) {
    const root = document.createElement('div');
    root.innerHTML = note.html;
    root.querySelectorAll('.block-handle, .clip-play').forEach(el => el.remove());

    for (const fig of root.querySelectorAll('.image-block')) {
      const img = fig.querySelector('img');
      try {
        const live = document.querySelector(`#editor [data-media="${CSS.escape(fig.dataset.media)}"]`);
        const file = await Media.blob(fig.dataset.media, live || fig);
        img.src = await Media.toDataUrl(file);
        if (!/^data:image\/(png|jpeg)/.test(img.src)) img.src = await toPng(img.src);
        await img.decode().catch(() => {});
      } catch {
        fig.replaceWith(Object.assign(document.createElement('div'), { textContent: '[Image not on this device]' }));
      }
    }

    for (const sketch of root.querySelectorAll('.sketch')) {
      const svg = sketch.querySelector('svg');
      if (!svg) continue;
      const markup = svg.outerHTML.replace(/currentColor/g, '#1d1d1f');
      const img = new Image();
      img.alt = 'Sketch';
      img.src = await toPng('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup), 1000, 625);
      await img.decode().catch(() => {});
      const fig = document.createElement('figure');
      fig.className = 'image-block';
      fig.dataset.size = 'l';
      fig.append(img);
      sketch.replaceWith(fig);
    }

    for (const clip of root.querySelectorAll('.audio-clip')) {
      const title = clip.querySelector('.clip-title')?.textContent || 'Recording';
      const length = formatTime(parseFloat(clip.dataset.duration));
      if (keepAudio) {
        try {
          const live = document.querySelector(`#editor [data-media="${CSS.escape(clip.dataset.media)}"]`);
          const file = await Media.blob(clip.dataset.media, live || clip);
          const fig = document.createElement('figure');
          fig.className = 'audio';
          fig.innerHTML = `<figcaption></figcaption><audio controls src="${await Media.toDataUrl(file)}"></audio>`;
          fig.querySelector('figcaption').textContent = `${title} (${length})`;
          clip.replaceWith(fig);
          continue;
        } catch { /* describe it instead */ }
      }
      const p = document.createElement('div');
      p.innerHTML = '<i></i>';
      p.firstChild.textContent = `\u{1F399} ${title} (${length})`;
      clip.replaceWith(p);
    }

    // Translated words export as plain words.
    root.querySelectorAll('.xlat, .norse').forEach(s => s.replaceWith(document.createTextNode(s.textContent)));

    // The first line is the title. In the app CSS does that with ::first-line,
    // which PDF rendering ignores, so mark it explicitly.
    const lead = [...root.childNodes].find(n => n.textContent.trim());
    if (lead && lead.nodeType === Node.TEXT_NODE) {
      const div = document.createElement('div');
      lead.before(div);
      while (div.nextSibling && div.nextSibling.nodeType === Node.TEXT_NODE || div.nextSibling && /^(B|I|U|S|SPAN|FONT|STRONG|EM)$/.test(div.nextSibling.nodeName)) div.append(div.nextSibling);
      div.className = 'note-title';
    } else if (lead && lead.nodeType === Node.ELEMENT_NODE && !lead.matches('ul, ol, figure')) {
      lead.classList.add('note-title');
    }
    return root;
  }

  // Visible text of the copy, with images and blank lines kept as lines.
  function plainText(root) {
    const host = document.createElement('div');
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_WIDTH}px;white-space:normal`;
    const copy = root.cloneNode(true);
    copy.querySelectorAll('figure.image-block').forEach(f => f.replaceWith(Object.assign(document.createElement('div'), { textContent: '[' + (f.querySelector('img')?.alt || 'Image') + ']' })));
    host.append(copy);
    document.body.append(host);
    const text = copy.innerText.replace(/\n{3,}/g, '\n\n').trim() + '\n';
    host.remove();
    return text;
  }

  function markdown(root) {
    const out = [];
    const inline = node => {
      if (node.nodeType === Node.TEXT_NODE) return node.data.replace(/([*_`[\]])/g, '\\$1');
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const inner = [...node.childNodes].map(inline).join('');
      switch (node.tagName) {
        case 'B': case 'STRONG': return inner.trim() ? `**${inner}**` : inner;
        case 'I': case 'EM': return inner.trim() ? `*${inner}*` : inner;
        case 'S': case 'STRIKE': case 'DEL': return inner.trim() ? `~~${inner}~~` : inner;
        case 'BR': return '  \n';
        case 'IMG': return `![${node.alt || 'image'}](${node.src})`;
        default: return inner;
      }
    };
    const block = (node, first) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.data.trim()) out.push((first ? '# ' : '') + inline(node));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'UL' || tag === 'OL') {
        [...node.children].forEach((li, i) => out.push(`${tag === 'OL' ? i + 1 + '.' : '-'} ${inline(li).trim()}`));
        out.push('');
        return;
      }
      const text = inline(node).trim();
      if (/^H[1-6]$/.test(tag)) out.push('## ' + text, '');
      else if (first) out.push('# ' + text, '');
      else out.push(text, '');
    };
    [...root.childNodes].forEach((n, i) => block(n, i === 0));
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function pageCss(page) {
    return `
      body { margin: 0; background: #fff; }
      .export-page { box-sizing: border-box; width: ${PAGE_WIDTH}px; padding: 56px 64px; background: #fff; color: #1d1d1f;
        font-family: ${page.fontFamily}; font-size: ${page.fontSize}px; line-height: 1.55; word-wrap: break-word; }
      .export-page .note-title { font-size: 1.65em; font-weight: 700; line-height: 1.3; margin-bottom: 0.3em; }
      .export-page h2 { font-size: 1.3em; margin: 0.4em 0 0.2em; }
      .export-page ul, .export-page ol { padding-left: 1.6em; margin: 0.2em 0; }
      .export-page figure { margin: 10px 0; }
      .export-page figure.image-block img { display: block; max-width: 100%; height: auto; border-radius: 6px; }
      .export-page figure[data-size="s"] img { max-width: 33%; }
      .export-page figure[data-size="m"] img { max-width: 60%; }
      .export-page figure.audio figcaption { font-size: 0.85em; color: #6b6b70; margin-bottom: 4px; }
      .export-page figure.audio audio { width: 100%; }`;
  }

  function webPage(root, title, page) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${Definitions.escape(title)}</title>
<style>${pageCss(page)}
  .export-page { width: auto; max-width: ${PAGE_WIDTH}px; margin: 0 auto; }
  @media (max-width: 700px) { .export-page { padding: 24px 18px; } }
</style>
</head>
<body><article class="export-page">${root.innerHTML}</article></body>
</html>
`;
  }

  // PDF: the note is drawn as an A4 page image (so every alphabet, colour,
  // sketch and photo looks exactly right), split into pages at blank rows.
  async function pdf(root, page) {
    await Promise.all([loadScript('vendor/html2canvas/html2canvas.min.js'), loadScript('vendor/jspdf/jspdf.umd.min.js')]);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;';
    host.innerHTML = `<style>${pageCss(page)}</style>`;
    const article = document.createElement('article');
    article.className = 'export-page';
    article.append(...root.childNodes);
    host.append(article);
    document.body.append(host);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const scale = 2;
      const canvas = await window.html2canvas(article, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const pxPerPt = canvas.width / pageW;
      const sliceMax = Math.floor(pageH * pxPerPt);
      const margin = Math.round(40 * pxPerPt);
      const ctx = canvas.getContext('2d');

      // Break pages on a fully white row so lines of text aren't cut in half.
      const isBlankRow = y => {
        const row = ctx.getImageData(0, y, canvas.width, 1).data;
        for (let i = 0; i < row.length; i += 16) if (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245) return false;
        return true;
      };
      let y = 0;
      let first = true;
      while (y < canvas.height) {
        const usable = sliceMax - (first ? 0 : margin) - margin;
        let end = Math.min(canvas.height, y + usable);
        if (end < canvas.height) {
          for (let probe = end; probe > end - 200 * scale && probe > y + 50; probe--) {
            if (isBlankRow(probe)) { end = probe; break; }
          }
        }
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = end - y;
        slice.getContext('2d').drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
        if (!first) doc.addPage();
        doc.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, first ? 0 : margin / pxPerPt, pageW, (end - y) / pxPerPt);
        y = end;
        first = false;
      }
      return doc.output('blob');
    } finally {
      host.remove();
    }
  }

  /*
   * Build one note in a format. Resolves a File.
   * page: { fontFamily, fontSize, docxFont }
   */
  async function make(note, format, page) {
    const title = (note.text.split('\n').find(l => l.trim()) || 'Note').trim();
    const name = safeName(title);
    switch (format) {
      case 'pdf':
        return new File([await pdf(await prepare(note), page)], name + '.pdf', { type: 'application/pdf' });
      case 'docx':
        return new File([await Docx.build(await prepare(note), { title, font: page.docxFont })], name + '.docx',
          { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      case 'txt':
        return new File([plainText(await prepare(note))], name + '.txt', { type: 'text/plain' });
      case 'md':
        return new File([markdown(await prepare(note))], name + '.md', { type: 'text/markdown' });
      case 'html':
        return new File([webPage(await prepare(note, { keepAudio: true }), title, page)], name + '.html', { type: 'text/html' });
      default:
        throw new Error('Unknown format ' + format);
    }
  }

  /* ---------- Backup ---------- */

  async function backup(state) {
    const media = {};
    for (const note of state.notes) {
      const box = document.createElement('div');
      box.innerHTML = note.html;
      for (const el of box.querySelectorAll('[data-media^="idb:"]')) {
        try {
          const file = await Media.blob(el.dataset.media);
          if (file) media[el.dataset.media] = await Media.toDataUrl(file);
        } catch { /* skip a missing file */ }
      }
    }
    const data = JSON.stringify({ app: 'inkwell-notes', version: 1, saved: new Date().toISOString(), ...state, media });
    const day = new Date().toISOString().slice(0, 10);
    return new File([data], `Inkwell backup ${day}.json`, { type: 'application/json' });
  }

  async function readBackup(file) {
    const data = JSON.parse(await file.text());
    if (!data || data.app !== 'inkwell-notes' || !Array.isArray(data.notes)) throw new Error('Not an Inkwell backup');
    for (const [ref, url] of Object.entries(data.media || {})) {
      const blob = await (await fetch(url)).blob();
      await Media.restore(ref, blob);
    }
    return data;
  }

  /* ---------- Handing the file over ---------- */

  // In the installed iPad/iPhone app, files go to the system share sheet through
  // a native bridge (WKWebView can't download files itself).
  const nativeShare = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.inkwellShare;

  async function shareNatively(file) {
    const dataUrl = await Media.toDataUrl(file);
    nativeShare.postMessage({ name: file.name, data: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    return 'shared';
  }

  const canShareFiles = file => !!nativeShare || !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));

  // Must be called from a tap (share sheets need one).
  async function share(file) {
    if (nativeShare) return shareNatively(file);
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }

  async function save(file) {
    if (nativeShare) return shareNatively(file);   // the share sheet has "Save to Files"
    const downloads = await Cloud.downloads();
    if (downloads) {
      try {
        await downloads.save({ filename: file.name, data: file });
        return 'saved';
      } catch (err) {
        if (err && err.code === 'declined') return 'cancelled';
        throw err;
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'saved';
  }

  return { make, backup, readBackup, canShareFiles, share, save };
})();
