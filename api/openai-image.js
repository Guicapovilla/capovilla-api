// Endpoint serverless que proxia geração de imagem via OpenAI gpt-image-1
// Recebe: { prompt, photo_urls[], size }
// Retorna: { b64_json }

export default async function handler(req, res) {
  // CORS — mesmas origens do claude.js
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

  const { prompt, photo_urls = [], size = '1792x1024' } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt obrigatório' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada' });
  }

  try {
    // Se há fotos de referência, usa o endpoint de edição com contexto visual
    // Caso contrário, usa geração simples
    let response;

    if (photo_urls.length > 0) {
      // Baixa as fotos e converte para base64 para passar como contexto
      const fotosBase64 = await Promise.all(
        photo_urls.slice(0, 4).map(async url => {
          const r = await fetch(url);
          if (!r.ok) return null;
          const buf = await r.arrayBuffer();
          const b64 = Buffer.from(buf).toString('base64');
          const mime = r.headers.get('content-type') || 'image/jpeg';
          return `data:${mime};base64,${b64}`;
        })
      );
      const fotasValidas = fotosBase64.filter(Boolean);

      // Usa Chat Completions com gpt-4o para gerar descrição enriquecida,
      // depois passa para Images API — gpt-image-1 via chat não aceita imagens diretamente
      // Então enriquecemos o prompt com análise visual primeiro
      const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              ...fotasValidas.map(url => ({ type: 'image_url', image_url: { url, detail: 'low' } })),
              {
                type: 'text',
                text: `Descreva em 2 frases as características visuais do rosto desta pessoa (formato do rosto, cor dos olhos, cabelo, estilo) para usar como referência em geração de imagem. Seja objetivo e específico.`
              }
            ]
          }]
        })
      });
      const chatData = await chatRes.json();
      const descricaoRosto = chatData.choices?.[0]?.message?.content || '';
      const promptEnriquecido = `${prompt}\n\nReferência visual do criador: ${descricaoRosto}`;

      response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: promptEnriquecido,
          n: 1,
          size,
          output_format: 'b64_json',
        })
      });
    } else {
      // Sem fotos de referência: geração simples
      response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt,
          n: 1,
          size,
          output_format: 'b64_json',
        })
      });
    }

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'OpenAI API falhou' });
    }

    const b64_json = data.data?.[0]?.b64_json;
    if (!b64_json) {
      return res.status(500).json({ error: 'Imagem não retornada pela API' });
    }

    return res.status(200).json({ b64_json });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
