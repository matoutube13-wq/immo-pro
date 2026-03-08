export const config = { maxDuration: 30 };

async function kvGet(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return d.result ? (typeof d.result === 'string' ? JSON.parse(d.result) : d.result) : null;
}

async function kvLRange(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/lrange/${encodeURIComponent(key)}/0/999`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return (d.result || []).map(i => typeof i === 'string' ? JSON.parse(i) : i);
}

async function kvKeys(pattern) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return d.result || [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { id, bienId, action } = req.query;

    // Détail d'une candidature
    if (id) {
      const cand = await kvGet(`candidature:${id}`);
      if (!cand) return res.status(404).json({ error: "Non trouvée" });
      return res.status(200).json(cand);
    }

    // Liste des biens
    if (action === 'biens') {
      const keys = await kvKeys('bien:*');
      const biens = await Promise.all(keys.map(k => kvGet(k)));
      return res.status(200).json({ biens: biens.filter(Boolean) });
    }

    // Candidatures d'un bien
    if (bienId) {
      const list = await kvLRange(`candidatures:bien:${bienId}`);
      // Enrichir avec les scores
      const enriched = await Promise.all(list.map(async (item) => {
        if (item.score === null && item.statut === 'note') {
          const full = await kvGet(`candidature:${item.id}`);
          if (full) return { ...item, score: full.score, evaluation: full.evaluation };
        }
        return item;
      }));
      enriched.sort((a, b) => {
        if (a.score !== null && b.score !== null) return b.score - a.score;
        if (a.score !== null) return -1;
        if (b.score !== null) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      return res.status(200).json({ candidatures: enriched });
    }

    // Toutes les candidatures
    const list = await kvLRange(`candidatures:all`);
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ candidatures: list });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
