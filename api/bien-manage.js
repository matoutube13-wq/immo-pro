export const config = { maxDuration: 30 };

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

function parseVal(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val;
  // Peut être doublement encodé : "\"{ ... }\""
  let v = val;
  try { v = JSON.parse(v); } catch {}
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch {}
  }
  return v;
}

async function kvGet(key) {
  const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const d = await r.json();
  return parseVal(d.result);
}

async function kvSet(key, value) {
  const r = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
  return r.json();
}

async function kvKeys(pattern) {
  const r = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const d = await r.json();
  return d.result || [];
}

async function kvLRange(key) {
  const r = await fetch(`${KV_URL}/lrange/${encodeURIComponent(key)}/0/999`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const d = await r.json();
  return (d.result || []).map(i => parseVal(i));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: "Variables KV manquantes" });
  }

  try {
    if (req.method === 'GET') {
      const keys = await kvKeys('bien:*');
      const biens = (await Promise.all(keys.map(k => kvGet(k)))).filter(Boolean);
      const enriched = await Promise.all(biens.map(async b => {
        const cands = await kvLRange(`candidatures:bien:${b.id}`);
        return { ...b, nbCandidatures: cands.length, nbEvalues: cands.filter(c => c && c.score !== null).length };
      }));
      enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.status(200).json({ biens: enriched });
    }

    if (req.method === 'POST') {
      const { adresse, loyer, type, chambres, surface, criteresSup, statut } = req.body;
      if (!adresse || !loyer) return res.status(400).json({ error: "Adresse et loyer obligatoires" });
      const id = `bien_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const bien = {
        id, adresse,
        loyer: parseFloat(loyer),
        type: type || 'Appartement',
        chambres: chambres || null,
        surface: surface || null,
        criteresSup: criteresSup || '',
        statut: statut || 'actif',
        createdAt: new Date().toISOString()
      };
      await kvSet(`bien:${id}`, bien);
      return res.status(200).json({ success: true, bien });
    }

    if (req.method === 'PUT') {
      const { id, ...updates } = req.body;
      if (!id) return res.status(400).json({ error: "ID manquant" });
      const existing = await kvGet(`bien:${id}`);
      if (!existing) return res.status(404).json({ error: "Bien non trouvé" });
      const updated = { ...existing, ...updates };
      if (updates.loyer) updated.loyer = parseFloat(updates.loyer);
      await kvSet(`bien:${id}`, updated);
      return res.status(200).json({ success: true, bien: updated });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "ID manquant" });
      const existing = await kvGet(`bien:${id}`);
      if (!existing) return res.status(404).json({ error: "Bien non trouvé" });
      await kvSet(`bien:${id}`, { ...existing, statut: 'archive' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
