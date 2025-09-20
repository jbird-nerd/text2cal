/* components.js — centralized OCR/parse + cleaner logs; no CSS edits */

(function () {
  let root, logBox, ocrBox, statusEl, imgEl, methodsEl;

  // --------- utilities ----------
  function logMessage(msg) {
    try {
      const now = new Date().toLocaleTimeString();
      const line = `[${now}] ${msg}`;
      console.log('[T2C]', line);
      if (logBox) logBox.value = (line + '\n' + logBox.value).slice(0, 200000);
    } catch {}
  }
  const z2 = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${z2(d.getMonth()+1)}-${z2(d.getDate())}`;
  const fmtTime = d => `${z2(d.getHours())}:${z2(d.getMinutes())}`;
  const rid = () => (crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(36).slice(2)));

  // --------- settings ----------
  async function getSettings() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'EC_GET_SETTINGS' });
      if (res?.ok) {
        logMessage(`Settings loaded: OCR=${res.settings.ocrMethod}, Parse=${res.settings.parseMethod}`);
        if (methodsEl) methodsEl.textContent = `OCR: ${res.settings.ocrMethod} • Parse: ${res.settings.parseMethod}`;
        return res.settings;
      }
    } catch (e) {
      logMessage(`Failed to get settings: ${e.message}`);
    }
    const fallback = { ocrMethod: 'tesseract', parseMethod: 'local' };
    if (methodsEl) methodsEl.textContent = `OCR: ${fallback.ocrMethod} • Parse: ${fallback.parseMethod}`;
    logMessage(`Using default settings: OCR=${fallback.ocrMethod}, Parse=${fallback.parseMethod}`);
    return fallback;
  }

  // --------- API (centralized-first, with debug logging) ----------
  function sanitizeDebugForLog(d) {
    if (!d) return d;
    try {
      const j = JSON.parse(JSON.stringify(d));
      // extra defense if background missed anything
      try {
        // Google
        if (j.payload?.requests?.[0]?.image?.content) j.payload.requests[0].image.content = '<base64 omitted>';
      } catch {}
      // OpenAI Vision
      try {
        const msgs = j.payload?.messages;
        if (Array.isArray(msgs)) {
          for (const m of msgs) {
            if (Array.isArray(m.content)) {
              for (const c of m.content) {
                if (c?.type === 'image_url' && typeof c.image_url?.url === 'string' && c.image_url.url.startsWith('data:')) {
                  c.image_url.url = '<data-url omitted>';
                }
              }
            }
          }
        }
      } catch {}
      // Gemini Vision
      try {
        const parts = j.payload?.contents?.[0]?.parts;
        if (Array.isArray(parts)) {
          for (const p of parts) {
            if (p?.inline_data?.data) p.inline_data.data = '<base64 omitted>';
          }
        }
      } catch {}
      // Claude Vision
      try {
        const msgs2 = j.payload?.messages;
        if (Array.isArray(msgs2)) {
          for (const m of msgs2) {
            if (Array.isArray(m.content)) {
              for (const c of m.content) {
                if (c?.type === 'image' && c?.source?.data) c.source.data = '<base64 omitted>';
              }
            }
          }
        }
      } catch {}
      // Truncate any giant strings
      const s = JSON.stringify(j);
      return s.length > 4000 ? JSON.parse(s.slice(0, 4000)) : j;
    } catch { return d; }
  }

  async function runCentralizedOcr(provider, dataUrl) {
    const requestId = rid();
    const res = await chrome.runtime.sendMessage({ type: 'EC_RUN_OCR', provider, dataUrl, requestId });
    if (!res?.ok) throw new Error(res?.error || 'Centralized OCR failed');
    if (res.requestId && res.requestId !== requestId) throw new Error('Stale OCR response');
    if (res.debug) logMessage('OCR request debug: ' + JSON.stringify(sanitizeDebugForLog(res.debug), null, 2));
    return res.text || '';
  }
  async function runCentralizedParse(provider, text) {
    const requestId = rid();
    const res = await chrome.runtime.sendMessage({ type: 'EC_RUN_PARSE', provider, text, requestId });
    if (!res?.ok) throw new Error(res?.error || 'Centralized parse failed');
    if (res.requestId && res.requestId !== requestId) throw new Error('Stale parse response');
    if (res.debug) logMessage('Parse request debug: ' + JSON.stringify(res.debug, null, 2));
    return res.result;
  }

  // --------- DOM (use your CSS classes) ----------
  function ensureRoot() {
   if (root) { 
  // Force modal to front when showing again
  root.style.display = 'flex';
  root.style.zIndex = '2147483647';
  root.style.position = 'fixed';
  root.style.inset = '0';
  return; 
}

    root = document.createElement('div');
    root.className = 't2c-modal-backdrop';
    root.innerHTML = `
      <div class="t2c-window" role="dialog" aria-modal="true">
        <div class="t2c-head">
          <h3>Event Capture</h3>
          <div class="smallnote" data-status>Ready - review and edit as needed</div>
          <div class="smallnote" data-methods></div>
          <button class="t2c-btn" data-act="toggle-log">Show Log</button>
          <button class="t2c-x" data-act="close" title="Close">×</button>
        </div>
        <div class="t2c-body">
          <div class="t2c-preview-box"><img data-img alt=""></div>

          <div class="t2c-topbtns">
            <button class="t2c-btn primary" data-act="add">Add to Calendar</button>
            <button class="t2c-btn" data-act="redraw">Redraw Area</button>
            <button class="t2c-btn" data-act="toggle-log">Show Log</button>
          </div>

          <div class="t2c-grid">
            <div class="t2c-field">
              <label>Title:</label>
              <input data-title type="text" placeholder="Event title">
            </div>

            <div class="t2c-field-row">
              <div class="t2c-field">
                <label>Start</label>
                <input data-start-date type="date">
              </div>
              <div class="t2c-field">
                <label>&nbsp;</label>
                <input data-start-time type="time" data-time-start>
              </div>
              <div class="t2c-field">
                <label>End</label>
                <input data-end-date type="date">
              </div>
              <div class="t2c-field">
                <label>&nbsp;</label>
                <input data-end-time type="time" data-time-end>
              </div>
              <div class="t2c-field" style="align-self:end">
                <label><input type="checkbox" data-all-day> All-day</label>
              </div>
            </div>

            <div class="t2c-field">
              <label>Location:</label>
              <input data-location type="text" placeholder="Event location">
            </div>

            <div class="t2c-field t2c-ocr" data-ocr-section>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <h4 style="margin:0;font-size:13px">OCR Text</h4>
                <div class="t2c-topbtns" style="margin:0">
                  <button class="t2c-btn" data-ocr-clear>Clear</button>
                  <button class="t2c-btn" data-ocr-copy>Copy</button>
                </div>
              </div>
              <textarea data-ocr></textarea>
            </div>

            <div class="t2c-field" data-log-section style="display:none">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <h4 style="margin:0;font-size:13px">Diagnostic Log</h4>
                <div class="t2c-topbtns" style="margin:0">
                  <button class="t2c-btn" data-log-clear>Clear</button>
                  <button class="t2c-btn" data-log-copy>Copy</button>
                </div>
              </div>
              <textarea class="t2c-log" data-log readonly></textarea>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    root.style.display = 'block'; // first-time visibility

    // refs
    statusEl = root.querySelector('[data-status]');
    methodsEl = root.querySelector('[data-methods]');
    imgEl = root.querySelector('[data-img]');
    ocrBox = root.querySelector('[data-ocr]');
    logBox = root.querySelector('[data-log]');

    // events
    root.querySelector('[data-act="close"]').addEventListener('click', () => root.style.display = 'none');
    root.addEventListener('click', (e) => { if (e.target === root) root.style.display = 'none'; });

    const toggleButtons = root.querySelectorAll('[data-act="toggle-log"]');
    toggleButtons.forEach(btn => btn.addEventListener('click', () => {
      const sec = root.querySelector('[data-log-section]');
      const vis = sec.style.display !== 'none';
      sec.style.display = vis ? 'none' : 'block';
      toggleButtons.forEach(b => b.textContent = vis ? 'Show Log' : 'Hide Log');
    }));

    root.querySelector('[data-ocr-clear]').addEventListener('click', () => ocrBox.value = '');
    root.querySelector('[data-ocr-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(ocrBox.value); } catch {}
    });
    root.querySelector('[data-log-clear]').addEventListener('click', () => logBox.value = '');
    root.querySelector('[data-log-copy]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(logBox.value); } catch {}
    });
    root.querySelector('[data-act="redraw"]').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 't2c.redraw' });
    });
    root.querySelector('[data-act="add"]').addEventListener('click', addToCalendar);

    // All-day behavior: disable/enable times
    const allDayCb = root.querySelector('[data-all-day]');
    const timeStartEl = root.querySelector('[data-time-start]');
    const timeEndEl = root.querySelector('[data-time-end]');
    function syncAllDay() {
      const on = allDayCb.checked;
      timeStartEl.disabled = on;
      timeEndEl.disabled = on;
      if (on) { timeStartEl.value = ''; timeEndEl.value = ''; }
    }
    allDayCb.addEventListener('change', syncAllDay);
    syncAllDay();
  }

  function addToCalendar() {
    const title = root.querySelector('[data-title]').value || 'New Event';
    const location = root.querySelector('[data-location]').value || '';
    const allDay = root.querySelector('[data-all-day]').checked;

    let url = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
    url += `&text=${encodeURIComponent(title)}&location=${encodeURIComponent(location)}&details=${encodeURIComponent('Created by Text2Cal')}`;

    if (allDay) {
      const s = root.querySelector('[data-start-date]').value;
      const e = root.querySelector('[data-end-date]').value || s;
      if (!s) { alert('Please set a start date for an all-day event'); return; }
      const ed = new Date(e); ed.setDate(ed.getDate() + 1);
      const sd = s.replace(/-/g,''); const ee = `${ed.getFullYear()}${z2(ed.getMonth()+1)}${z2(ed.getDate())}`;
      url += `&dates=${sd}/${ee}`;
    } else {
      const sD = root.querySelector('[data-start-date]').value;
      const sT = root.querySelector('[data-start-time]').value;
      const eD = root.querySelector('[data-end-date]').value || sD;
      const eT = root.querySelector('[data-end-time]').value || sT;
      if (!sD || !sT) { alert('Please set start time, end date, and end time, or check "All-day"'); return; }
      url += `&dates=${sD.replace(/-/g,'')}T${sT.replace(':','')}00/${eD.replace(/-/g,'')}T${eT.replace(':','')}00`;
    }
    window.open(url, '_blank');
  }














