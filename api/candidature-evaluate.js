import Anthropic from "@anthropic-ai/sdk";

function parseVal(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === "object") return val;
  let v = val;
  try { v = JSON.parse(v); } catch {}
  if (typeof v === "string") { try { v = JSON.parse(v); } catch {} }
  return v;
}

export const config = {


  api: { bodyParser: { sizeLimit: "20mb" }, responseLimit: false },
  maxDuration: 60
};



async function kvGet(key) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` }
  });
  const d = await r.json();
  return parseVal(d.result);
}

async function kvSet(key, value) {
  const r = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "ID requis" });

    const raw = await kvGet(`candidature:${id}`);
    if (!raw) return res.status(404).json({ error: "Candidature non trouvée" });
    const candidature = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Charger le bien pour les critères
    let bien = null;
    if (candidature.bienId) {
      bien = await kvGet(`bien:${candidature.bienId}`);
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // ── ÉTAPE 1 : Extraire les données du PDF de candidature ──
    let extracted = candidature.extracted;
    if (!extracted) {
      const pdfDoc = candidature.documents?.find(d => d.categorie === 'candidature' && d.type === 'application/pdf');
      if (pdfDoc && pdfDoc.data) {
        const estimatedBytes = (pdfDoc.data.length * 3) / 4;
        if (estimatedBytes <= 4 * 1024 * 1024) {
          const extractRes = await client.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 3000,
            messages: [{
              role: "user",
              content: [
                { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfDoc.data } },
                { type: "text", text: `Extrais toutes les données de ce formulaire de candidature locative TREVI.
Réponds UNIQUEMENT avec ce JSON valide, sans markdown :
{
  "bienAdresse": "adresse du bien mentionné",
  "loyerMentionné": "loyer mentionné",
  "personnes": [
    {
      "civilite": "Madame/Monsieur",
      "nom": "nom de jeune fille",
      "prenoms": "prénoms",
      "adresseActuelle": "adresse",
      "email": "email",
      "telephone": "téléphone",
      "situationFamiliale": "célibataire/cohabitant(e)/marié(e)/divorcé(e)/séparé(e)/veuf(ve)",
      "nbAdultes": 1,
      "nbEnfants": "ex: 2 (8 ans, 5 ans)",
      "revenusMensuelsNets": 0,
      "motifDemenagement": "motif",
      "dateEntreeSouhaitee": "date",
      "fumeur": "oui/non"
    }
  ],
  "animaux": "oui/non",
  "animauxDetail": "description si oui",
  "garante": {
    "civilite": null, "nom": null, "prenoms": null,
    "adresse": null, "email": null, "telephone": null,
    "revenusMensuelsNets": null
  }
}` }
              ]
            }]
          });
          const raw = extractRes.content.filter(b => b.type === "text").map(b => b.text).join("");
          const clean = raw.replace(/```json|```/g, "").trim();
          try { extracted = JSON.parse(clean); }
          catch { const m = clean.match(/\{[\s\S]*\}/); if (m) try { extracted = JSON.parse(m[0]); } catch {} }
        }
      }
    }

    // ── ÉTAPE 2 : Scoring IA ──────────────────────────────────
    const loyer = bien?.loyer || null;
    const totalRevenus = extracted?.personnes?.reduce((s, p) => s + (parseFloat(p.revenusMensuelsNets) || 0), 0) || 0;
    const revenuGarante = parseFloat(extracted?.garante?.revenusMensuelsNets) || 0;
    const revenuTotal = totalRevenus + revenuGarante;

    const contentBlocks = [];
    // Ajouter les docs justificatifs (salaires, contrat)
    for (const doc of (candidature.documents || [])) {
      if (doc.categorie === 'candidature') continue;
      const bytes = (doc.data?.length || 0) * 3 / 4;
      if (bytes > 4 * 1024 * 1024) continue;
      if (doc.type === 'application/pdf') {
        contentBlocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.data } });
      } else if (doc.type?.startsWith('image/')) {
        contentBlocks.push({ type: "image", source: { type: "base64", media_type: doc.type, data: doc.data } });
      }
    }

    contentBlocks.push({ type: "text", text: `Tu es expert en gestion locative belge (loi anti-discrimination respectée).

