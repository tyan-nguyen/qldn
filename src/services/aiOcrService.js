/**
 * Service trích xuất dữ liệu Phiếu yêu cầu vật tư từ ảnh chụp / file scan PDF sử dụng Vision AI
 * Hỗ trợ Custom LLM Gateway (http://localhost:20128/v1), OpenAI GPT-4o-mini & Google Gemini
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { pool } = require('../config/db');

// Helper for native HTTP/HTTPS JSON POST requests
function postJson(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const postData = JSON.stringify(bodyObj);
    const reqHeaders = {
      ...headers,
      'Content-Length': Buffer.byteLength(postData)
    };

    const client = url.protocol === 'https:' ? https : http;

    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          data
        });
      });
    });

    req.on('error', err => reject(err));
    req.write(postData);
    req.end();
  });
}

// Helper for native HTTP/HTTPS GET requests
function getJson(urlStr) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          data
        });
      });
    });
    req.on('error', err => reject(err));
  });
}

// Parse raw response body safely handling standard JSON, SSE stream, or concatenated JSON chunks
function parseLlmResponseData(rawBody) {
  const str = String(rawBody || '').trim();
  if (!str) return null;

  // 1. Direct JSON parse
  try {
    return JSON.parse(str);
  } catch (e) { }

  // 2. Parse SSE (Server-Sent Events) or Chunked JSON stream lines
  let accumulatedContent = '';
  const lines = str.split('\n');
  let hasValidChunks = false;

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('data:')) {
      line = line.substring(5).trim();
    }
    if (line === '[DONE]') break;

    try {
      const parsedChunk = JSON.parse(line);
      const text = parsedChunk.choices?.[0]?.delta?.content
        || parsedChunk.choices?.[0]?.message?.content
        || '';
      if (text) {
        accumulatedContent += text;
        hasValidChunks = true;
      }
    } catch (e) { }
  }

  if (hasValidChunks && accumulatedContent) {
    return {
      choices: [{ message: { content: accumulatedContent } }]
    };
  }

  // 3. Fallback: extract valid JSON object between first { and last }
  try {
    const firstBrace = str.indexOf('{');
    const lastBrace = str.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const sub = str.substring(firstBrace, lastBrace + 1);
      return JSON.parse(sub);
    }
  } catch (e) { }

  return null;
}

// Extract JSON Array robustly from LLM response text
function parseJsonArrayFromText(contentText) {
  if (!contentText) return null;
  const cleanStr = contentText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Try direct parse
  try {
    const data = JSON.parse(cleanStr);
    if (Array.isArray(data) && data.length > 0) return data;
  } catch (e) { }

  // Find JSON array substring [ ... ]
  const arrayMatch = cleanStr.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (arrayMatch) {
    try {
      const data = JSON.parse(arrayMatch[0]);
      if (Array.isArray(data) && data.length > 0) return data;
    } catch (e) {
      // Fix trailing commas if LLM produced invalid JSON
      try {
        const fixed = arrayMatch[0].replace(/,\s*([\]\}])/g, '$1');
        const data = JSON.parse(fixed);
        if (Array.isArray(data) && data.length > 0) return data;
      } catch (e2) { }
    }
  }

  return null;
}

// Extract text lines from PDF or file buffer
function extractTextFromBuffer(buffer) {
  try {
    const textContent = buffer.toString('utf-8');
    const matches = textContent.match(/[\u00C0-\u024F\u1EA0-\u1EF9a-zA-Z0-9\s,\.\-]{4,60}/g);
    if (!matches) return [];

    const lines = matches
      .map(m => m.trim())
      .filter(m => m.length > 5 && !m.includes('stream') && !m.includes('endstream') && !m.includes('PDF') && !m.includes('obj'));

    return lines;
  } catch (e) {
    return [];
  }
}

// Custom Local LLM Gateway (e.g. http://localhost:20128/v1)
async function callCustomLlmGateway(filePath, mimeType, rawBaseUrl, customModel, customKey) {
  const baseUrl = (rawBaseUrl || process.env.CUSTOM_LLM_URL || 'http://localhost:20128/v1').replace(/\/+$/, '');
  const modelName = customModel || process.env.CUSTOM_LLM_MODEL || 'ag/gemini-3.7-flash-medium';
  const apiKey = customKey || process.env.CUSTOM_LLM_KEY || 'sk-custom-test';

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isPdf = mimeType === 'application/pdf' || ext === '.pdf';

    const promptText = `Bạn là trợ lý AI chuyên đọc phiếu yêu cầu vật tư, hóa đơn, biên bản giao nhận từ hình ảnh/tài liệu scan.
Hãy phân tích nội dung này và trích xuất danh sách các vật tư dưới dạng JSON array duy nhất với cấu trúc:
[
  {
    "ten_vat_tu_goc": "Tên vật tư đọc được trên phiếu",
    "so_luong": 10.5,
    "don_vi_tinh": "Bao / Kg / m3 / Khối / Cây / Cuộn / Viên / Thùng / Cái / Mét",
    "ghi_chu": "Ghi chú nếu có"
  }
]
Chỉ trả về JSON thuần túy, không thêm mã markdown \`\`\`json hay văn bản giải thích nào khác.`;

    let userContent = [];

    if (isPdf) {
      const pdfText = extractTextFromBuffer(fileBuffer);
      if (pdfText && pdfText.length > 0) {
        userContent = promptText + "\n\nNội dung văn bản trích xuất từ PDF:\n" + pdfText.join("\n");
      } else {
        const rawStr = fileBuffer.toString('binary');
        const textMatches = rawStr.match(/[\u00C0-\u024F\u1EA0-\u1EF9a-zA-Z0-9\s,\.\-]{4,80}/g);
        const extracted = (textMatches || [])
          .filter(t => t.trim().length > 6 && !t.includes('stream') && !t.includes('endobj'))
          .slice(0, 30)
          .join("\n");

        userContent = promptText + (extracted ? "\n\nNội dung PDF:\n" + extracted : "\n[Đọc file scan PDF yêu cầu vật tư]");
      }
    } else {
      const base64Image = fileBuffer.toString('base64');
      const imgMime = mimeType && mimeType.startsWith('image/') ? mimeType : (ext === '.png' ? 'image/png' : 'image/jpeg');
      const dataUrl = `data:${imgMime};base64,${base64Image}`;

      userContent = [
        { type: 'text', text: promptText },
        { type: 'image_url', image_url: { url: dataUrl } }
      ];
    }

    const payload = {
      model: modelName,
      messages: [
        { role: 'user', content: userContent }
      ],
      stream: false,
      max_tokens: 1500
    };

    const targetUrl = `${baseUrl}/chat/completions`;
    console.log(`🤖 Connecting to Custom LLM Gateway (${targetUrl}) with model '${modelName}' for AI OCR...`);

    const response = await postJson(targetUrl, {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }, payload);

    if (!response.ok) {
      console.error(`❌ Custom LLM Gateway error (HTTP ${response.status}):`, response.data.substring(0, 200));
      return null;
    }

    const resJson = parseLlmResponseData(response.data);
    if (!resJson) {
      console.error('❌ Custom LLM Gateway returned empty or unparseable response body.');
      return null;
    }

    const contentText = resJson.choices?.[0]?.message?.content?.trim();
    if (!contentText) return null;

    console.log('✅ Custom LLM Gateway AI OCR successfully extracted response text.');
    const parsedData = parseJsonArrayFromText(contentText);
    if (parsedData && parsedData.length > 0) {
      return parsedData;
    }
  } catch (err) {
    console.error('❌ Custom LLM Gateway OCR Exception:', err.message);
  }
  return null;
}

async function callOpenAiVision(filePath, mimeType, rawApiKey) {
  const apiKey = String(rawApiKey || '').trim().replace(/^["']|["']$/g, '');
  if (!apiKey) return null;

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isPdf = mimeType === 'application/pdf' || ext === '.pdf';

    const promptText = `Bạn là trợ lý AI chuyên đọc phiếu yêu cầu vật tư, hóa đơn, biên bản giao nhận từ hình ảnh/tài liệu scan.
Hãy phân tích nội dung này và trích xuất danh sách các vật tư dưới dạng JSON array duy nhất với cấu trúc:
[
  {
    "ten_vat_tu_goc": "Tên vật tư đọc được trên phiếu",
    "so_luong": 10.5,
    "don_vi_tinh": "Bao / Kg / m3 / Khối / Cây / Cuộn / Viên / Thùng / Cái / Mét",
    "ghi_chu": "Ghi chú nếu có"
  }
]
Chỉ trả về JSON thuần túy, không thêm mã markdown \`\`\`json hay văn bản giải thích nào khác.`;

    let userContent = [];

    if (isPdf) {
      const pdfText = extractTextFromBuffer(fileBuffer);
      if (pdfText && pdfText.length > 0) {
        userContent = promptText + "\n\nNội dung văn bản trích xuất từ PDF:\n" + pdfText.join("\n");
      } else {
        const rawStr = fileBuffer.toString('binary');
        const textMatches = rawStr.match(/[\u00C0-\u024F\u1EA0-\u1EF9a-zA-Z0-9\s,\.\-]{4,80}/g);
        const extracted = (textMatches || [])
          .filter(t => t.trim().length > 6 && !t.includes('stream') && !t.includes('endobj'))
          .slice(0, 30)
          .join("\n");

        userContent = promptText + (extracted ? "\n\nNội dung PDF:\n" + extracted : "\n[Đọc file scan PDF yêu cầu vật tư]");
      }
    } else {
      const base64Image = fileBuffer.toString('base64');
      const imgMime = mimeType && mimeType.startsWith('image/') ? mimeType : (ext === '.png' ? 'image/png' : 'image/jpeg');
      const dataUrl = `data:${imgMime};base64,${base64Image}`;

      userContent = [
        { type: 'text', text: promptText },
        { type: 'image_url', image_url: { url: dataUrl } }
      ];
    }

    const payload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: userContent }
      ],
      stream: false,
      max_tokens: 1500
    };

    console.log('🤖 Connecting to OpenAI API (gpt-4o-mini) for AI OCR processing...');
    const response = await postJson('https://api.openai.com/v1/chat/completions', {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    }, payload);

    if (!response.ok) {
      console.error('❌ OpenAI API error (HTTP ' + response.status + '):', response.data);
      return null;
    }

    const resJson = parseLlmResponseData(response.data);
    if (!resJson) return null;

    const contentText = resJson.choices?.[0]?.message?.content?.trim();
    if (!contentText) return null;

    console.log('✅ OpenAI API AI OCR successfully extracted response text.');
    const parsedData = parseJsonArrayFromText(contentText);
    if (parsedData && parsedData.length > 0) {
      return parsedData;
    }
  } catch (err) {
    console.error('❌ OpenAI Vision OCR Exception:', err.message);
  }
  return null;
}

async function callGeminiVision(filePath, mimeType, rawApiKey) {
  const apiKey = String(rawApiKey || '').trim().replace(/^["']|["']$/g, '');
  if (!apiKey) return null;

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const actualMime = (mimeType && mimeType !== 'application/octet-stream')
      ? mimeType
      : (ext === '.pdf' ? 'application/pdf' : (ext === '.png' ? 'image/png' : 'image/jpeg'));

    const base64Data = fileBuffer.toString('base64');

    const promptText = `Bạn là trợ lý AI chuyên đọc phiếu yêu cầu vật tư, hóa đơn, biên bản giao nhận từ hình ảnh/tài liệu scan.
Hãy phân tích hình ảnh/tài liệu này và trích xuất danh sách các vật tư dưới dạng JSON array duy nhất với cấu trúc:
[
  {
    "ten_vat_tu_goc": "Tên vật tư đọc được trên phiếu",
    "so_luong": 10.5,
    "don_vi_tinh": "Bao / Kg / m3 / Khối / Cây / Cuộn / Viên / Thùng / Cái / Mét",
    "ghi_chu": "Ghi chú nếu có"
  }
]
Chỉ trả về JSON thuần túy, không thêm mã markdown \`\`\`json hay văn bản giải thích nào khác.`;

    const payload = {
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: actualMime,
                data: base64Data
              }
            }
          ]
        }
      ]
    };

    // First: Validate API Key and auto-fetch supported models from Google AI Studio
    console.log('🤖 Verifying Gemini API Key with Google AI Studio...');
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const listRes = await getJson(listUrl);

    let modelsToTry = ['gemini-1.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-pro'];

    if (listRes.ok) {
      try {
        const listJson = JSON.parse(listRes.data);
        if (Array.isArray(listJson.models)) {
          const supported = listJson.models
            .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
            .map(m => m.name.replace(/^models\//, ''));
          if (supported.length > 0) {
            modelsToTry = supported;
            console.log('✅ Google AI Studio returned available models:', supported.slice(0, 5).join(', '));
          }
        }
      } catch (e) { }
    } else {
      console.error(`❌ Google Gemini API Key validation failed (HTTP ${listRes.status}):`, listRes.data);
      return null;
    }

    for (const modelName of modelsToTry) {
      console.log(`🤖 Connecting to Google Gemini API (${modelName}) for AI OCR processing...`);
      const urlStr = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const response = await postJson(urlStr, {
        'Content-Type': 'application/json'
      }, payload);

      if (response.ok) {
        const resJson = parseLlmResponseData(response.data);
        const contentText = resJson?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (contentText) {
          console.log(`✅ Google Gemini API AI OCR (${modelName}) successfully extracted response text.`);
          const parsedData = parseJsonArrayFromText(contentText);
          if (parsedData && parsedData.length > 0) {
            return parsedData;
          }
        }
      } else {
        console.warn(`⚠️ Gemini API model ${modelName} returned HTTP ${response.status}:`, response.data.substring(0, 150));
      }
    }
  } catch (err) {
    console.error('❌ Gemini Vision OCR Exception:', err.message);
  }
  return null;
}

async function parseMaterialRequestFile(filePath, mimeType) {
  let aiOpenAi = '0';
  let aiGemini = '0';
  let aiCustom = '1';

  let customUrl = process.env.CUSTOM_LLM_URL || 'http://localhost:20128/v1';
  let customModel = process.env.CUSTOM_LLM_MODEL || 'ag/gemini-3.7-flash-medium';
  let customKey = process.env.CUSTOM_LLM_KEY || 'sk-custom-test';
  let openAiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
  let geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.ANTIGRAVITY_API_KEY;

  try {
    const [rows] = await pool.query(
      'SELECT `key`, `value` FROM setting WHERE `key` IN ("ai_openai", "ai_gemini", "ai_custom", "ai_custom_url", "ai_custom_model", "ai_custom_key", "openai_api_key", "gemini_api_key")'
    );
    rows.forEach(r => {
      if (r.key === 'ai_openai') aiOpenAi = r.value;
      if (r.key === 'ai_gemini') aiGemini = r.value;
      if (r.key === 'ai_custom') aiCustom = r.value;
      if (r.key === 'ai_custom_url' && r.value) customUrl = r.value;
      if (r.key === 'ai_custom_model' && r.value) customModel = r.value;
      if (r.key === 'ai_custom_key' && r.value) customKey = r.value;
      if (r.key === 'openai_api_key' && r.value) openAiKey = r.value;
      if (r.key === 'gemini_api_key' && r.value) geminiKey = r.value;
    });
  } catch (dbErr) {
    console.warn('⚠️ AI OCR: Could not query setting table from DB, using env fallback:', dbErr.message);
  }

  console.log(`🤖 Active AI OCR Settings: Custom=${aiCustom}, OpenAI=${aiOpenAi}, Gemini=${aiGemini}`);

  // 1. If ai_custom is enabled ('1')
  if (aiCustom === '1' && customUrl) {
    console.log(`🤖 Using Custom LLM Gateway: ${customUrl} (Model: ${customModel})`);
    const customResult = await callCustomLlmGateway(filePath, mimeType, customUrl, customModel, customKey);
    if (customResult && customResult.length > 0) return customResult;
  }

  // 2. If ai_openai is enabled ('1')
  if (aiOpenAi === '1' && openAiKey) {
    console.log('🤖 Using OpenAI Vision API');
    const openAiResult = await callOpenAiVision(filePath, mimeType, openAiKey);
    if (openAiResult && openAiResult.length > 0) return openAiResult;
  }

  // 3. If ai_gemini is enabled ('1')
  if (aiGemini === '1' && geminiKey) {
    console.log('🤖 Using Google Gemini Vision API');
    const geminiResult = await callGeminiVision(filePath, mimeType, geminiKey);
    if (geminiResult && geminiResult.length > 0) return geminiResult;
  }

  // Fallback: If enabled service failed, try others if configured
  if (aiCustom !== '1' && customUrl) {
    const res = await callCustomLlmGateway(filePath, mimeType, customUrl, customModel, customKey);
    if (res && res.length > 0) return res;
  }
  if (aiOpenAi !== '1' && openAiKey) {
    const res = await callOpenAiVision(filePath, mimeType, openAiKey);
    if (res && res.length > 0) return res;
  }
  if (aiGemini !== '1' && geminiKey) {
    const res = await callGeminiVision(filePath, mimeType, geminiKey);
    if (res && res.length > 0) return res;
  }

  console.warn('⚠️ AI OCR: No active AI provider produced valid items. Returning empty items.');
  return [];
}

module.exports = {
  parseMaterialRequestFile
};
