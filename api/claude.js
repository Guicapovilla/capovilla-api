// Endpoint serverless que proxia requisições pra Anthropic API
// Protegido por header x-dashboard-secret pra impedir abuso externo
// v2 — CORS atualizado 2026-05-18

export default async function handler(req, res) {
  // CORS — libera GitHub Pages + localhost (dev)
  const origemPermitida = [
    'https://guicapovilla.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8090',
    'http://127.0.0.1:8090',
    'null', // file:// abre com origin "null"
  ];
  const origemRequest = req.headers.origin || 'null';
  if (origemPermitida.includes(origemRequest)) {
    res.setHeader('Access-Control-Allow-Origin', origemRequest === 'null' ? '*' : origemRequest);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://guicapovilla.github.io');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-dashboard-secret');

  // Preflight OPTIONS (navegador manda antes do POST real)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validação do secret compartilhado
  const secret = req.headers['x-dashboard-secret'];
  if (!secret || secret !== process.env.DASHBOARD_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Validação do payload
  const { prompt, max_tokens = 2000, system = null } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt obrigatorio' });
  }
  if (prompt.length > 50000) {
    return res.status(400).json({ error: 'Prompt muito longo (max 50000 chars)' });
  }

  // Monta payload Anthropic
  const messages = [{ role: 'user', content: prompt }];
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: Math.min(max_tokens, 4000),
    messages,
  };
  if (system) body.system = system;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(response.status).json({
        error: data.error?.message || 'Anthropic API falhou',
      });
    }

    // Extrai texto da resposta
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');

    return res.status(200).json({
      text,
      usage: data.usage || null,
    });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}