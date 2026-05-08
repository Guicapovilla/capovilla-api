// Inicia geração de thumbnail
// Se REPLICATE_API_TOKEN configurado: inicia predição InstantID → retorna { prediction_id }
// Caso contrário: gera com OpenAI sincronamente → retorna { b64_json, provider }

const CORS_ORIGINS = [
  'https://guicapovilla.github.io',
  'http://localhost:8000', 'http://127.0.0.1:8000',
  'http://localhost:3000',
  'http://localhost:8080', 'http://127.0.0.1:8080',
];

function setCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-secret');
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-dashboard-secret'] !== process.env.DASHBOARD_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { prompt, photo_urls = [] } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt obrigatório' });

  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  // ── Caminho Replicate: inicia predição e retorna prediction_id imediatamente ──
  if (REPLICATE_TOKEN && photo_urls.length > 0) {
    try {
      const startRes = await fetch(
        'https://api.replicate.com/v1/models/zsxkib/instant-id/predictions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${REPLICATE_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: {
              image: photo_urls[0],
              prompt,
              negative_prompt: 'ugly, deformed, blurry, low quality, watermark',
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
      if (startRes.ok && pred.id) {
        return res.status(200).json({ prediction_id: pred.id });
      }
      console.error('Replicate start error:', pred);
      // Fallback para OpenAI se não conseguiu iniciar
    } catch (err) {
      console.error('Replicate start exception:', err.message);
    }
  }

  // ── Fallback OpenAI: geração síncrona ─────────────────────────────────────
  if (!OPENAI_KEY) return res.status(500).json({ error: 'Nenhuma API configurada' });
  try {
    let promptFinal = prompt;
    if (photo_urls.length > 0) {
      const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 250,
          messages: [{
            role: 'user',
            content: [
              ...photo_urls.slice(0, 4).map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
              { type: 'text', text: 'Descreva o rosto desta pessoa em detalhes (cabelo, olhos, traços, tom de pele). 3 frases.' }
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: promptFinal, n: 1, size: '1536x1024', output_format: 'png' }),
    });
    const gd = await genRes.json();
    if (!genRes.ok) return res.status(genRes.status).json({ error: gd.error?.message || 'OpenAI falhou' });
    return res.status(200).json({ b64_json: gd.data?.[0]?.b64_json, provider: 'openai-gpt-image-1', debug: { had_replicate_token: !!REPLICATE_TOKEN, photo_urls_count: photo_urls.length } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
