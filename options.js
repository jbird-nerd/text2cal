// options.js — no aesthetic changes. Test screen auto-loads /data/ocrtest.jpg

(function () {
  const $ = (id) => document.getElementById(id);

  // --- Defaults & constants (UI unchanged) ---
  const PACKAGED_TEST_IMAGE_PATH = 'data/ocrtest.jpg'; // you bundle this file
  const FALLBACK_INLINE_PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Yf3iK4AAAAASUVORK5CYII=';
  const DEFAULT_TEST_TEXT =
    'Let’s meet to review the launch plan tomorrow at 2:30 PM in Conference Room 4.';

  // Provider → required key element id (disables radios if missing)
  const API_REQUIREMENTS = {
    // OCR
    'tesseract': null,
    'openai-vision': 'openai-key',
    'gemini-vision': 'gemini-key',
    'google-vision': 'google-key',
    'claude-vision': 'claude-key',
    // Parser
    'local': null,
    'openai': 'openai-key',
    'gemini': 'gemini-key',
    'claude': 'claude-key',
  };

  // --- Local state ---
  let testImageDataUrl = null;

  // --- Logger (prepend latest) ---
  function log(msg, isError = false) {
    const el = $('diagLog');
    if (!el) return;
    const timestamp = new Date().toLocaleTimeString();
    const prefix = isError ? '❌ ERROR:' : '✅';
    el.textContent = `[${timestamp}] ${prefix} ${msg}\n` + el.textContent;
  }

  // --- Enable/disable provider radios based on keys present ---
  function updateAllOptionStates() {
    const keys = {
      'openai-key': $('openai-key')?.value || '',
      'claude-key': $('claude-key')?.value || '',
      'gemini-key': $('gemini-key')?.value || '',
      'google-key': $('google-key')?.value || '',
    };

    document.querySelectorAll('input[type="radio"]').forEach((radio) => {
      const requiredKeyId = API_REQUIREMENTS[radio.value];
      const hasKey = requiredKeyId === null || !!keys[requiredKeyId];
      radio.disabled = !hasKey;
      // Keep styling behavior exactly as before
      radio.parentElement?.classList.toggle('disabled', !hasKey);
    });
  }

  // --- Build option/test radio groups without changing aesthetics ---
  function createOptions(containerId, groupName, options, onChoose) {
    const container = $(containerId);
    if (!container) return;
    container.innerHTML = '';
    options.forEach((opt) => {
      const label = document.createElement('label');
      label.className = 'provider-option';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = groupName;
      input.value = opt.value;
      const span = document.createElement('span');
      span.textContent = opt.label;
      label.append(input, span);
      container.append(label);

      if (onChoose) {
        label.addEventListener('click', (e) => {
          if (input.disabled) e.preventDefault();
          else onChoose(opt.value);
        });
      }
    });
  }

  // --- Image handling for the OCR test panel ---
  function setTestImage(dataUrl) {
    testImageDataUrl = dataUrl;
    const preview = $('ocr-image-preview');
    const placeholder = $('ocr-image-placeholder');
    if (preview && placeholder) {
      preview.src = dataUrl;
      placeholder.style.display = 'none';
      preview.style.display = 'block';
    }
  }

  async function handlePastedImage(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (event) => {
          setTestImage(event.target.result);
          log('Image pasted successfully.');
        };
        reader.onerror = () => log('Failed to read pasted image.', true);
        reader.readAsDataURL(blob);
        return;
      }
    }
  }

  // --- Local Tesseract helpers (unchanged features) ---
  async function testLocalOCR() {
    log('Checking local Tesseract OCR assets...');
    const requiredFiles = [
      'tesseract/worker.min.js',
      'tesseract/eng.traineddata.gz',
      'tesseract/tesseract-core.wasm.js',
    ];
    let allGood = true;
    for (const file of requiredFiles) {
      try {
        const response = await fetch(chrome.runtime.getURL(file), { method: 'HEAD' });
        if (response.ok) log(`✓ ${file} - OK`);
        else {
          log(`✗ ${file} - ${response.status}`, true);
          allGood = false;
        }
      } catch (error) {
        log(`✗ ${file} - ERROR: ${error.message}`, true);
        allGood = false;
      }
    }
    if (allGood) log('All critical Tesseract files seem to be present.');
  }

  async function downloadTesseractBundle() {
    log('Sending download requests for Tesseract bundle...');
    if (!chrome.downloads) {
      log('chrome.downloads API not available.', true);
      return;
    }
    const assets = [
      { url: 'https://unpkg.com/tesseract.js@4.0.4/dist/tesseract.min.js', filename: 'tesseract/tesseract.min.js' },
      { url: 'https://unpkg.com/tesseract.js@4.0.4/dist/worker.min.js', filename: 'tesseract/worker.min.js' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/tesseract-core.wasm.js', filename: 'tesseract/tesseract-core.wasm.js' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/tesseract-core-simd.wasm.js', filename: 'tesseract/tesseract-core-simd.wasm.js' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/tesseract-core.wasm', filename: 'tesseract/tesseract-core.wasm' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/tesseract-core-simd.wasm', filename: 'tesseract/tesseract-core-simd.wasm' },
      { url: 'https://unpkg.com/tesseract.js-core@4.0.4/eng.traineddata.gz', filename: 'tesseract/eng.traineddata.gz' },
    ];
    for (const asset of assets) {
      try {
        await chrome.downloads.download({ url: asset.url, filename: asset.filename });
        log(`Downloading: ${asset.filename}`);
      } catch (error) {
        log(`Failed to download ${asset.filename}: ${error.message}`, true);
      }
    }
  }

  // --- Test runners talk to background (centralized API is there) ---
  async function runOcrTest(provider) {
    if (!testImageDataUrl) {
      log('No image loaded for the OCR test.', true);
      return;
    }
    log(`Requesting background script to test OCR with: ${provider}`);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DIAG_TEST_OCR',
        provider,
        dataUrl: testImageDataUrl, // always a data URL (from packaged image or pasted)
      });
      if (response && response.ok) {
        if (response.debug) log('OCR request debug: ' + JSON.stringify(response.debug, null, 2)); // NEW
        log(`OCR test success for ${provider}. Extracted ${response.text.length} chars.`);
        const input = $('parser-input');
        if (input) input.value = response.text;
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (e) {
      log(`OCR test FAILED for ${provider}: ${e.message}`, true);
    }
  }

  async function runParserTest(provider) {
    const textToParse = $('parser-input')?.value || '';
    if (!textToParse) {
      log('No text in the input box to parse.', true);
      return;
    }
    log(`Requesting background script to test Parser with: ${provider}`);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DIAG_TEST_PARSE',
        provider,
        text: textToParse,
      });
      if (response && response.ok) {
        log(`Parser test success for ${provider}:`);
        if (response.debug) log(JSON.stringify(response.debug, null, 2)); // safe if background returns it later
        log(JSON.stringify(response.result, null, 2));
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (e) {
      log(`Parser test FAILED for ${provider}: ${e.message}`, true);
    }
  }

  // --- Save/load configuration (unchanged behavior) ---
  async function saveConfiguration() {
    try {
      const config = {
        ocrMethod: document.querySelector('input[name="ocrMethod"]:checked')?.value,
        parseMethod: document.querySelector('input[name="parseMethod"]:checked')?.value,
        openaiKey: $('openai-key')?.value.trim() || '',
        claudeKey: $('claude-key')?.value.trim() || '',
        geminiKey: $('gemini-key')?.value.trim() || '',
        googleKey: $('google-key')?.value.trim() || '',
      };
      await chrome.storage.sync.set(config);
      const statusEl = $('saveStatus');
      if (statusEl) {
        statusEl.textContent = '✅ Configuration Saved!';
        setTimeout(() => {
          statusEl.textContent = '';
        }, 3000);
      }
      log('Configuration saved successfully.');
      updateAllOptionStates();
    } catch (e) {
      log(`Failed to save configuration: ${e.message}`, true);
    }
  }

  async function loadConfiguration() {
    try {
      const config = await chrome.storage.sync.get([
        'ocrMethod',
        'parseMethod',
        'openaiKey',
        'claudeKey',
        'geminiKey',
        'googleKey',
      ]);

      // Select saved radios or default to the first option in each group
      const ocrRadio =
        document.querySelector(`input[name="ocrMethod"][value="${config.ocrMethod}"]`) ||
        document.querySelector('input[name="ocrMethod"]');
      if (ocrRadio) ocrRadio.checked = true;

      const parseRadio =
        document.querySelector(`input[name="parseMethod"][value="${config.parseMethod}"]`) ||
        document.querySelector('input[name="parseMethod"]');
      if (parseRadio) parseRadio.checked = true;

      if ($('openai-key')) $('openai-key').value = config.openaiKey || '';
      if ($('claude-key')) $('claude-key').value = config.claudeKey || '';
      if ($('gemini-key')) $('gemini-key').value = config.geminiKey || '';
      if ($('google-key')) $('google-key').value = config.googleKey || '';

      updateAllOptionStates();
    } catch (e) {
      log(`Failed to load configuration: ${e.message}`, true);
    }
  }

  // --- Listeners (keep existing behavior) ---
  function setupEventListeners() {
    $('save-config-btn')?.addEventListener('click', saveConfiguration);
    ['openai-key', 'claude-key', 'gemini-key', 'google-key'].forEach((id) => {
      $(id)?.addEventListener('input', updateAllOptionStates);
    });
    $('check-files-btn')?.addEventListener('click', testLocalOCR);
    $('download-files-btn')?.addEventListener('click', downloadTesseractBundle);
    $('ocr-image-dropzone')?.addEventListener('paste', handlePastedImage);
    $('clear-log-btn')?.addEventListener('click', () => {
      const logEl = $('diagLog');
      if (logEl) logEl.textContent = '';
    });
    $('copy-log-btn')?.addEventListener('click', () => {
      const logEl = $('diagLog');
      if (!logEl) return;
      navigator.clipboard
        .writeText(logEl.textContent)
        .then(() => log('Log copied to clipboard.'))
        .catch((err) => log('Failed to copy log: ' + err, true));
    });
  }

  // --- Boot ---
  async function initialize() {
    // Main provider choices (no visual changes)
    createOptions('ocr-method-options', 'ocrMethod', [
      { value: 'tesseract', label: 'Local (Tesseract)' },
      { value: 'openai-vision', label: 'OpenAI Vision' },
      { value: 'gemini-vision', label: 'Gemini Vision' },
      { value: 'google-vision', label: 'Google Vision' },
      { value: 'claude-vision', label: 'Claude Vision' },
    ]);
    createOptions('parse-method-options', 'parseMethod', [
      { value: 'local', label: 'Local Parser' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'gemini', label: 'Gemini' },
      { value: 'claude', label: 'Claude' },
    ]);

    // Test triggers (no UI changes)
    createOptions('ocr-test-options', 'ocr-tester', [
      { value: 'tesseract', label: 'Tesseract' },
      { value: 'openai-vision', label: 'OpenAI' },
      { value: 'gemini-vision', label: 'Gemini' },
      { value: 'google-vision', label: 'Google' },
      { value: 'claude-vision', label: 'Claude' },
    ], runOcrTest);

    createOptions('parser-test-options', 'parser-tester', [
      { value: 'local', label: 'Local Parser' },
      { value: 'openai', label: 'OpenAI' },
      { value: 'gemini', label: 'Gemini' },
      { value: 'claude', label: 'Claude' },
    ], runParserTest);

    setupEventListeners();
    await loadConfiguration();

    // Load packaged test image and convert to data URL for all providers
    (async function preloadPackagedTestImage() {
      try {
        const url = chrome.runtime.getURL(PACKAGED_TEST_IMAGE_PATH);
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();

        const reader = new FileReader();
        reader.onload = () => {
          setTestImage(reader.result); // data URL
          log('Loaded default OCR test image from /data/ocrtest.jpg.');
        };
        reader.onerror = (e) => log('Failed to read /data/ocrtest.jpg: ' + e.message, true);
        reader.readAsDataURL(blob);
      } catch (e) {
        setTestImage(FALLBACK_INLINE_PNG);
        log('Could not load /data/ocrtest.jpg. Using fallback inline image. Paste your own to test.', true);
      }
    })();

    // Ensure parser test is ready immediately
    const parserInput = $('parser-input');
    if (parserInput && !parserInput.value) parserInput.value = DEFAULT_TEST_TEXT;
  }

  document.addEventListener('DOMContentLoaded', initialize);
})();
