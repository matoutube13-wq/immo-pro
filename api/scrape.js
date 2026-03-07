export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL manquante" });

  try {
    // 1. Scraping de la page
    const pageRes = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const html = await pageRes.text();

    // Extraction lien visite virtuelle
    const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;

    // Nettoyage HTML
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 10000);

    // 2. Génération du post via Claude
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        system: `Tu es expert en communication immobilière pour l'agence TREVI Rasquain.
Génère un post Facebook professionnel et élégant uniquement avec les données fournies. N'invente rien.

Format EXACT à respecter :

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

💰 Prix : [prix en gras unicode] €
(sous réserve d'acceptation des propriétaires)

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗼𝘂𝗿 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 👇
📧 info@trevirasquain.be
📞 085 25 39 03
🔗 ${url}

Réponds UNIQUEMENT avec le texte du post.`,
        messages: [{ role: "user", content: `Contenu de l'annonce :\n${text}` }]
      })
    });

    const aiData = await aiRes.json();
    const post = aiData?.content?.[0]?.text || "";
    return res.status(200).json({ post });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
