// Endpoint serverless — geração de thumbnail com identidade facial
// Primário: Replicate InstantID (rosto fiel ao criador)
// Fallback: OpenAI gpt-image-1 (sem fidelidade facial, só se Replicate não estiver configurado)
//
// Env vars necessárias:
//   REPLICATE_API_TOKEN  — token do Replicate (replicate.com/account/api-tokens)
//   OPENAI_API_KEY       — fallback se Replicate não configurado
//   DASHBOARD_SECRET     — autenticação do dashboard
//
// ROADMAP MULTI-TENANT:
//   1. Trocar x-dashboard-secret por JWT do Supabase Auth
//   2. Extrair canal_id do token e isolar dados por criador
//   3. Habilitar RLS com policy: auth.uid() = canal_id

export default async function handler(req, res) {
  const origemPermitida = [
    'https://guicapovilla.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ];
  const origemRequest = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin',
    origemPermitida.includes(origemRequest) ? origemRequest : 'https://guicapovilla.github.io');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-dashboard-secret'];
  if (!secret || secret !== process.env.DASHBOARD_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { prompt, photo_urls = [] } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt obrigatório' });
  }

  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  if (REPLICATE_TOKEN && photo_urls.length > 0) {
    return gerarInstantID(res, prompt, photo_urls, REPLICATE_TOKEN, OPENAI_KEY);
  }
  return gerarOpenAI(res, prompt, photo_urls, OPENAI_KEY);
}

// ── InstantID via Replicate ────────────────────────────────────────────────
async function gerarInstantID(res, prompt, photo_urls, token, openaiKey) {
  try {
    const faceUrl = photo_urls[0];

    // Inicia a predição — Prefer: wait aguarda até 55s de forma síncrona
    const startRes = await fetch(
      'https://api.replicate.com/v1/models/zsxkib/instant-id/predictions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Prefer': 'wait=55',
        },
        body: JSON.stringify({
          input: {
            image: faceUrl,
            prompt,
            negative_prompt: 'ugly, deformed, blurry, low quality, extra limbs, bad anatomy, watermark',
            width: 1536,
            height: 1024,
            num_inference_steps: 30,
            guidance_scale: 5,
            ip_adapter_scale: 0.8,
            controlnet_conditioning_scale: 0.8,
            enhance_face_region: true,
          },
        }),
      }
    );

    const pred = await startRes.json();

    if (!startRes.ok || pred.error) {
      console.error('Replicate start error:', pred);
      // Fallback para OpenAI se Replicate retornar erro
      return gerarOpenAI(res, prompt, photo_urls, openaiKey);
    }

    // Prefer:wait pode ter completado já
    let outputUrl = obterOutputUrl(pred);

    // Se ainda processing, faz polling por até 50s
    if (!outputUrl && (pred.status === 'starting' || pred.status === 'processing')) {
      outputUrl = await pollReplicate(pred.id, token, 50000);
    }

    if (!outputUrl) {
      console.error('Replicate: sem output após espera, fallback OpenAI');
      return gerarOpenAI(res, prompt, photo_urls, openaiKey);
    }

    // Baixa a imagem e converte para base64
    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) throw new Error('Falha ao baixar imagem do Replicate');
    const buf = Buffer.from(await imgRes.arrayBuffer());
    return res.status(200).json({ b64_json: buf.toString('base64'), provider: 'replicate-instantid' });

  } catch (err) {
    console.error('InstantID error:', err.message);
    return gerarOpenAI(res, prompt, photo_urls, openaiKey);
  }
}

function obterOutputUrl(pred) {
  if (pred.status !== 'succeeded') return null;
  return Array.isArray(pred.output) ? pred.output[0] : pred.output || null;
}

async function pollReplicate(predId, token, timeoutMs) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    await new Promise(r => setTimeout(r, 3000));
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${predId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await pollRes.json();
    if (data.status === 'succeeded') return obterOutputUrl(data);
    if (data.status === 'failed' || data.status === 'canceled') return null;
  }
  return null;
}

// ── Fallback: OpenAI gpt-image-1 ──────────────────────────────────────────
async function gerarOpenAI(res, prompt, photo_urls, apiKey) {
  if (!apiKey) {
    return res.status(500).json({ error: 'Nenhuma API configurada (REPLICATE_API_TOKEN ou OPENAI_API_KEY)' });
  }
  try {
    let promptFinal = prompt;
    if (photo_urls.length > 0) {
      const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              ...photo_urls.slice(0, 4).map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
              { type: 'text', text: 'Descreva o rosto desta pessoa em detalhes (cabelo, olhos, traços, tom de pele) para referência em geração de imagem. 3 frases máximo.' }
            ]
          }]
        })
      });
      const cd = await chatRes.json();
      const desc = cd.choices?.[0]?.message?.content || '';
      if (desc) promptFinal = `${prompt}\n\nAparência do criador: ${desc}`;
    }
    const genRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: promptFinal, n: 1, size: '1536x1024', output_format: 'png' }),
    });
    const gd = await genRes.json();
    if (!genRes.ok) return res.status(genRes.status).json({ error: gd.error?.message || 'OpenAI falhou' });
    const b64_json = gd.data?.[0]?.b64_json;
    if (!b64_json) return res.status(500).json({ error: 'Imagem não retornada' });
    return res.status(200).json({ b64_json, provider: 'openai-gpt-image-1' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
