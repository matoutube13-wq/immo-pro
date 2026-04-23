export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL manquante" });

  try {
    // ─── 1. SCRAPING ──────────────────────────────────────────────────────────
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const html = await pageRes.text();

    // Visite virtuelle Matterport
    const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;

    // ─── 2. IMAGES ────────────────────────────────────────────────────────────
    const imageMatches = [...html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/gi)];
    const allImages = [...new Set(imageMatches.map(m => m[0]))];
    const propertyImages = allImages.filter(imgUrl => {
      const lower = imgUrl.toLowerCase();
      return (
        !lower.includes("logo") && !lower.includes("icon") && !lower.includes("avatar") &&
        !lower.includes("banner") && !lower.includes("pixel") && !lower.includes("tracking") &&
        !lower.includes("sprite") && !lower.includes("thumbnail") &&
        (lower.includes("photo") || lower.includes("image") || lower.includes("img") ||
         lower.includes("media") || lower.includes("upload") || lower.includes("property") ||
         lower.includes("bien") || lower.includes("trevi") || imgUrl.length > 80)
      );
    }).slice(0, 10);
    const mainImage = propertyImages[0] || null;

    // ─── 3. PRIX ──────────────────────────────────────────────────────────────
    const prixAPartirMatch = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
    const prixAuPrixMatch  = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*€/i);
    const prixSeulMatch    = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
    const loyerMatch       = html.match(/([\d]{3,4})\s*€\s*\/\s*mois/i);
    const viagerMatch      = html.match(/viager/i);

    let prixDetecte = null, prixType = null;
    if (prixAPartirMatch)     { prixDetecte = prixAPartirMatch[1].trim().replace(/\s/g,""); prixType = "a_partir_de"; }
    else if (prixAuPrixMatch) { prixDetecte = prixAuPrixMatch[1].trim().replace(/\s/g,"");  prixType = "au_prix_de"; }
    else if (loyerMatch)      { prixDetecte = loyerMatch[1].trim();                         prixType = "loyer"; }
    else if (prixSeulMatch)   { prixDetecte = prixSeulMatch[1].trim().replace(/\s/g,"");    prixType = "prix_fixe"; }

    const prixLabel =
      prixType === "a_partir_de" ? `à partir de ${prixDetecte} €` :
      prixType === "au_prix_de"  ? `au prix de ${prixDetecte} €`  :
      prixType === "loyer"       ? `${prixDetecte} €/mois`        :
      prixDetecte ? `${prixDetecte} €` : "[prix non détecté]";

    // ─── 4. NETTOYAGE HTML ────────────────────────────────────────────────────
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 10000);

    // ─── 5. GÉNÉRATION VIA CLAUDE ─────────────────────────────────────────────
    const systemPrompt = `Tu es expert en communication immobilière pour l'agence TREVI Rasquain en Belgique.
Génère DEUX choses séparées par le délimiteur ---JSON--- :

1. Un post Facebook qui suit EXACTEMENT ce format et ce style (caractères Unicode gras obligatoires) :

${html.match(/\blouer\b|\blocation\b|\bloué\b/i) ? `🏡 𝗔 𝗟𝗢𝗨𝗘𝗥 – [Type de bien] à 𝗩𝗜𝗟𝗟𝗘 📌` : `🏡 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [Type de bien] à 𝗩𝗜𝗟𝗟𝗘 📌`}
${virtualVisit ? `🎥 VISITE VIRTUELLE DISPONIBLE : ${virtualVisit}` : ""}

[1-2 phrases d'accroche courtes et percutantes sur le bien et sa localisation]

✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :
[Si infos détaillées par niveau disponibles :]
✔️ 𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 :        [SI APPLICABLE]
– [élément]
✔️ 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 :
– [élément]
✔️ 𝗘́𝘁𝗮𝗴𝗲 :           [SI APPLICABLE]
– [élément]
✔️ 𝟮𝗲 𝗲́𝘁𝗮𝗴𝗲 :        [SI APPLICABLE]
– [élément]
[Si pas d'infos détaillées par niveau :]
✨ 𝗖𝗮𝗿𝗮𝗰𝘁𝗲́𝗿𝗶𝘀𝘁𝗶𝗾𝘂𝗲𝘀 𝗽𝗿𝗶𝗻𝗰𝗶𝗽𝗮𝗹𝗲𝘀 :
– [élément]

🌿 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 :      [SI jardin/terrasse/garage disponible uniquement]
– [élément]

⚡️ 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :
– PEB : [lettre] ([kWh/m²/an si disponible])
– Chauffage : [type si disponible]
– Châssis : [type si disponible]
– [autres infos techniques disponibles]

${prixType === "a_partir_de" ? `💰 Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)` :
  prixType === "loyer" ? `💰 Loyer : 𝗫.𝗫𝗫𝗫 €/mois` :
  viagerMatch ? `💰 𝗩𝗶𝗮𝗴𝗲𝗿 𝗼𝗰𝗰𝘂𝗽𝗲́ – Bouquet : X € / Rente : X €/mois` :
  `💰 Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)`}
[Remplace X par le vrai prix détecté : ${prixLabel}]

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗼𝘂𝗿 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 🔑
✉️ info@trevirasquain.be
📞 085 25 39 03

${url}

RÈGLES STRICTES :
- Utilise UNIQUEMENT les infos présentes dans le contenu fourni, n'invente rien
- Garde les caractères Unicode gras (𝗔, 𝗩𝗘𝗡𝗗𝗥𝗘, etc.) exactement comme dans le format
- La ville doit être en gras Unicode dans le titre
- Omets les sections non applicables (sous-sol, étage, extérieurs) si pas d'info
- Pour le prix, utilise le format gras Unicode avec les vrais chiffres détectés
- Ne mets PAS de section "Atouts supplémentaires" séparée, intègre tout dans Composition ou Caractéristiques

---JSON---
2. Un objet JSON uniquement avec :
{
  "ville": "[ville du bien]",
  "type_bien": "[Appartement/Maison/Villa/Terrain/etc.]",
  "surface": "[m² ou null]",
  "nb_chambres": "[nombre ou null]",
  "sdb": "[nombre ou null]",
  "peb": "[lettre PEB ou null]"
}`;

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: "user", content: `URL : ${url}\n\nContenu de l'annonce :\n${text}` }]
      })
    });

    const aiData = await aiRes.json();
    const fullResponse = aiData?.content?.[0]?.text || "";

    const parts = fullResponse.split("---JSON---");
    const post = parts[0]?.trim() || "";
    let propertyData = {};
    try { propertyData = JSON.parse(parts[1]?.trim() || "{}"); } catch { propertyData = {}; }

    // ─── 6. WEBHOOK MAKE.COM ──────────────────────────────────────────────────
    const webhookPayload = {
      url_annonce: url,
      ville: propertyData.ville || null,
      type_bien: propertyData.type_bien || null,
      surface: propertyData.surface || null,
      nb_chambres: propertyData.nb_chambres || null,
      peb: propertyData.peb || null,
      prix: prixDetecte, prix_type: prixType, prix_label: prixLabel,
      visite_virtuelle: virtualVisit,
      image_principale: mainImage,
      images: propertyImages,
      post_facebook: post,
      nom_dossier: `${propertyData.ville || "Bien"} - ${propertyData.type_bien || "Immobilier"}`,
      timestamp: new Date().toISOString()
    };

    fetch("https://hook.eu1.make.com/tav9uan6dyis5s5ffeqjbpxezorf4rcr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload)
    }).catch(err => console.error("Webhook error:", err));

    // ─── 7. RÉPONSE ───────────────────────────────────────────────────────────
    return res.status(200).json({
      post,
      ville: propertyData.ville,
      type_bien: propertyData.type_bien,
      prix_label: prixLabel,
      surface: propertyData.surface,
      nb_chambres: propertyData.nb_chambres,
      sdb: propertyData.sdb,
      image_principale: mainImage,
      images: propertyImages,
      webhook_sent: true
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
