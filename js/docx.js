/*
 * A small Word (.docx) writer: paragraphs, headings, lists, bold / italic /
 * underline / strikethrough, text and highlight colours, and pictures.
 * A .docx is a ZIP of XML files; the ZIP here is uncompressed ("stored").
 */
const Docx = (() => {
  /* ---------- ZIP ---------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const utf8 = s => new TextEncoder().encode(s);

  function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const { name, data } of files) {
      const nameBytes = utf8(name);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);          // UTF-8 names
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      parts.push(local, nameBytes, data);

      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint32(16, crc, true);
      entry.setUint32(20, data.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      central.push(entry, nameBytes);
      offset += 30 + nameBytes.length + data.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  /* ---------- Document XML ---------- */

  const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function toHex(color) {
    if (!color) return null;
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
      return [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('');
    }
    const h = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!h) return null;
    return h[1].length === 3 ? h[1].split('').map(c => c + c).join('') : h[1];
  }

  /*
   * root: a detached export copy of the note where every <img> already has a
   * data: URL (sketches turned into pictures, recordings into text).
   * Resolves a .docx Blob.
   */
  async function build(root, { title = 'Note', font = 'Calibri' } = {}) {
    const media = [];
    const paragraphs = [];
    let para = null;       // { style, runs: [] }

    const startPara = (style = '', prefix = '') => {
      para = { style, runs: [] };
      paragraphs.push(para);
      if (prefix) para.runs.push(run(prefix, {}));
    };
    const endPara = () => { para = null; };
    const ensurePara = () => { if (!para) startPara(paragraphs.length ? '' : 'Title'); };

    function run(text, f) {
      const props = [
        f.bold && '<w:b/>', f.italic && '<w:i/>', f.underline && '<w:u w:val="single"/>', f.strike && '<w:strike/>',
        f.color && `<w:color w:val="${f.color}"/>`, f.shade && `<w:shd w:val="clear" w:color="auto" w:fill="${f.shade}"/>`,
      ].filter(Boolean).join('');
      const pieces = String(text).split('\n').map(t => `<w:t xml:space="preserve">${x(t)}</w:t>`).join('<w:br/>');
      return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${pieces}</w:r>`;
    }

    async function picture(img) {
      const src = img.getAttribute('src') || '';
      const m = src.match(/^data:image\/(png|jpeg);base64,(.*)$/);
      if (!m) return;
      const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
      const n = media.length + 1;
      const ext = m[1] === 'jpeg' ? 'jpeg' : 'png';
      media.push({ name: `word/media/image${n}.${ext}`, data: bytes, id: `rIdImg${n}` });
      // Fit the page width (6 inches) at most; 9525 EMU per CSS pixel.
      const w = img.naturalWidth || 600;
      const h = img.naturalHeight || 400;
      const sizeShare = { s: 0.33, m: 0.6, l: 1 }[img.closest('[data-size]')?.dataset.size] || 1;
      const maxW = 5486400 * sizeShare;
      const cx = Math.round(Math.min(maxW, w * 9525));
      const cy = Math.round(cx * (h / w));
      startPara('');
      para.runs.push(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
        `<wp:docPr id="${n}" name="Picture ${n}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
        `<pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr>` +
        `<pic:blipFill><a:blip r:embed="rIdImg${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
        `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>');
      endPara();
    }

    async function walk(node, f, list) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.data.replace(/\s+/g, ' ');
        if (!text.trim() && !para) return;
        ensurePara();
        para.runs.push(run(text, f));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node;
      const tag = el.tagName;
      if (tag === 'IMG') return picture(el);
      if (tag === 'BR') {
        if (para) para.runs.push('<w:r><w:br/></w:r>');
        else startPara('');
        return;
      }
      const next = { ...f };
      if (/^(B|STRONG)$/.test(tag)) next.bold = true;
      if (/^(I|EM)$/.test(tag)) next.italic = true;
      if (tag === 'U') next.underline = true;
      if (/^(S|STRIKE|DEL)$/.test(tag)) next.strike = true;
      const color = toHex(el.style.color || el.getAttribute('color'));
      if (color) next.color = color;
      const shade = toHex(el.style.backgroundColor);
      if (shade) next.shade = shade;
      if (el.style.fontWeight === 'bold' || +el.style.fontWeight >= 600) next.bold = true;
      if (el.style.fontStyle === 'italic') next.italic = true;

      if (tag === 'UL' || tag === 'OL') {
        endPara();
        let i = 0;
        for (const li of el.children) {
          i++;
          startPara('ListParagraph', tag === 'OL' ? `${i}. ` : '• ');
          for (const child of li.childNodes) await walk(child, next, true);
          endPara();
        }
        return;
      }
      const block = /^(DIV|P|H[1-6]|FIGURE|BLOCKQUOTE|PRE|LI)$/.test(tag);
      if (block && !list) {
        endPara();
        const style = /^H[12]$/.test(tag) ? 'Heading1' : /^H[3-6]$/.test(tag) ? 'Heading2' : '';
        if (style || !paragraphs.length) startPara(style || 'Title');
      }
      for (const child of el.childNodes) await walk(child, next, list);
      if (block && !list) endPara();
    }

    for (const child of root.childNodes) await walk(child, {}, false);

    const body = paragraphs.map(p =>
      `<w:p>${p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : ''}${p.runs.join('')}</w:p>`).join('');

    const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
      ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<w:body>${body || '<w:p/>'}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>` +
      '<w:pgMar w:top="1300" w:right="1300" w:bottom="1300" w:left="1300" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';

    const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${x(font)}" w:hAnsi="${x(font)}" w:cs="${x(font)}" w:eastAsia="${x(font)}"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>` +
      '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="567" w:hanging="283"/></w:pPr></w:style>' +
      '</w:styles>';

    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      media.map(m => `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${m.name.replace('word/', '')}"/>`).join('') +
      '</Relationships>';

    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:title>${x(title)}</dc:title><dc:creator>Inkwell Notes</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;

    const types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>';

    const pkgRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>';

    return zip([
      { name: '[Content_Types].xml', data: utf8(types) },
      { name: '_rels/.rels', data: utf8(pkgRels) },
      { name: 'docProps/core.xml', data: utf8(core) },
      { name: 'word/document.xml', data: utf8(documentXml) },
      { name: 'word/styles.xml', data: utf8(stylesXml) },
      { name: 'word/_rels/document.xml.rels', data: utf8(rels) },
      ...media.map(m => ({ name: m.name, data: m.data })),
    ]);
  }

  return { build };
})();
