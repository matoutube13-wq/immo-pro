import Anthropic from "@anthropic-ai/sdk";

export const config = {
  api: {
    bodyParser: { sizeLimit: "6mb" },
    responseLimit: false
  },
  maxDuration: 60
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    const { file, allExtracted, mode } = req.body;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // ── MODE VÉRIFICATION : analyse cohérence + documents manquants ──────────
    if (mode === "verify") {
      if (!allExtracted) return res.status(400).json({ error: "Données manquantes pour la vérification" });

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [{
            type: "text",
            text: `Tu es un expert en droit immobilier belge (Wallonie). Analyse ces données extraites de plusieurs documents d'un dossier de vente immobilière.

Données extraites :
${JSON.stringify(allExtracted, null, 2)}

Documents fournis : ${allExtracted._documentsFound?.join(", ") || "non spécifiés"}

Tu dois faire DEUX analyses :

**1. DOCUMENTS MANQUANTS**
Liste les documents indispensables pour un compromis de vente en Wallonie qui semblent manquants ou dont les données sont absentes. Documents obligatoires à vérifier :
- Certificat PEB (performance énergétique)
- Contrôle de l'installation électrique
- Attestation du sol / extrait BDES
- Renseignements urbanistiques
- Titre de propriété / acte de base
- Identité complète vendeur(s) et acquéreur(s)
- Prix de vente convenu

**2. INCOHÉRENCES DÉTECTÉES**
Vérifie si toutes les données sont cohérentes entre elles :
- L'adresse du bien est-elle la même partout ?
- Les noms des vendeurs/acquéreurs sont-ils cohérents ?
- Les données cadastrales correspondent-elles ?
- Les dates sont-elles logiques ?
- Y a-t-il des contradictions entre documents ?

Réponds UNIQUEMENT avec ce JSON valide, sans markdown :

{
  "documentsManquants": [
    {
      "document": "Nom du document manquant",
      "obligatoire": true,
      "raison": "Pourquoi c'est indispensable"
    }
  ],
  "incoherences": [
    {
      "type": "adresse | identite | cadastre | prix | date | autre",
      "description": "Description précise de l'incohérence",
      "valeur1": "Valeur trouvée dans doc A",
      "valeur2": "Valeur trouvée dans doc B",
      "suggestion": "Quelle valeur semble correcte ou quoi vérifier"
    }
  ],
  "statut": "ok | attention | bloquant",
  "resume": "Résumé en 1-2 phrases de l'état du dossier"
}`
          }]
        }]
      });

      const raw = response.content.filter(b => b.type === "text").map(b => b.text).join("");
      const clean = raw.replace(/```json|```/g, "").trim();
      let result = {};
      try { result = JSON.parse(clean); }
      catch { const m = clean.match(/\{[\s\S]*\}/); if (m) try { result = JSON.parse(m[0]); } catch {} }

      return res.status(200).json(result);
    }

    // ── MODE EXTRACTION : analyse un fichier ─────────────────────────────────
    if (!file) return res.status(400).json({ error: "Aucun fichier fourni" });

    const mediaType = file.type || "application/pdf";
    const isSupported = mediaType === "application/pdf" || mediaType.startsWith("image/");
    if (!isSupported) return res.status(400).json({ error: "Format non supporté. Utilisez PDF ou image." });

    const estimatedBytes = (file.data.length * 3) / 4;
    if (estimatedBytes > 4 * 1024 * 1024) {
      return res.status(413).json({ error: `Fichier trop volumineux (${(estimatedBytes / 1024 / 1024).toFixed(1)} MB). Maximum 4 MB par fichier.` });
    }

    const contentBlock = mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data } }
      : { type: "image", source: { type: "base64", media_type: mediaType, data: file.data } };

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          contentBlock,
          {
            type: "text",
            text: `Tu es un expert en immobilier belge. Analyse ce document officiel lié à une transaction immobilière en Wallonie.

Identifie d'abord le TYPE de document (PEB, contrôle électrique, attestation sol, renseignements urbanistiques, compromis, fiche bien, titre de propriété, etc.).

Extrais TOUTES les informations disponibles. Pour les champs non présents dans CE document, mets null.

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown :

{
  "_typeDocument": "type du document identifié",
  "vendeurs": [{"civilite": "Monsieur ou Madame","nom": "NOM majuscules","prenom": "Prénom","dateNaissance": "JJ mois AAAA","lieuNaissance": "Ville","adresse": "Adresse complète","telephone": "numéro","email": "email"}],
  "acquereurs": [{"civilite": "Monsieur ou Madame","nom": "NOM majuscules","prenom": "Prénom","dateNaissance": "JJ mois AAAA","lieuNaissance": "Ville","adresse": "Adresse complète","situationFamiliale": "célibataire/marié(e)/cohabitant(e) légal(e)/divorcé(e)/veuf/veuve","telephone": "numéro","email": "email"}],
  "adresseBien": null,
  "commune": null,
  "division": null,
  "section": null,
  "numero": null,
  "contenance": null,
  "revenuCadastral": null,
  "prixChiffres": null,
  "prixLettres": null,
  "peb_numero": null,
  "peb_expert": null,
  "peb_date": null,
  "peb_classe": null,
  "elec_date": null,
  "elec_organisme": null,
  "elec_conforme": null,
  "citerne_present": null,
  "citerne_type": null,
  "zone_inondable": null,
  "urbanisme_zone": null,
  "urbanisme_permis": null,
  "urbanisme_date_permis": null,
  "sol_date": null,
  "notaireVendeur": null,
  "notaireAcquereur": null
}`
          }
        ]
      }]
    });

    const rawText = response.content.filter(b => b.type === "text").map(b => b.text).join("");
    const clean = rawText.replace(/```json|```/g, "").trim();
    let extracted = {};
    try { extracted = JSON.parse(clean); }
    catch { const m = clean.match(/\{[\s\S]*\}/); if (m) try { extracted = JSON.parse(m[0]); } catch {} }

    return res.status(200).json(extracted);

  } catch (err) {
    console.error("Extract error:", err);
    return res.status(err.status || 500).json({ error: err.message || "Erreur lors de l'analyse" });
  }
}
