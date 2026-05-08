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

    if (photo_urls.length > 0) {
      // Baixa a foto de referência e envia como imagem base para images/edits
      // gpt-image-1 edits: usa a foto como ponto de partida, mantém o rosto
      const fotoRes = await fetch(photo_urls[0]);
      if (!fotoRes.ok) throw new Error('Não foi possível baixar a foto de referência');
      const fotoBuffer = Buffer.from(await fotoRes.arrayBuffer());

      // Envia como multipart/form-data (FormData e Blob são globais no Node 18+)
      const form = new FormData();
      form.append('model', 'gpt-image-1');
      form.append('prompt', prompt);
      form.append('n', '1');
      form.append('size', '1536x1024');
      form.append('image', new Blob([fotoBuffer], { type: 'image/png' }), 'reference.png');

      const editRes = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: form,
      });

      const editData = await editRes.json();
      if (!editRes.ok) {
        console.error('OpenAI edits error:', editData);
        throw new Error(editData.error?.message || 'images/edits falhou');
      }
      b64_json = editData.data?.[0]?.b64_json;

    } else {
      // Sem fotos: geração simples
      const genRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: '1536x1024', output_format: 'png' }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) throw new Error(genData.error?.message || 'images/generations falhou');
      b64_json = genData.data?.[0]?.b64_json;
    }

    if (!b64_json) return res.status(500).json({ error: 'Imagem não retornada pela API' });
    return res.status(200).json({ b64_json });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
