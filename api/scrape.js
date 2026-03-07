export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL manquante" });

  try {
    // ─── 1. SCRAPING DE LA PAGE ───────────────────────────────────────────────
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const html = await pageRes.text();

    // Extraction lien visite virtuelle Matterport
    const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;

    // ─── 2. EXTRACTION DES IMAGES ─────────────────────────────────────────────
    // On cherche les images hautes résolution de l'annonce (jpg/jpeg/png/webp)
    const imageMatches = [...html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/gi)];
    const allImages = [...new Set(imageMatches.map(m => m[0]))];

    // Filtrer pour garder uniquement les images qui semblent être des photos de biens
    // (exclure logos, icônes, tracking pixels, etc.)
    const propertyImages = allImages.filter(imgUrl => {
      const lower = imgUrl.toLowerCase();
      return (
        !lower.includes("logo") &&
        !lower.includes("icon") &&
        !lower.includes("avatar") &&
        !lower.includes("banner") &&
        !lower.includes("pixel") &&
        !lower.includes("tracking") &&
        !lower.includes("sprite") &&
        !lower.includes("thumbnail") &&
        (lower.includes("photo") ||
          lower.includes("image") ||
          lower.includes("img") ||
          lower.includes("media") ||
          lower.includes("upload") ||
          lower.includes("property") ||
          lower.includes("bien") ||
          lower.includes("trevi") ||
          // Si aucun mot-clé, garder les images avec un chemin long (probablement des photos)
          imgUrl.length > 80)
      );
    }).slice(0, 10); // Max 10 images

    const mainImage = propertyImages[0] || null;

    // ─── 3. DÉTECTION DU PRIX ─────────────────────────────────────────────────
    // Cherche "à partir de" ou "au prix de" dans le HTML brut
    const prixAPartirMatch = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
    const prixAuPrixMatch = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*€/i);
    // Cherche aussi juste un prix seul (ex: 250.000 €)
    const prixSeulMatch = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);

    let prixDetecte = null;
    let prixType = null;

    if (prixAPartirMatch) {
      prixDetecte = prixAPartirMatch[1].trim().replace(/\s/g, "");
      prixType = "a_partir_de";
    } else if (prixAuPrixMatch) {
      prixDetecte = prixAuPrixMatch[1].trim().replace(/\s/g, "");
      prixType = "au_prix_de";
    } else if (prixSeulMatch) {
      prixDetecte = prixSeulMatch[1].trim().replace(/\s/g, "");
      prixType = "prix_fixe";
    }

    // ─── 4. NETTOYAGE HTML POUR CLAUDE ────────────────────────────────────────
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 10000);

    // ─── 5. GÉNÉRATION VIA CLAUDE ─────────────────────────────────────────────
    // Prix formaté pour le prompt
    const prixLabel =
      prixType === "a_partir_de" ? `à partir de ${prixDetecte} €` :
      prixType === "au_prix_de" ? `au prix de ${prixDetecte} €` :
      prixDetecte ? `${prixDetecte} €` :
      "[prix non détecté]";

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
        system: `Tu es expert en communication immobilière pour l'agence TREVI Rasquain.
Génère DEUX choses séparées par le délimiteur ---JSON--- :

1. Un post Facebook professionnel et élégant uniquement avec les données fournies. N'invente rien.
Format EXACT du post :
A VENDRE – [Type de bien] au centre de 𝗩𝗜𝗟𝗟𝗘 🏡
${virtualVisit ? `\nVISITE VIRTUELLE DISPONIBLE 🎥 : ${virtualVisit}\n` : ""}
[Description courte 2-3 lignes]

𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 🏠 :
- [liste exacte des pièces]

𝗔𝘁𝗼𝘂𝘁𝘀 𝘀𝘂𝗽𝗽𝗹𝗲́𝗺𝗲𝗻𝘁𝗮𝗶𝗿𝗲𝘀 ✨ :
– [garage, parking, cave, jardin, etc.]

𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 ⚙️ :
– PEB : [valeur exacte]
– [chauffage]
– [compteurs si mentionnés]

💰 Prix : ${prixLabel}
(sous réserve d'acceptation des propriétaires)

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 👇
📧 info@trevirasquain.be
📞 085 25 39 03
🔗 [lien annonce]

---JSON---
2. Un objet JSON (et RIEN d'autre après) avec exactement ces champs :
{
  "ville": "[nom de la ville/commune du bien]",
  "type_bien": "[ex: Appartement, Maison, Villa, Terrain...]",
  "surface": "[surface habitable en m² si mentionnée, sinon null]",
  "nb_chambres": "[nombre de chambres si mentionné, sinon null]",
  "peb": "[valeur PEB si mentionnée, sinon null]"
}`,
        messages: [{ role: "user", content: `URL de l'annonce : ${url}\nContenu de l'annonce :\n${text}` }]
      })
    });

    const aiData = await aiRes.json();
    const fullResponse = aiData?.content?.[0]?.text || "";

    // Séparation post Facebook / JSON
    const parts = fullResponse.split("---JSON---");
    const post = parts[0]?.trim() || "";
    let propertyData = {};
    try {
      const jsonRaw = parts[1]?.trim() || "{}";
      propertyData = JSON.parse(jsonRaw);
    } catch {
      propertyData = {};
    }

    // ─── 6. ENVOI AU WEBHOOK MAKE.COM ─────────────────────────────────────────
    const webhookPayload = {
      // Infos du bien
      url_annonce: url,
      ville: propertyData.ville || null,
      type_bien: propertyData.type_bien || null,
      surface: propertyData.surface || null,
      nb_chambres: propertyData.nb_chambres || null,
      peb: propertyData.peb || null,
      // Prix
      prix: prixDetecte,
      prix_type: prixType,
      prix_label: prixLabel,
      // Visite virtuelle
      visite_virtuelle: virtualVisit,
      // Images
      image_principale: mainImage,
      images: propertyImages,
      // Post Facebook généré
      post_facebook: post,
      // Nom du dossier Google Drive
      nom_dossier: `${propertyData.ville || "Bien"} - ${propertyData.type_bien || "Immobilier"}`,
      // Métadonnées
      timestamp: new Date().toISOString()
    };

    // Envoi asynchrone (on n'attend pas la réponse pour ne pas bloquer l'UI)
    fetch("https://hook.eu1.make.com/tav9uan6dyis5s5ffeqjbpxezorf4rcr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload)
    }).catch(err => console.error("Webhook Make.com error:", err));

    // ─── 7. RÉPONSE AU FRONTEND ───────────────────────────────────────────────
    return res.status(200).json({
      post,
      ville: propertyData.ville,
      type_bien: propertyData.type_bien,
      prix_label: prixLabel,
      image_principale: mainImage,
      webhook_sent: true
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
