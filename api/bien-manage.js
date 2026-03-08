export const config = { maxDuration: 30 };

async function kvGet(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return d.result ? (typeof d.result === 'string' ? JSON.parse(d.result) : d.result) : null;
}

async function kvSet(key, value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
  return r.json();
}

async function kvDel(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  return r.json();
}

async function kvKeys(pattern) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return d.result || [];
}

async function kvLPush(key, value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/lpush/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
  return r.json();
}

async function kvLRange(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/lrange/${encodeURIComponent(key)}/0/999`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return (d.result || []).map(i => typeof i === 'string' ? JSON.parse(i) : i);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // GET — lister tous les biens
    if (req.method === 'GET') {
      const keys = await kvKeys('bien:*');
      const biens = (await Promise.all(keys.map(k => kvGet(k)))).filter(Boolean);
      // Enrichir avec nb candidatures
      const enriched = await Promise.all(biens.map(async b => {
        const cands = await kvLRange(`candidatures:bien:${b.id}`);
        return { ...b, nbCandidatures: cands.length, nbEvalues: cands.filter(c => c.score !== null).length };
      }));
      enriched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.status(200).json({ biens: enriched });
    }

    // POST — créer un bien
    if (req.method === 'POST') {
      const { adresse, loyer, type, chambres, surface, criteresSup, statut } = req.body;
      if (!adresse || !loyer) return res.status(400).json({ error: "Adresse et loyer obligatoires" });
      const id = `bien_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const bien = { id, adresse, loyer: parseFloat(loyer), type: type || 'Appartement', chambres: chambres || null, surface: surface || null, criteresSup: criteresSup || '', statut: statut || 'actif', createdAt: new Date().toISOString() };
      await kvSet(`bien:${id}`, bien);
      return res.status(200).json({ success: true, bien });
    }

    // PUT — modifier un bien
    if (req.method === 'PUT') {
      const { id, ...updates } = req.body;
      if (!id) return res.status(400).json({ error: "ID manquant" });
      const existing = await kvGet(`bien:${id}`);
      if (!existing) return res.status(404).json({ error: "Bien non trouvé" });
      const updated = { ...existing, ...updates };
      await kvSet(`bien:${id}`, updated);
      return res.status(200).json({ success: true, bien: updated });
    }

    // DELETE — archiver un bien
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
