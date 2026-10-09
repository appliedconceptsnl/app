/* ---------------------------------------------------------------------
   Applied Concepts — PDF-export (telefoon/tablet)

   Waarom: het printvenster van iOS/iPadOS (WebKit) drukt webpagina's niet
   op ware grootte af. Het rekent 1 CSS-pixel als 0,8 pt in plaats van
   0,75 pt (WebKit's "minimum shrink factor" 1,25 — alles wordt ~6,7 %
   groter), legt er zijn eigen marges, kop- en voettekst overheen en knipt
   wat dan niet meer past af naar een 2e blad. Voor schijven waarop een
   vakje exact 1 cm (= een vast aantal klikken) moet zijn, is dat
   onbruikbaar — en geen CSS-instelling verandert het.

   Daarom maakt de app op iPhone/iPad de PDF zelf: elk printblad (dezelfde
   SVG als op de laptop) wordt op 300 dpi getekend en als één afbeelding
   per pagina, exact op papiermaat, in een PDF gezet. Die PDF gaat via het
   deelmenu naar de printer-app, Bestanden of Afdrukken — zonder dat het
   iOS-printvenster er nog iets aan schaalt. Op de laptop (Chrome) blijft
   gewoon window.print() in gebruik; dat drukt al op ware grootte af.
--------------------------------------------------------------------- */
(function(){
  const PDF_BATCH_IDS = {
    'zero-optic-calculator': 'opticPrintBatch',
    'train-oefenblad': 'trainPrintBatch',
    'turret-tape': 'turretPrintBatch',
    'dopecard': 'dcPrintBatch',
  };
  const PDF_FILE_NAMES = {
    'zero-optic-calculator': 'zero-optic',
    'train-oefenblad': 'train-oefenblad',
    'turret-tape': 'turret-tape',
    'dopecard': 'dope-card',
  };
  const PDF_PAPER_IN = { a4:{ w:8.2677, h:11.6929, label:'A4' }, a3:{ w:11.6929, h:16.5354, label:'A3' }, letter:{ w:8.5, h:11, label:'Letter' } };
  // iOS weigert canvassen boven ~16,7 miljoen pixels.
  const PDF_MAX_CANVAS_PX = 16000000;
  const PDF_TARGET_DPI = 300;
  // Kleiner blad dan het papier (Dope Card-kaartje): bovenaan, gecentreerd.
  const PDF_SMALL_SHEET_TOP_IN = 0.5;

  const ua = navigator.userAgent || '';
  const isAppleTouch = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  function supported(){
    return !!(window.XMLSerializer && window.Blob && window.URL && document.createElement('canvas').getContext);
  }
  function shouldUse(){ return isAppleTouch && supported(); }

  /* ---- Lettertypes: in de SVG-afbeelding zelf ingebed ----
     Een SVG die als <img> wordt getekend ziet de stylesheets van de pagina
     niet, dus IBM Plex Mono (en de regel dat alle SVG-tekst in Plex Mono
     staat, zie css/styles.css) moet er als data-URL in mee. */
  const PDF_FONTS = [
    { weight:400, file:'fonts/ibm-plex-mono-400-latin.woff2', latin:true },
    { weight:400, file:'fonts/ibm-plex-mono-400-latin-ext.woff2' },
    { weight:500, file:'fonts/ibm-plex-mono-500-latin.woff2', latin:true },
    { weight:500, file:'fonts/ibm-plex-mono-500-latin-ext.woff2' },
    { weight:600, file:'fonts/ibm-plex-mono-600-latin.woff2', latin:true },
    { weight:600, file:'fonts/ibm-plex-mono-600-latin-ext.woff2' },
  ];
  const RANGE_LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const RANGE_LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
  let fontCssPromise = null;

  function bytesToBase64(bytes){
    let bin = '';
    const CHUNK = 0x8000;
    for(let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
  }
  // Na elkaar (niet tegelijk) en met een herhaalpoging: een afgebroken
  // download zou dat gewicht stilletjes in een ander lettertype zetten. Een
  // onvolledige set wordt niet onthouden, zodat de volgende export het
  // opnieuw probeert.
  async function fetchFontBase64(file){
    for(let attempt = 0; attempt < 3; attempt++){
      try {
        const r = await fetch(file, { cache: attempt ? 'reload' : 'default' });
        if(r.ok) return bytesToBase64(new Uint8Array(await r.arrayBuffer()));
      } catch(e){ /* opnieuw proberen */ }
    }
    return null;
  }
  async function fontCss(){
    if(fontCssPromise) return fontCssPromise;
    let rules = '', complete = true;
    for(const f of PDF_FONTS){
      const b64 = await fetchFontBase64(f.file);
      if(!b64){ complete = false; continue; }
      rules += `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${f.weight};src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${f.latin ? RANGE_LATIN : RANGE_LATIN_EXT};}`;
    }
    const css = rules + "text,tspan{font-family:'IBM Plex Mono',monospace;}";
    if(complete) fontCssPromise = Promise.resolve(css);
    return css;
  }

  /* ---- Eén printblad (<svg>) -> canvas op papiermaat ---- */
  function svgInches(svgEl, attr){
    const v = String(svgEl.getAttribute(attr) || '');
    const n = parseFloat(v);
    if(/in$/.test(v)) return n;
    if(/mm$/.test(v)) return n / 25.4;
    if(/cm$/.test(v)) return n / 2.54;
    return n / 96; // px
  }
  function loadImage(url){
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Afbeelding laden mislukt'));
      img.src = url;
    });
  }
  async function renderSheet(svgEl, pxW, pxH, css){
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('width', String(pxW));
    clone.setAttribute('height', String(pxH));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = css;
    clone.insertBefore(style, clone.firstChild);
    let xml = new XMLSerializer().serializeToString(clone);
    // Inkscape-attributen in het logo hebben geen namespace-declaratie —
    // als losse SVG-afbeelding is dat ongeldige XML. CSS-variabelen bestaan
    // buiten de pagina niet.
    xml = xml.replace(/\s(?:inkscape|sodipodi):[\w-]+="[^"]*"/g, '').replace(/var\(--paper\)/g, '#ffffff');
    const url = URL.createObjectURL(new Blob([xml], { type:'image/svg+xml' }));
    try {
      const img = await loadImage(url);
      if(img.decode) { try { await img.decode(); } catch(e){} }
      // Korte pauze: ingebedde lettertypes zijn dan zeker verwerkt.
      await new Promise(r => setTimeout(r, 150));
      const canvas = document.createElement('canvas');
      canvas.width = pxW; canvas.height = pxH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pxW, pxH);
      ctx.drawImage(img, 0, 0, pxW, pxH);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /* ---- Canvas -> PDF-afbeelding (lossless Flate, anders JPEG) ---- */
  async function deflate(bytes){
    const cs = new CompressionStream('deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function canvasToPdfImage(canvas){
    const w = canvas.width, h = canvas.height;
    if(typeof CompressionStream === 'function'){
      const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      const rgb = new Uint8Array(w * h * 3);
      for(let i = 0, j = 0; i < rgba.length; i += 4, j += 3){ rgb[j] = rgba[i]; rgb[j+1] = rgba[i+1]; rgb[j+2] = rgba[i+2]; }
      return { w, h, filter:'FlateDecode', bytes: await deflate(rgb) };
    }
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
    return { w, h, filter:'DCTDecode', bytes: new Uint8Array(await blob.arrayBuffer()) };
  }

  /* ---- Minimale PDF-schrijver: per pagina één afbeelding op exacte maat ---- */
  function buildPdf(pages){
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let pos = 0;
    const push = (part) => { const b = typeof part === 'string' ? enc.encode(part) : part; chunks.push(b); pos += b.length; };
    const obj = (num, body, streamBytes) => {
      offsets[num] = pos;
      push(`${num} 0 obj\n`);
      push(body);
      if(streamBytes){ push('\nstream\n'); push(streamBytes); push('\nendstream'); }
      push('\nendobj\n');
    };
    push('%PDF-1.4\n%âãÏÓ\n');
    const n = pages.length;
    const pageNum = i => 3 + i*3, contentNum = i => 4 + i*3, imageNum = i => 5 + i*3;
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageNum(i)} 0 R`).join(' ')}] /Count ${n} >>`);
    const f = v => (Math.round(v * 1000) / 1000).toString();
    pages.forEach((p, i) => {
      obj(pageNum(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(p.wPt)} ${f(p.hPt)}] /Resources << /XObject << /Im${i} ${imageNum(i)} 0 R >> >> /Contents ${contentNum(i)} 0 R >>`);
      const content = enc.encode(`q ${f(p.drawW)} 0 0 ${f(p.drawH)} ${f(p.x)} ${f(p.y)} cm /Im${i} Do Q`);
      obj(contentNum(i), `<< /Length ${content.length} >>`, content);
      const im = p.image;
      obj(imageNum(i), `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${im.filter} /Length ${im.bytes.length} >>`, im.bytes);
    });
    const xrefPos = pos;
    const total = 3 + n*3;
    let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
    for(let k = 1; k < total; k++) xref += String(offsets[k]).padStart(10, '0') + ' 00000 n \n';
    push(xref);
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
    const out = new Uint8Array(pos);
    let o = 0;
    chunks.forEach(c => { out.set(c, o); o += c.length; });
    return out;
  }

  /* ---- Alle bladen van een printbatch -> PDF-bytes ---- */
  async function batchToPdf(batchEl, paperKey){
    const paper = PDF_PAPER_IN[paperKey] || PDF_PAPER_IN.a4;
    const sheets = [...batchEl.querySelectorAll('.page > svg')];
    if(!sheets.length) throw new Error('Niets om te printen');
    const css = await fontCss();
    const pages = [];
    for(const svgEl of sheets){
      const wIn = svgInches(svgEl, 'width'), hIn = svgInches(svgEl, 'height');
      let dpi = PDF_TARGET_DPI;
      while(Math.round(wIn*dpi) * Math.round(hIn*dpi) > PDF_MAX_CANVAS_PX) dpi -= 10;
      const pxW = Math.round(wIn*dpi), pxH = Math.round(hIn*dpi);
      const canvas = await renderSheet(svgEl, pxW, pxH, css);
      const image = await canvasToPdfImage(canvas);
      canvas.width = canvas.height = 0; // geheugen direct vrijgeven (iOS)
      // Op ware grootte: 1 inch = 72 pt. Volle bladen vullen het papier
      // precies; een kleiner blad komt bovenaan, gecentreerd.
      const wPt = paper.w*72, hPt = paper.h*72;
      const drawW = wIn*72, drawH = hIn*72;
      const full = Math.abs(wIn - paper.w) < 0.02 && Math.abs(hIn - paper.h) < 0.02;
      const x = full ? 0 : (wPt - drawW)/2;
      const y = full ? 0 : hPt - PDF_SMALL_SHEET_TOP_IN*72 - drawH;
      pages.push({ wPt, hPt, drawW, drawH, x, y, image });
    }
    return { bytes: buildPdf(pages), pageCount: pages.length, paperLabel: paper.label };
  }

  /* ---- UI: "PDF maken…" -> "Delen / opslaan" ---- */
  function overlay(){
    let el = document.getElementById('acPdfOverlay');
    if(!el){
      el = document.createElement('div');
      el.id = 'acPdfOverlay';
      el.className = 'ac-pdf-overlay';
      document.body.appendChild(el);
    }
    return el;
  }
  function closeOverlay(){
    const el = document.getElementById('acPdfOverlay');
    if(el) el.remove();
  }
  function deliver(file){
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      return navigator.share({ files:[file], title: file.name }).catch(err => {
        if(err && err.name === 'AbortError') return; // zelf geannuleerd
        download(file);
      });
    }
    download(file);
    return Promise.resolve();
  }
  function download(file){
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  async function exportSource(source, paperKey){
    const batch = document.getElementById(PDF_BATCH_IDS[source] || '');
    const el = overlay();
    el.innerHTML = `<div class="ac-pdf-box"><div class="ac-pdf-title">PDF maken…</div><p class="hint">Even geduld — het blad wordt op ware grootte (300 dpi) getekend.</p></div>`;
    try {
      if(!batch) throw new Error('Geen printblad gevonden');
      const key = source === 'zero-optic-calculator' ? (paperKey || 'a4') : 'a4';
      const result = await batchToPdf(batch, key);
      const name = `applied-concepts-${PDF_FILE_NAMES[source] || 'print'}${source === 'zero-optic-calculator' ? '-' + result.paperLabel : ''}.pdf`;
      const file = new File([result.bytes], name, { type:'application/pdf' });
      const scaleTip = source === 'dopecard'
        ? 'Print op <strong>100 % / werkelijke grootte</strong> (niet "passend maken") en knip het kaartje uit.'
        : 'Print op <strong>100 % / werkelijke grootte</strong> — niet "passend maken" of "aanpassen aan pagina", anders kloppen de maten (en dus de klikwaardes) niet meer.';
      el.innerHTML = `<div class="ac-pdf-box">
        <div class="ac-pdf-title">PDF klaar</div>
        <p class="hint">${result.paperLabel}, ${result.pageCount} ${result.pageCount === 1 ? 'pagina' : "pagina's"}, op ware grootte. ${scaleTip}</p>
        <button type="button" class="printbtn" id="acPdfShare" style="width:100%;padding:14px;">Delen / opslaan / printen</button>
        <button type="button" class="printbtn st-btn-secondary" id="acPdfClose" style="width:100%;padding:12px;margin-top:8px;">Sluiten</button>
      </div>`;
      // Delen gebeurt pas op deze tik: iOS staat het deelmenu alleen toe
      // direct vanuit een tik, niet na het (asynchrone) maken van de PDF.
      el.querySelector('#acPdfShare').addEventListener('click', () => { deliver(file); });
      el.querySelector('#acPdfClose').addEventListener('click', closeOverlay);
      return result;
    } catch(err){
      el.innerHTML = `<div class="ac-pdf-box">
        <div class="ac-pdf-title">PDF maken mislukt</div>
        <p class="hint">${String(err && err.message || err).replace(/[<>&]/g, '')} — je kunt het gewone printvenster gebruiken (let op: dat drukt op iPhone niet op ware grootte af).</p>
        <button type="button" class="printbtn" id="acPdfFallback" style="width:100%;padding:14px;">Printvenster openen</button>
        <button type="button" class="printbtn st-btn-secondary" id="acPdfClose" style="width:100%;padding:12px;margin-top:8px;">Sluiten</button>
      </div>`;
      el.querySelector('#acPdfFallback').addEventListener('click', () => { closeOverlay(); window.print(); });
      el.querySelector('#acPdfClose').addEventListener('click', closeOverlay);
      return null;
    }
  }

  window.AppliedConceptsPdf = { shouldUse, supported, exportSource, batchToPdf };
})();