async function show(data) {
  ensureRoot();

  // Force immediate visibility with proper styling
  setTimeout(() => {
    if (root) {
      root.style.display = 'flex';
      root.style.zIndex = '2147483647';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.background = 'rgba(0,0,0,0.8)';
      root.style.alignItems = 'flex-start';
      root.style.justifyContent = 'center';
      root.style.paddingTop = '5vh';
      
      const window = root.querySelector('.t2c-window');
      if (window) {
        window.style.position = 'relative';
        window.style.zIndex = '2147483647';
      }
    }
  }, 200);

  // reset UI
  root.querySelector('[data-title]').value = '';







    // reset UI
    root.querySelector('[data-title]').value = '';
    root.querySelector('[data-location]').value = '';
    root.querySelector('[data-start-date]').value = '';
    root.querySelector('[data-start-time]').value = '';
    root.querySelector('[data-end-date]').value = '';
    root.querySelector('[data-end-time]').value = '';
    root.querySelector('[data-all-day]').checked = false;
    root.querySelector('[data-log-section]').style.display = 'none';
    root.querySelectorAll('[data-act="toggle-log"]').forEach(b => b.textContent = 'Show Log');
    if (ocrBox) ocrBox.value = '';
    if (logBox) logBox.value = '';

    imgEl.src = data?.imageDataUrl || '';
    statusEl.textContent = 'Processing…';
    logMessage('=== PROCESSING START ===');

    try {
      const settings = await getSettings();
      logMessage(`Selected OCR method: ${settings.ocrMethod}`);
      logMessage(`Selected parsing method: ${settings.parseMethod}`);
      logMessage(`Available API keys: OpenAI=${!!settings.openaiKey}, Claude=${!!settings.claudeKey}, Gemini=${!!settings.geminiKey}`);

      const text = await runCentralizedOcr(settings.ocrMethod, data?.imageDataUrl || '');
      ocrBox.value = text;
      logMessage(`OCR completed using ${settings.ocrMethod}. Extracted ${text.length} characters`);
      logMessage(`OCR text: ${JSON.stringify(text)}`);

      const parsed = await runCentralizedParse(settings.parseMethod, text);

      // populate fields
      root.querySelector('[data-title]').value = parsed.title || '';
      root.querySelector('[data-location]').value = parsed.location || '';

      const sd = parsed.start ? new Date(parsed.start) : (parsed.startDate ? new Date(parsed.startDate) : null);
      const ed = parsed.end ? new Date(parsed.end) : (parsed.endDate ? new Date(parsed.endDate) : null);
      if (sd) {
        root.querySelector('[data-start-date]').value = fmtDate(sd);
        root.querySelector('[data-start-time]').value = fmtTime(sd);
      }
      if (ed) {
        root.querySelector('[data-end-date]').value = fmtDate(ed);
        root.querySelector('[data-end-time]').value = fmtTime(ed);
      }

      const allDay = parsed.hasTime === false;
      const allDayCb = root.querySelector('[data-all-day]');
      allDayCb.checked = !!allDay;
      allDayCb.dispatchEvent(new Event('change'));

      logMessage('=== PROCESSING COMPLETE ===');
      logMessage(`Final result: title="${parsed.title}", hasTime=${parsed.hasTime}, location="${parsed.location}"`);
      statusEl.textContent = 'Ready - review and edit as needed';
    } catch (e) {
      logMessage('=== PROCESSING ERROR ===');
      logMessage(`Error: ${e.message}`);
      statusEl.textContent = 'Processing failed - check log for details';
    }
  }

  window.__t2c_show = show;
})();
