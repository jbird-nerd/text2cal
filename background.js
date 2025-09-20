import { performOcrDebug, performLlmParse, performLlmParseDebug } from './api_calls.js';

console.log('[T2C] Background service worker loaded (module)');

// --- Helper: async sendResponse wrapper ---
function handle(promise, sendResponse) {
  promise.then(
    (res) => sendResponse(res),
    (err) => {
      console.error('[T2C] BG error:', err);
      sendResponse({ ok: false, error: err?.message || String(err) });
    }
  );
  return true; // keep message channel open
}

// --- sanitize debug so we don't spam base64 into logs/messages ---
function redactBase64InPlace(obj) {
  try {
    if (!obj) return obj;
    // Google Vision
    if (obj.payload?.requests?.[0]?.image?.content) obj.payload.requests[0].image.content = '<base64 omitted>';
    if (obj.payload?.requests?.[0]?.image?.source?.imageUri?.startsWith('data:')) {
      obj.payload.requests[0].image.source.imageUri = '<data-url omitted>';
    }
    // OpenAI Vision
    const msgs = obj.payload?.messages;
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
    // Gemini Vision
    const parts = obj.payload?.contents?.[0]?.parts;
    if (Array.isArray(parts)) {
      for (const p of parts) {
        if (p?.inline_data?.data) p.inline_data.data = '<base64 omitted>';
      }
    }
    // Claude Vision
    const msgs2 = obj.payload?.messages;
    if (Array.isArray(msgs2)) {
      for (const m of msgs2) {
        if (Array.isArray(m.content)) {
          for (const c of m.content) {
            if (c?.type === 'image' && c?.source?.data) c.source.data = '<base64 omitted>';
          }
        }
      }
    }
    return obj;
  } catch { return obj; }
}

function truncatePromptInPlace(obj, max = 1600) {
  try {
    if (!obj || !obj.payload) return obj;
    // OpenAI / Claude: look in messages[0].content (string for these calls)
    if (Array.isArray(obj.payload.messages) && obj.payload.messages[0]?.content) {
      const c = obj.payload.messages[0].content;
      if (typeof c === 'string' && c.length > max) {
        obj.payload.messages[0].content = c.slice(0, max) + '… [truncated]';
      }
    }
    // Gemini: contents[0].parts[0].text
    if (obj.payload.contents?.[0]?.parts?.[0]?.text) {
      const t = obj.payload.contents[0].parts[0].text;
      if (t.length > max) obj.payload.contents[0].parts[0].text = t.slice(0, max) + '… [truncated]';
    }
    return obj;
  } catch { return obj; }
}

// --- Tesseract bridge (kept) ---
async function callTesseractOcr(dataUrl) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage({ type: 'TESSERACT_OCR_REQUEST', dataUrl }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response || !response.ok) return reject(new Error(response?.error || 'Tesseract OCR failed'));
        resolve(response.text || '');
      });
    } catch (e) { reject(e); }
  });
}

// --- Content script bootstrap (kept) ---
function isCapturableUrl(url) {
  if (!url) return false;
  return /^https?:|^file:|^ftp:/i.test(url);
}

async function ensureContent(tabId, url) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 't2c.ping' });
    console.log('[T2C] Content scripts already injected');
    return true;
  } catch {
    if (!isCapturableUrl(url)) {
      console.log('[T2C] URL not capturable:', url);
      return false;
    }
    try {
      console.log('[T2C] Injecting content scripts...');
      
      // Insert CSS first
      await chrome.scripting.insertCSS({ 
        target: { tabId }, 
        files: ['overlay.css'] 
      });
      console.log('[T2C] CSS injected successfully');
      
      // Inject components.js first (it sets up the modal)
      await chrome.scripting.executeScript({ 
        target: { tabId }, 
        files: ['components.js'] 
      });
      console.log('[T2C] components.js injected successfully');
      
      // Then inject content.js (it handles capture and calls the modal)
      await chrome.scripting.executeScript({ 
        target: { tabId }, 
        files: ['content.js'] 
      });
      console.log('[T2C] content.js injected successfully');
      
      // Verify injection worked
      setTimeout(async () => {
        try {
          const result = await chrome.tabs.sendMessage(tabId, { type: 't2c.ping' });
          console.log('[T2C] Post-injection ping result:', result);
        } catch (e) {
          console.error('[T2C] Post-injection ping failed:', e);
        }
      }, 100);
      
      return true;
    } catch (e) {
      console.error('[T2C] Failed to inject content scripts:', e);
      console.error('[T2C] Error details:', e.message, e.stack);
      return false;
    }
  }
}

