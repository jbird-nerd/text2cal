// sandbox.js — runs inside chrome-extension:// sandbox.html

const WORKER_PATH = chrome.runtime.getURL('tesseract/worker.min.js');
const CORE_SIMD_JS = chrome.runtime.getURL('tesseract/tesseract-core-simd.wasm.js');
const CORE_JS      = chrome.runtime.getURL('tesseract/tesseract-core.wasm.js');
const LANG_PATH    = chrome.runtime.getURL('tesseract/');

let corePathChosen = CORE_SIMD_JS;
let ready = false;

async function tryInit(corePath) {
  const w = await Tesseract.createWorker({
    workerPath: WORKER_PATH,
    corePath,
    langPath: LANG_PATH,
    workerBlobURL: false,
    logger: () => {}
  });
  await w.terminate();
}

async function initTesseract() {
  try {
    await tryInit(corePathChosen);
    ready = true;
    parent.postMessage({ type: 'TESS_READY' }, '*');
  } catch (e) {
    // fallback to non-SIMD once
    if (corePathChosen !== CORE_JS) {
      corePathChosen = CORE_JS;
      try {
        await tryInit(corePathChosen);
        ready = true;
        parent.postMessage({ type: 'TESS_READY' }, '*');
        return;
      } catch (e2) {
        ready = false;
        parent.postMessage({ type: 'TESS_READY', error: String(e2) }, '*');
      }
    } else {
      ready = false;
      parent.postMessage({ type: 'TESS_READY', error: String(e) }, '*');
    }
  }
}

window.addEventListener('message', async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'TESS_PING') {
    parent.postMessage({ type: 'TESS_READY', error: ready ? null : 'not-initialized' }, '*');
    return;
  }
  if (msg.type !== 'TESS_OCR') return;
  if (!ready) {
    parent.postMessage({ type: 'TESS_OCR_RESULT', ok:false, error:'Sandbox not initialized' }, '*');
    return;
  }

  let worker;
  try {
    worker = await Tesseract.createWorker({
      workerPath: WORKER_PATH,
      corePath: corePathChosen,
      langPath: LANG_PATH,
      workerBlobURL: false,
      logger: () => {}
    });
    await worker.loadLanguage('eng');
    await worker.initialize('eng', msg.psm ?? Tesseract.PSM.SINGLE_LINE);
    const { data } = await worker.recognize(msg.dataUrl);
    await worker.terminate();
    parent.postMessage({ type:'TESS_OCR_RESULT', ok:true, text:(data && data.text) || '' }, '*');
  } catch (e) {
    try { await worker?.terminate(); } catch {}
    parent.postMessage({ type:'TESS_OCR_RESULT', ok:false, error:String(e) }, '*');
  }
});

window.addEventListener('DOMContentLoaded', initTesseract);
