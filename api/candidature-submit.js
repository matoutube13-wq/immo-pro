export const config = {
  api: { bodyParser: { sizeLimit: "20mb" }, responseLimit: false },
  maxDuration: 60
};

function parseVal(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object') return val;
  let v = val;
  try { v = JSON.parse(v); } catch(e) {}
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch(e) {} }
  return v;
}

async function kvSet(key, value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
  return r.json();
}

async function kvLPush(key, value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/lpush/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Methode non autorisee" });

  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return res.status(500).json({ error: "Variables KV manquantes" });
  }

  try {
    const { bienId, bienAdresse, contact, fichiers } = req.body;
    if (!bienId || !contact) return res.status(400).json({ error: "Donnees manquantes" });

    const now = new Date().toISOString();
    const id = `cand_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const entry = {
      id,
      bienId,
      bienAdresse: bienAdresse || '',
      contact,
      fichiers: fichiers || [],
      statut: 'en_attente',
      score: null,
      extracted: null,
      evaluation: null,
      createdAt: now
    };

    await kvSet(`candidature:${id}`, entry);

    await kvLPush(`candidatures:bien:${bienId}`, {
      id,
      nom: contact.nom || '',
      email: contact.email || '',
      createdAt: now,
      statut: 'en_attente',
      score: null
    });

    await kvLPush(`candidatures:all`, {
      id,
      nom: contact.nom || '',
      email: contact.email || '',
      bienId,
      bienAdresse: bienAdresse || '',
      createdAt: now,
      statut: 'en_attente',
      score: null
    });

    return res.status(200).json({ success: true, id });

  } catch (err) {
    console.error("Submit error:", err);
    return res.status(500).json({ error: err.message });
  }
}
