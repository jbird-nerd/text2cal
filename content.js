/* content.js — capture rectangle + open modal (no CSP injections) */

(() => {
  const NS = "t2c-cap";
  let overlay, guide, box, start, onMove, onUp;

  // --- small utilities -------------------------------------------------------
  const dpr = () => (window.devicePixelRatio || 1);

  function ensureOverlay() {
    if (overlay) return;

    // container (no greying, clicks only while capturing)
    overlay = document.createElement("div");
    overlay.id = `${NS}-overlay`;
    Object.assign(overlay.style, {
      position: "fixed", 
      inset: "0", 
      zIndex: "2147483646",
      cursor: "crosshair", 
      background: "transparent"
    });

    // dashed rectangle (the selection)
    box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed", 
      border: "3px dashed #3b82f6", 
      background: "rgba(59, 130, 246, 0.1)",
      left: "0", 
      top: "0", 
      width: "0", 
      height: "0", 
      pointerEvents: "none",
      borderRadius: "4px"
    });

    // tiny helper bubble
    guide = document.createElement("div");
    guide.textContent = "Drag to capture • Esc to cancel";
    Object.assign(guide.style, {
      position: "fixed", 
      left: "20px", 
      top: "20px",
      background: "#1f2937", 
      color: "#f3f4f6", 
      padding: "8px 12px",
      borderRadius: "8px", 
      font: "13px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Inter,Arial,sans-serif",
      boxShadow: "0 8px 32px rgba(0,0,0,.3)",
      zIndex: "2147483647"
    });

    overlay.appendChild(box);
    overlay.appendChild(guide);
  }

  function removeOverlay() {
    if (!overlay) return;
    overlay.remove(); 
    overlay = null; 
    box = null; 
    guide = null;
    document.removeEventListener("keydown", onEsc, true);
  }

  function onEsc(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      removeOverlay();
    }
  }

  // --- capture flow ----------------------------------------------------------
  function beginCapture() {
    ensureOverlay();
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onEsc, true);

    start = null;
    
    onMove = (ev) => {
      if (!start) return;
      const x = Math.min(ev.clientX, start.x);
      const y = Math.min(ev.clientY, start.y);
      const w = Math.abs(ev.clientX - start.x);
      const h = Math.abs(ev.clientY - start.y);
      Object.assign(box.style, { 
        left: x + "px", 
        top: y + "px", 
        width: w + "px", 
        height: h + "px" 
      });
    };
    
    onUp = async (ev) => {
      overlay.removeEventListener("mousemove", onMove);
      overlay.removeEventListener("mouseup", onUp);
      
      if (!start) { 
        removeOverlay(); 
        return; 
      }

      const rect = {
        x: Math.min(ev.clientX, start.x),
        y: Math.min(ev.clientY, start.y),
        w: Math.abs(ev.clientX - start.x),
        h: Math.abs(ev.clientY - start.y),
        dpr: dpr()
      };

      // Minimum size check
      if (rect.w < 10 || rect.h < 10) {
        removeOverlay();
        return;
      }

      removeOverlay();
      
      try {
        const imageDataUrl = await screenshotAndCrop(rect);
        openModalWith({ 
          imageDataUrl, 
          _providers: { ocr: "—", parse: "—" } 
        });
      } catch (err) {
        console.error("[T2C] Capture error:", err);
        alert("Capture Error: " + (err?.message || err));
      }
    };

    overlay.addEventListener("mousedown", (ev) => {
      if (ev.button !== 0) return;
      start = { x: ev.clientX, y: ev.clientY };
      overlay.addEventListener("mousemove", onMove);
      overlay.addEventListener("mouseup", onUp);
      ev.preventDefault();
    }, { once: true });
  }

  async function screenshotAndCrop(rect) {
    // 1) ask background for a full-tab PNG
    const response = await chrome.runtime.sendMessage({ type: "t2c.screenshot" });
    
    if (!response?.ok || !response?.dataUrl) {
      throw new Error(response?.err || "screenshot failed");
    }

    // 2) crop it locally in the content world
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = response.dataUrl;
    });

    const sx = Math.max(0, Math.floor(rect.x * rect.dpr));
    const sy = Math.max(0, Math.floor(rect.y * rect.dpr));
    const sw = Math.max(1, Math.floor(rect.w * rect.dpr));
    const sh = Math.max(1, Math.floor(rect.h * rect.dpr));

    const canvas = document.createElement("canvas");
    canvas.width = sw; 
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    
    return canvas.toDataURL("image/png");
  }

  // --- modal opener (no CSP tricks; no inline script injection) --------------
  function resolveOpener() {
    if (typeof window.__t2c_show === "function") return window.__t2c_show;
    
    const fallbacks = [
      "openCaptureModal", 
      "showEventCaptureModal", 
      "openModal", 
      "showModal"
    ];
    
    for (const k of fallbacks) {
      if (typeof window[k] === "function") return window[k];
    }
    
    return null;
  }

  function openModalWith(data) {
    const opener = resolveOpener();
    if (!opener) {
      console.error("[T2C] No modal opener found. Expected __t2c_show function from components.js");
      alert("Text2Cal: modal UI function not found. Please reload the page and try again.");
      return;
    }
    
    try { 
      opener(data || {}); 
    } catch (err) {
      console.error("[T2C] Modal open error:", err);
      alert("Text2Cal: could not open modal (see console).");
    }
  }

  // --- runtime wiring --------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "t2c.ping") { 
      sendResponse({ ok: true }); 
      return false; // FIXED: explicitly return false for sync response
    }
    if (msg?.type === "t2c.beginCapture") { 
      beginCapture(); 
      sendResponse({ ok: true }); 
      return false; // FIXED: explicitly return false for sync response
    }
    if (msg?.type === "t2c.redraw") { 
      beginCapture(); 
      sendResponse({ ok: true }); 
      return false; // FIXED: explicitly return false for sync response
    }
    
    return false; // FIXED: return false for any unhandled messages
  });

  console.log("[T2C] Content script loaded");
})();