// Minimal XLSX writer (no dependencies). Exposes window.GMLXlsx.build(sheets) -> Uint8Array
(() => {
  const enc = new TextEncoder();

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zip(files) {
    // files: [{name, data: Uint8Array}] -> stored (no compression) zip
    const d = new Date();
    const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
    const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true);
      h.setUint16(10, time, true);
      h.setUint16(12, date, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, f.data.length, true);
      h.setUint32(22, f.data.length, true);
      h.setUint16(26, name.length, true);
      h.setUint16(28, 0, true);
      chunks.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, time, true);
      c.setUint16(14, date, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, f.data.length, true);
      c.setUint32(24, f.data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint16(30, 0, true);
      c.setUint16(32, 0, true);
      c.setUint16(34, 0, true);
      c.setUint16(36, 0, true);
      c.setUint32(38, 0, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + f.data.length;
    }
    const cdSize = central.reduce((s, b) => s + b.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, offset, true);
    const all = [...chunks, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
    let p = 0;
    for (const b of all) {
      out.set(b, p);
      p += b.length;
    }
    return out;
  }

  const esc = (s) =>
    String(s)
      .replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function colName(i) {
    let s = "";
    i++;
    while (i > 0) {
      i--;
      s = String.fromCharCode(65 + (i % 26)) + s;
      i = Math.floor(i / 26);
    }
    return s;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1A73E8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  // cell: string | number | {v, link, style}
  function sheetXml(sh) {
    let rels = "";
    let links = "";
    let nl = 0;
    let x =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    if (sh.freeze)
      x +=
        '<sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B2" sqref="B2"/></sheetView></sheetViews>';
    if (sh.widths && sh.widths.length) {
      x += "<cols>";
      sh.widths.forEach((w, i) => (x += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`));
      x += "</cols>";
    }
    x += "<sheetData>";
    let maxCol = 0;
    sh.rows.forEach((row, ri) => {
      maxCol = Math.max(maxCol, row.length);
      x += `<row r="${ri + 1}">`;
      row.forEach((cell, ci) => {
        if (cell === null || cell === undefined || cell === "") return;
        const c = typeof cell === "object" ? cell : { v: cell };
        const ref = colName(ci) + (ri + 1);
        let style = c.style || 0;
        if (ri === 0 && sh.header) style = 1;
        if (c.link && !style) style = 2;
        const s = style ? ` s="${style}"` : "";
        if (typeof c.v === "number" && isFinite(c.v)) {
          x += `<c r="${ref}"${s}><v>${c.v}</v></c>`;
        } else {
          x += `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(c.v).slice(0, 32000))}</t></is></c>`;
          if (c.link && nl < 60000 && c.link.length < 2000) {
            nl++;
            links += `<hyperlink ref="${ref}" r:id="rId${nl}"/>`;
            rels += `<Relationship Id="rId${nl}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(c.link)}" TargetMode="External"/>`;
          }
        }
      });
      x += "</row>";
    });
    x += "</sheetData>";
    if (sh.autofilter && sh.rows.length > 1) x += `<autoFilter ref="A1:${colName(maxCol - 1)}${sh.rows.length}"/>`;
    if (nl) x += `<hyperlinks>${links}</hyperlinks>`;
    x += '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
    const relXml = nl
      ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
      : "";
    return { x, relXml, maxCol };
  }

  function build(sheets) {
    const files = [];
    let ct =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>';
    let wbSheets = "";
    let wbRels = "";
    let defNames = "";
    const parts = [];
    sheets.forEach((sh, i) => {
      const n = i + 1;
      ct += `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
      wbSheets += `<sheet name="${esc(sh.name)}" sheetId="${n}" r:id="rId${n}"/>`;
      wbRels += `<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`;
      const { x, relXml, maxCol } = sheetXml(sh);
      if (sh.autofilter && sh.rows.length > 1)
        defNames += `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(sh.name)}'!$A$1:$${colName(maxCol - 1)}$${sh.rows.length}</definedName>`;
      parts.push({ name: `xl/worksheets/sheet${n}.xml`, data: enc.encode(x) });
      if (relXml) parts.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: enc.encode(relXml) });
    });
    ct += "</Types>";
    wbRels += `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
    files.push({ name: "[Content_Types].xml", data: enc.encode(ct) });
    files.push({
      name: "_rels/.rels",
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
      ),
    });
    files.push({
      name: "xl/workbook.xml",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${wbSheets}</sheets>${
          defNames ? `<definedNames>${defNames}</definedNames>` : ""
        }</workbook>`
      ),
    });
    files.push({
      name: "xl/_rels/workbook.xml.rels",
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels}</Relationships>`
      ),
    });
    files.push({ name: "xl/styles.xml", data: enc.encode(STYLES) });
    return zip(files.concat(parts));
  }

  (typeof window !== "undefined" ? window : globalThis).GMLXlsx = { build };
})();
