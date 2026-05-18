// Analisa o aprendizado de uma sugestão vs. vídeo publicado.
// Recebe dados já resolvidos pelo dashboard (sem precisar de credenciais Supabase aqui).
// Retorna { analise, resultado } para o dashboard salvar no Supabase.

const CORS_ORIGINS = [
  'https://guicapovilla.github.io',
  'http://localhost:8080', 'http://127.0.0.1:8080',
  'http://localhost:8090', 'http://127.0.0.1:8090',
  'http://localhost:3000',
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

  const {
    titulo_sugerido = '',
    motivo = '',
    titulo_publicado = '',
    rpm_previsto = 0,
    rpm_real = 0,
  } = req.body || {};

  if (!titulo_sugerido) {
    return res.status(400).json({ error: 'titulo_sugerido obrigatório' });
  }

  const semDados = rpm_real === 0;
  const resultado = semDados
    ? 'sem_dados'
    : rpm_real >= rpm_previsto * 0.9
      ? 'acertou'
      : rpm_real < rpm_previsto * 0.5
        ? 'errou'
        : 'parcial';

  const prompt = `Você é o sistema de aprendizado do canal @guilhermecapovilla.

SUGESTÃO ORIGINAL:
Título: ${titulo_sugerido}
Raciocínio da IA: ${motivo.substring(0, 600) || '(não disponível)'}

VÍDEO PUBLICADO:
Título: ${titulo_publicado || '(mesmo da sugestão)'}
RPM previsto: R$${Number(rpm_previsto).toFixed(0)}
RPM real: ${semDados ? 'ainda sem dados (coleta pendente)' : `R$${Number(rpm_real).toFixed(0)}`}
Resultado: ${resultado === 'acertou' ? 'ACERTOU ✅' : resultado === 'errou' ? 'ERROU ❌' : resultado === 'parcial' ? 'PARCIAL ➖' : 'SEM DADOS (analisar o que foi preservado da sugestão)'}

Responda em português, de forma direta e curta (máx 250 palavras), com estas 3 seções:

**O QUE FOI MANTIDO**
O que da sugestão original o criador usou (ângulo, tom, tema).

**O QUE MUDOU**
O que foi diferente do sugerido e por quê faz sentido.

**CALIBRAÇÃO**
Uma instrução objetiva para o sistema calibrar próximas sugestões com base nesse resultado.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Claude falhou' });
    }

    const analise = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return res.status(200).json({ analise, resultado });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
