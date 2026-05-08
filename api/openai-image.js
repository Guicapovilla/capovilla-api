// Endpoint serverless — geração de thumbnail via OpenAI Responses API (gpt-4o + image_generation)
// Recebe: { prompt, photo_urls[], size, canal_id? }
// Retorna: { b64_json }
//
// ROADMAP MULTI-TENANT:
//   1. Adicionar autenticação: trocar x-dashboard-secret por JWT do Supabase Auth
//   2. Extrair canal_id do token e usar para isolar dados por criador
//   3. Habilitar RLS no Supabase com policy: auth.uid() = user_id
//   — A estrutura do endpoint já recebe canal_id opcionalmente para facilitar essa migração

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
  if (origemPermitida.includes(origemRequest)) {
    res.setHeader('Access-Control-Allow-Origin', origemRequest);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://guicapovilla.github.io');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-dashboard-secret'];
  if (!secret || secret !== process.env.DASHBOARD_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { prompt, photo_urls = [], size = '1536x1024' } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt obrigatório' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada' });
  }

  try {
    // Baixa as fotos de referência e converte para base64
    const fotosValidas = (await Promise.all(
      photo_urls.slice(0, 4).map(async url => {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          const buf = await r.arrayBuffer();
          const b64 = Buffer.from(buf).toString('base64');
          const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
          return { b64, mime };
        } catch { return null; }
      })
    )).filter(Boolean);

    // Monta o input multimodal: fotos de referência + prompt textual
    const inputContent = [
      ...fotosValidas.map(f => ({
        type: 'input_image',
        source: { type: 'base64', media_type: f.mime, data: f.b64 },
      })),
      { type: 'input_text', text: prompt },
    ];

    // Responses API: gpt-4o vê as fotos e gera a imagem diretamente
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        input: [{ role: 'user', content: inputContent }],
        tools: [{ type: 'image_generation', quality: 'high', size, output_format: 'png' }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI Responses API error:', JSON.stringify(data));
      return res.status(response.status).json({ error: data.error?.message || 'OpenAI API falhou', details: data });
    }

    // Extrai a imagem gerada do output
    const imgOutput = (data.output || []).find(o => o.type === 'image_generation_call');
    const b64_json = imgOutput?.result;

    if (!b64_json) {
      console.error('Resposta sem imagem:', JSON.stringify(data));
      return res.status(500).json({ error: 'Imagem não retornada pela API', details: data.output });
    }

    return res.status(200).json({ b64_json });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
