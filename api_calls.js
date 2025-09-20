// api_calls.js — Centralized OCR + Parse calls with debug helpers
// NOTE: no UI or CSS changes here.

// --------------------------- OCR (with debug) ---------------------------

async function callGoogleVisionOCRDebug(dataUrlOrHttpUrl, apiKey) {
  if (!apiKey) throw new Error('Google Cloud API key is missing.');

  const isDataUrl = typeof dataUrlOrHttpUrl === 'string' && dataUrlOrHttpUrl.startsWith('data:');
  const image = isDataUrl
    ? { content: dataUrlOrHttpUrl.split(',')[1] }
    : { source: { imageUri: dataUrlOrHttpUrl } };

  const payload = {
    requests: [
      {
        image,
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['en'] },
      },
    ],
  };






  const endpoint = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  const err = data?.responses?.[0]?.error?.message || (!response.ok && `HTTP ${response.status}`);
  if (err) throw new Error(`Google Vision API error: ${err}`);

  const r = data?.responses?.[0] || {};
  const text =
    r.fullTextAnnotation?.text ||
    (Array.isArray(r.textAnnotations) && r.textAnnotations[0]?.description) ||
    '';

  return { text, debug: { provider: 'google-vision', endpoint, payload } };
}





async function callOpenAIVisionOCRDebug(dataUrl, apiKey) {
  if (!apiKey) throw new Error('OpenAI API key is missing.');

  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all text from this image exactly as it appears.' },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 2000,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `API Error ${response.status}`);

  const text = data.choices?.[0]?.message?.content || '';
  return { text, debug: { provider: 'openai-vision', model: body.model, endpoint, payload: body } };
}







async function callClaudeVisionOCRDebug(dataUrl, apiKey) {
  if (!apiKey) throw new Error('Claude API key is missing.');

  const base64 = dataUrl.split(',')[1];
  const endpoint = 'https://api.anthropic.com/v1/messages';
  const body = {
    model: 'claude-3-haiku-20240307',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
          { type: 'text', text: 'Extract text from this image.' },
        ],
      },
    ],
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `API Error ${response.status}`);

  const text = data.content?.[0]?.text || '';
  return { text, debug: { provider: 'claude-vision', model: body.model, endpoint, payload: body } };
}

async function callGeminiVisionOCRDebug(dataUrl, apiKey) {
  if (!apiKey) throw new Error('Gemini API key is missing.');

  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl);
  const mime = (match && match[1]) || 'image/png';
  const b64 = (match && match[2]) || (dataUrl.split(',')[1] || '');

  const model = 'gemini-1.5-flash-latest';
  const endpointBase = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [
      {
        parts: [
          { text: 'Extract all text from this image exactly as it appears.' },
          { inline_data: { mime_type: mime, data: b64 } },
        ],
      },
    ],
  };

  const response = await fetch(`${endpointBase}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gemini Vision API ${response.status}`);

  const text =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

  return { text, debug: { provider: 'gemini-vision', model, endpoint: endpointBase, payload } };
}

// Centralized OCR entry points
export async function performOcrDebug(provider, dataUrl, settings) {
  switch (provider) {
    case 'google-vision':
      return await callGoogleVisionOCRDebug(dataUrl, settings.googleKey);
    case 'openai-vision':
      return await callOpenAIVisionOCRDebug(dataUrl, settings.openaiKey);
    case 'claude-vision':
      return await callClaudeVisionOCRDebug(dataUrl, settings.claudeKey);
    case 'gemini-vision':
      return await callGeminiVisionOCRDebug(dataUrl, settings.geminiKey);
    default:
      throw new Error(`Unknown OCR provider: ${provider}`);
  }
}

export async function performOcr(provider, dataUrl, settings) {
  const { text } = await performOcrDebug(provider, dataUrl, settings);
  return text;
}

// --------------------------- Parsing (with debug) ---------------------------

function buildParsePrompt(text) {
  return `Your task is to analyze ONLY the text provided below and extract event details into a single raw JSON object with keys: "title", "start", "end", "location", "hasTime". The current date is ${new Date().toString()}. Format dates as local ISO 8601 strings (e.g., "2025-09-23T17:30:00"). If info is missing, use null. --- ${text} ---`;
}

async function callOpenAIParseDebug(text, apiKey) {
  if (!apiKey) throw new Error('OpenAI key missing.');
  const endpoint = 'https://api.openai.com/v1/chat/completions';
  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: buildParsePrompt(text) }],
    response_format: { type: 'json_object' },
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `OpenAI API ${resp.status}`);
  const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  return { result, debug: { provider: 'openai', model: body.model, endpoint, payload: body } };
}

async function callGeminiParseDebug(text, apiKey) {
  if (!apiKey) throw new Error('Gemini key missing.');
  const model = 'gemini-1.5-flash-latest';
  const endpointBase = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: buildParsePrompt(text) }] }],
    generationConfig: { response_mime_type: 'application/json' },
  };
  const resp = await fetch(`${endpointBase}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `Gemini API ${resp.status}`);
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  const result = JSON.parse(raw);
  return { result, debug: { provider: 'gemini', model, endpoint: endpointBase, payload } };
}

async function callClaudeParseDebug(text, apiKey) {
  if (!apiKey) throw new Error('Claude key missing.');
  const endpoint = 'https://api.anthropic.com/v1/messages';
  const body = {
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildParsePrompt(text) + '\n\nReturn JSON inside <json> tags.' }],
  };
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error?.message || `Claude API ${resp.status}`);
  const match = data.content?.[0]?.text?.match(/<json>([\s\S]*?)<\/json>/);
  if (!match) throw new Error('Valid JSON not found in Claude response.');
  const result = JSON.parse(match[1]);
  return { result, debug: { provider: 'claude', model: body.model, endpoint, payload: body } };
}

export async function performLlmParseDebug(provider, text, settings) {
  switch (provider) {
    case 'openai':  return await callOpenAIParseDebug(text, settings.openaiKey);
    case 'gemini':  return await callGeminiParseDebug(text, settings.geminiKey);
    case 'claude':  return await callClaudeParseDebug(text, settings.claudeKey);
    case 'local':   return { result: { title: '(local parse)', start: null, end: null, location: null, hasTime: false }, debug: { provider: 'local' } };
    default: throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

// Back-compat
export async function performLlmParse(provider, text, settings) {
  const { result } = await performLlmParseDebug(provider, text, settings);
  return result;
}