async function startCapture(tab) {
  if (!tab?.id) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = active;
  }
  if (!tab?.id) return;

  const ok = await ensureContent(tab.id, tab.url || '');
  if (!ok) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { type: 't2c.beginCapture' });
  } catch (e) {
    console.error('[T2C] Failed to send beginCapture:', e);
  }
}

// Toolbar button / keyboard (kept)
chrome.action?.onClicked.addListener((tab) => { startCapture(tab); });
chrome.commands?.onCommand.addListener((cmd) => { if (cmd === 'start-capture') startCapture(); });

// --- Message router ----------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Diagnostics: OCR (options page test)
  if (msg?.type === 'DIAG_TEST_OCR') {
    return handle((async () => {
      const settings = await chrome.storage.sync.get(['openaiKey','claudeKey','geminiKey','googleKey']);
      if (msg.provider === 'tesseract') {
        const text = await callTesseractOcr(msg.dataUrl);
        return { ok: true, text, debug: { provider: 'tesseract' } };
      }
      const { text, debug } = await performOcrDebug(msg.provider, msg.dataUrl, settings);
      return { ok: true, text, debug: redactBase64InPlace(debug) };
    })(), sendResponse);
  }

  // Diagnostics: Parse (options page test)
  if (msg?.type === 'DIAG_TEST_PARSE') {
    return handle((async () => {
      const settings = await chrome.storage.sync.get(['openaiKey','claudeKey','geminiKey']);
      const { result, debug } = await performLlmParseDebug(msg.provider, msg.text || '', settings);
      return { ok: true, result, debug: truncatePromptInPlace(debug) };
    })(), sendResponse);
  }

  // Settings for modal
  if (msg?.type === 'EC_GET_SETTINGS') {
    return handle((async () => {
      const s = await chrome.storage.sync.get([
        'ocrMethod', 'parseMethod',
        'openaiKey', 'claudeKey', 'geminiKey', 'googleKey'
      ]);
      const settings = {
        ocrMethod: s.ocrMethod || 'tesseract',
        parseMethod: s.parseMethod || 'local',
        openaiKey: s.openaiKey || '',
        claudeKey: s.claudeKey || '',
        geminiKey: s.geminiKey || '',
        googleKey: s.googleKey || '',
      };
      return { ok: true, settings };
    })(), sendResponse);
  }

  // Centralized OCR for modal — with debug
  if (msg?.type === 'EC_RUN_OCR') {
    return handle((async () => {
      const s = await chrome.storage.sync.get(['openaiKey','claudeKey','geminiKey','googleKey']);
      const settings = {
        openaiKey: s.openaiKey || '',
        claudeKey: s.claudeKey || '',
        geminiKey: s.geminiKey || '',
        googleKey: s.googleKey || '',
      };
      if (msg.provider === 'tesseract') {
        const text = await callTesseractOcr(msg.dataUrl);
        return { ok: true, text, debug: { provider: 'tesseract' }, requestId: msg.requestId || null };
      }
      const { text, debug } = await performOcrDebug(msg.provider, msg.dataUrl, settings);
      return { ok: true, text, debug: redactBase64InPlace(debug), requestId: msg.requestId || null };
    })(), sendResponse);
  }

  // Centralized Parse for modal — with debug
  if (msg?.type === 'EC_RUN_PARSE') {
    return handle((async () => {
      const s = await chrome.storage.sync.get(['openaiKey','claudeKey','geminiKey']);
      const settings = { openaiKey: s.openaiKey || '', claudeKey: s.claudeKey || '', geminiKey: s.geminiKey || '' };
      const { result, debug } = await performLlmParseDebug(msg.provider, msg.text || '', settings);
      return { ok: true, result, debug: truncatePromptInPlace(debug), requestId: msg.requestId || null };
    })(), sendResponse);
  }

  // Screenshot - FIXED: explicit async handling
  if (msg?.type === 't2c.screenshot') {
    return handle((async () => {
      const dataUrl = await chrome.tabs.captureVisibleTab(sender?.tab?.windowId, { format: 'png' });
      return { ok: true, dataUrl };
    })(), sendResponse);
  }

  // Redraw - FIXED: synchronous response
  if (msg?.type === 't2c.redraw') {
    startCapture(sender?.tab);
    sendResponse({ ok: true });
    return false; // FIXED: return false for sync response
  }

  return false; // FIXED: return false for unhandled messages
});