DONNÉES EXTRAITES DU FORMULAIRE CANDIDATURE :
${JSON.stringify(extracted, null, 2)}

CONTACT CANDIDAT : ${JSON.stringify(candidature.contact)}

BIEN CONCERNÉ :
- Adresse : ${bien?.adresse || candidature.bienAdresse || 'non précisé'}
- Loyer : ${loyer ? loyer + ' €/mois' : 'non précisé'}
- Type : ${bien?.type || 'non précisé'}
- Chambres : ${bien?.chambres || 'non précisé'}
- Critères supplémentaires propriétaire : ${bien?.criteresSup || 'aucun'}

CALCULS PRÉLIMINAIRES :
- Revenus totaux candidats : ${totalRevenus} €/mois
- Revenus avec garant : ${revenuTotal} €/mois
- Ratio revenus/loyer : ${loyer ? (revenuTotal/loyer).toFixed(1) + 'x' : 'incalculable'}
${contentBlocks.length > 1 ? `- ${contentBlocks.length - 1} document(s) justificatif(s) fourni(s)` : '- Aucun document justificatif fourni'}

GRILLE DE NOTATION (total 100 pts) :
- Solvabilité revenus (35 pts) : ratio ≥3x=35, 2.5x=25, 2x=15, <2x=5
- Stabilité professionnelle (25 pts) : CDI/fonctionnaire=25, CDD long=18, indépendant=15, autre=8
- Complétude dossier (20 pts) : docs présents, cohérence formulaire/justificatifs
- Adéquation profil/bien (20 pts) : composition ménage vs superficie, date entrée, motivations

IMPORTANT : Respecte la loi belge anti-discrimination. Ne pénalise pas l'origine, la nationalité, l'état civil en soi.

Réponds UNIQUEMENT avec ce JSON valide, sans markdown :
{
  "score": 78,
  "mention": "Dossier solide",
  "recommandation": "À convoquer",
  "couleur": "green",
  "revenusTotaux": ${revenuTotal},
  "ratioRevenuLoyer": "${loyer ? (revenuTotal/loyer).toFixed(1)+'x' : 'N/A'}",
  "typeContrat": "CDI / CDD / Indépendant / Fonctionnaire / Inconnu",
  "nbPersonnes": ${extracted?.personnes?.length || 1},
  "hasGarante": ${!!extracted?.garante?.nom},
  "documentsPresents": ["liste"],
  "documentsManquants": ["liste"],
  "pointsForts": ["point 1", "point 2"],
  "pointsFaibles": ["point 1"],
  "commentaire": "Analyse 2-3 phrases pour le collaborateur",
  "details": {
    "solvabilite": { "note": 28, "max": 35, "commentaire": "explication" },
    "stabilite": { "note": 20, "max": 25, "commentaire": "explication" },
    "dossier": { "note": 16, "max": 20, "commentaire": "explication" },
    "adequation": { "note": 14, "max": 20, "commentaire": "explication" }
  }
}` });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: contentBlocks }]
    });

    const rawText = response.content.filter(b => b.type === "text").map(b => b.text).join("");
    const cleanText = rawText.replace(/```json|```/g, "").trim();
    let evaluation = {};
    try { evaluation = JSON.parse(cleanText); }
    catch { const m = cleanText.match(/\{[\s\S]*\}/); if (m) try { evaluation = JSON.parse(m[0]); } catch {} }

    // Sauvegarder
    const updated = { ...candidature, statut: 'note', score: evaluation.score || 0, extracted, evaluation };
    await kvSet(`candidature:${id}`, updated);

    // Mettre à jour la liste du bien
    if (candidature.bienId) {
      const list = await kvLRange(`candidatures:bien:${candidature.bienId}`);
      for (let i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          const url = `${process.env.KV_REST_API_URL}/lset/${encodeURIComponent(`candidatures:bien:${candidature.bienId}`)}/${i}`;
          await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(JSON.stringify({ ...list[i], statut: 'note', score: evaluation.score || 0, mention: evaluation.mention, couleur: evaluation.couleur, recommandation: evaluation.recommandation }))
          });
          break;
        }
      }
    }

    return res.status(200).json({ success: true, evaluation, extracted });

  } catch (err) {
    console.error("Evaluate error:", err);
    return res.status(err.status || 500).json({ error: err.message });
  }
}
