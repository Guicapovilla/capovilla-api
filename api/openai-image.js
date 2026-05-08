// Endpoint serverless — geração de thumbnail via gpt-image-1 images/edits
// Usa a foto de referência como imagem base → melhor consistência facial
// Recebe: { prompt, photo_urls[], size, canal_id? }
// Retorna: { b64_json }
//
// ROADMAP MULTI-TENANT:
//   1. Adicionar autenticação: trocar x-dashboard-secret por JWT do Supabase Auth
//   2. Extrair canal_id do token e usar para isolar dados por criador
//   3. Habilitar RLS no Supabase com policy: auth.uid() = user_id

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

  const { prompt, photo_urls = [] } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt obrigatório' });
  }

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY não configurada' });
  }

  try {
    let b64_json;
    let promptFinal = prompt;

    if (photo_urls.length > 0) {
      // Usa gpt-4o para analisar TODAS as fotos e gerar descrição facial detalhada
      const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              ...photo_urls.slice(0, 6).map(url => ({ type: 'image_url', image_url: { url, detail: 'high' } })),
              {
                type: 'text',
                text: 'Analise todas as fotos desta pessoa e descreva com precisão: cor e textura do cabelo, cor dos olhos, formato do rosto, sobrancelhas, traços marcantes, tom de pele, estilo de barba/bigode se houver. Seja específico e detalhado para uso como referência em geração de imagem. Máximo 4 frases.'
              }
            ]
          }]
        })
      });
      const chatData = await chatRes.json();
      const descricao = chatData.choices?.[0]?.message?.content || '';
      if (descricao) promptFinal = `${prompt}\n\nDescrição detalhada do rosto do criador (deve ser fielmente reproduzido): ${descricao}`;
    }

    // Geração com prompt enriquecido
    const genRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt: promptFinal, n: 1, size: '1536x1024', output_format: 'png' }),
    });
    const genData = await genRes.json();
    if (!genRes.ok) throw new Error(genData.error?.message || 'images/generations falhou');
    b64_json = genData.data?.[0]?.b64_json;

    if (!b64_json) return res.status(500).json({ error: 'Imagem não retornada pela API' });
    return res.status(200).json({ b64_json });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
