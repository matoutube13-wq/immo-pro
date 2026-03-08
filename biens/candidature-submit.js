export const config = {
  api: { bodyParser: { sizeLimit: "20mb" }, responseLimit: false },
  maxDuration: 60
};

async function kvSet(key, value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value))
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
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    const { contact, bienId, bienAdresse, documents } = req.body;
    if (!contact?.nom || !contact?.email) return res.status(400).json({ error: "Nom et email obligatoires" });
    if (!bienId) return res.status(400).json({ error: "Bien non sélectionné" });

    const id = `cand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    const entry = {
      id, createdAt: now,
      statut: "en_attente",
      contact,           // nom, email, telephone (saisis dans le formulaire web)
      bienId, bienAdresse,
      documents: documents || [],  // PDF candidature + fiches de salaire + contrat
      extracted: null,   // données extraites par l'IA du PDF
      score: null,
      evaluation: null
    };

    await kvSet(`candidature:${id}`, JSON.stringify(entry));
    await kvLPush(`candidatures:bien:${bienId}`, { id, nom: contact.nom, email: contact.email, createdAt: now, statut: "en_attente", score: null });
    await kvLPush(`candidatures:all`, { id, nom: contact.nom, email: contact.email, bienId, bienAdresse, createdAt: now, statut: "en_attente", score: null });

    return res.status(200).json({ success: true, id, message: "Candidature reçue !" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
