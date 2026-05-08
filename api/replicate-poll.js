// Consulta o status de uma predição do Replicate
// GET /api/replicate-poll?id=prediction_id
// Retorna: { status: 'processing' } | { b64_json, provider } | { error }

const CORS_ORIGINS = [
  'https://guicapovilla.github.io',
  'http://localhost:8000', 'http://127.0.0.1:8000',
  'http://localhost:3000',
  'http://localhost:8080', 'http://127.0.0.1:8080',
];

export default async function handler(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-secret');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (req.headers['x-dashboard-secret'] !== process.env.DASHBOARD_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id obrigatório' });

  const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;
  if (!REPLICATE_TOKEN) return res.status(500).json({ error: 'REPLICATE_API_TOKEN não configurado' });

  try {
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Bearer ${REPLICATE_TOKEN}` },
    });
    const pred = await pollRes.json();

    if (!pollRes.ok) return res.status(500).json({ error: pred.detail || 'Erro ao consultar Replicate' });

    if (pred.status === 'failed' || pred.status === 'canceled') {
      return res.status(500).json({ error: `Predição ${pred.status}: ${pred.error || ''}` });
    }

    if (pred.status !== 'succeeded') {
      return res.status(200).json({ status: 'processing' });
    }

    // Predição concluída — baixa a imagem e converte para base64
    const outputUrl = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    if (!outputUrl) return res.status(500).json({ error: 'Replicate não retornou imagem' });

    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) return res.status(500).json({ error: 'Falha ao baixar imagem do Replicate' });

    const buf = Buffer.from(await imgRes.arrayBuffer());
    return res.status(200).json({ b64_json: buf.toString('base64'), provider: 'replicate-instantid' });

  } catch (err) {
    console.error('replicate-poll error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
