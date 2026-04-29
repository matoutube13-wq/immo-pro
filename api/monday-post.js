export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { delegue, url, pack, remarques } = req.body;
  if (!delegue || !url || !pack) return res.status(400).json({ error: 'Champs manquants' });

  const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN;
  const BOARD_ID = '2115483966';
  const GROUP_ID = 'group_mkxsjfgg';
  const TREVI_USER_ID = '80840427';

  const DELEGUE_MAP = {
    'Quentin Delloye': 1, 'Benoît Rasquain': 2, 'Caroline Gustin': 5,
    'Sarah Khounchi': 6, 'Romain Marchandisse': 7, 'Venceslas Viseur': 8,
    'Mathias Infantolino': 9, 'Marie Tilman': 10, 'Tim Fagot': 11,
    'Charlotte Dispa': 12, 'Thibault Bourgeois': 13, 'Thibaut Gustin': 14,
    'Joëlle De Lattin': 15, 'Axel Bourgeois': 16, 'Julia Kongo': null
  };

  function cap(s) {
    return String(s||'').replace(/-/g,' ').split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  async function mondayQ(query) {
    const r = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN, 'API-Version': '2024-01' },
      body: JSON.stringify({ query })
    });
    return r.json();
  }

  // ── EXTRACTION URL (fallback) ───────────────────────────────────────────────
  const urlParts = url.replace(/\/$/, '').split('/');
  const lastSeg   = urlParts[urlParts.length - 1] || '';
  const isNumeric = /^\d+$/.test(lastSeg);
  const villeSlug = isNumeric ? urlParts[urlParts.length - 2] : lastSeg;
  const typeSlug  = isNumeric ? urlParts[urlParts.length - 3] : urlParts[urlParts.length - 2];
  const villeUrl  = cap(villeSlug);
  const typeBienUrl = cap(typeSlug.split('-')[0]);

  // ── SCRAPE (triple fallback) ────────────────────────────────────────────────
  let html = '', scrapeMethod = '';

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-BE,fr;q=0.9' },
      signal: AbortSignal.timeout(12000)
    });
    const h = await r.text();
    if (h.length > 2000 && (h.includes('trevi') || h.includes('bien'))) { html = h; scrapeMethod = 'direct'; }
  } catch(e) {}

  if (!html) {
    try {
      const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
      const h = await r.text();
      if (h.length > 2000) { html = h; scrapeMethod = 'corsproxy'; }
    } catch(e) {}
  }

  if (!html) {
    try {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      if (j?.contents?.length > 2000) { html = j.contents; scrapeMethod = 'allorigins'; }
    } catch(e) {}
  }

  // ── EXTRACTION HTML ─────────────────────────────────────────────────────────
  let agenceIndex = null, adresseComplete = null, imageUrl = null;
  let postTexte = null, genErr = null;

  if (html) {
    // Agence depuis le contenu
    const htmlLower = html.toLowerCase();
    if (htmlLower.includes('trevi huy') || htmlLower.includes('agence de huy') || htmlLower.includes('agence huy') || html.includes('085 25 39 03') || html.includes('085/25') || html.includes('085.25')) {
      agenceIndex = 2; // HUY
    } else if (htmlLower.includes('trevi li') || htmlLower.includes('agence de li') || htmlLower.includes('treviliege') || html.includes('04 336') || html.includes('04/336')) {
      agenceIndex = 1; // LIÈGE
    }

    // Adresse
    const adressePatterns = [
      html.match(/"streetAddress"\s*:\s*"([^"]+)"/i),
      html.match(/itemprop="streetAddress"[^>]*>([^<]+)</i),
      html.match(/<h1[^>]*>([^<]{10,80})<\/h1>/i),
    ];
    for (const m of adressePatterns) {
      if (m && m[1] && m[1].trim().length > 4) { adresseComplete = m[1].trim().replace(/\s+/g, ' '); break; }
    }

    // Image og:image
    const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                  html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogImg) {
      imageUrl = ogImg[1];
    } else {
      const imgs = [...html.matchAll(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|webp|png)(?:\?[^"'\s]*)?/gi)]
        .map(m => m[0]).filter(u => { const l = u.toLowerCase(); return !l.includes('logo') && !l.includes('icon') && !l.includes('avatar') && !l.includes('sprite') && (l.includes('photo') || l.includes('image') || l.includes('img') || l.includes('media') || l.includes('upload') || u.length > 80); });
      if (imgs.length) imageUrl = imgs[0];
    }

    // Prix
    const prixAP = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
    const prixAU = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*€/i);
    const prixSe = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
    let prixDetecte = null, prixType = null;
    if (prixAP)      { prixDetecte = prixAP[1].trim().replace(/\s/g,''); prixType = 'a_partir_de'; }
    else if (prixAU) { prixDetecte = prixAU[1].trim().replace(/\s/g,''); prixType = 'au_prix_de'; }
    else if (prixSe) { prixDetecte = prixSe[1].trim().replace(/\s/g,''); prixType = 'prix_fixe'; }
    const prixLabel =
      prixType === 'a_partir_de' ? `à partir de ${prixDetecte} €` :
      prixType === 'au_prix_de'  ? `au prix de ${prixDetecte} €` :
      prixDetecte ? `${prixDetecte} €` : '[prix non détecté]';

    // Contacts agence (selon l'agence détectée)
    const contactEmail = agenceIndex === 1 ? 'info@treviliege.be' : 'info@trevirasquain.be';
    const contactTel   = agenceIndex === 1 ? '04 336 35 82' : '085 25 39 03';

    // Visite virtuelle
    const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;

    // Texte nettoyé pour Claude
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 12000);

    // ── CLAUDE ─────────────────────────────────────────────────────────────────
    try {
      const SYSTEM_PROMPT = `Tu es expert en communication immobilière pour TREVI Rasquain.
Tu dois générer un post Facebook en respectant STRICTEMENT et EXACTEMENT le format et le style des exemples ci-dessous — sans jamais dévier.

══════════════════════════════════════════════════════════
RÈGLES ABSOLUES DE FORMATAGE
══════════════════════════════════════════════════════════

1. TITRE (1ère ligne) :
   - Vente : 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [description courte du bien] à 𝗩𝗜𝗟𝗟𝗘-𝗘𝗡-𝗠𝗔𝗝𝗨𝗦𝗖𝗨𝗟𝗘𝗦
   - Location : 𝗔 𝗟𝗢𝗨𝗘𝗥 – [description courte du bien] à 𝗩𝗜𝗟𝗟𝗘-𝗘𝗡-𝗠𝗔𝗝𝗨𝗦𝗖𝗨𝗟𝗘𝗦
   - La ville dans le titre est TOUJOURS en caractères gras Unicode (𝗩𝗜𝗟𝗟𝗘)
   - Si nouvelles conditions : ajouter " NOUVELLES CONDITIONS " sur une ligne avant le titre

2. VISITE VIRTUELLE (si disponible) :
   - Ligne séparée IMMÉDIATEMENT après le titre : VISITE VIRTUELLE DISPONIBLE : [lien]

3. ACCROCHE (2-3 phrases) :
   - Texte normal, accrocheur, valorisant
   - Chiffres clés (surface, terrain) en gras Unicode : 𝟭𝟱𝟬 𝗺²
   - Mots importants en gras Unicode quand pertinent

4. COMPOSITION DU BIEN :
   - Titre : 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :
   - Si le bien a plusieurs niveaux clairement définis, utiliser des sous-titres en gras Unicode :
     𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 :, 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 :, 𝗘́𝘁𝗮𝗴𝗲 :, 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 :
   - Chaque élément commence par – (tiret demi-cadratin)
   - Pour les terrains/commerciaux : utiliser 𝗔𝘁𝗼𝘂𝘁𝘀 𝗱𝘂 𝘁𝗲𝗿𝗿𝗮𝗶𝗻 : ou 𝗜𝗻𝗳𝗼𝘀 𝗽𝗿𝗮𝘁𝗶𝗾𝘂𝗲𝘀 : selon contexte

5. INFOS TECHNIQUES :
   - Titre : 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :
   - Chaque info commence par – (tiret demi-cadratin)
   - PEB : toujours classe + valeur en kWh/m²/an
   - Tout ce qui est disponible : chauffage, châssis, conformité élec, panneaux solaires, alarme, citerne, etc.

6. PRIX :
   - "Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 €" si prix à partir de — le montant en gras Unicode avec points de milliers
   - "Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 €" si prix fixe — idem
   - "Loyer : 𝗫.𝟬𝟬𝟬 €/mois" si location — idem
   - "(sous réserve d'acceptation du propriétaire)" ou "des propriétaires" ou "des vendeurs" selon contexte
   - 𝗕𝗼𝗻 à 𝘀𝗮𝘃𝗼𝗶𝗿 : si infos complémentaires importantes (bien loué, libre à l'acte, etc.)

7. CONTACT (toujours identique, dernière section) :
   𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗼𝘂𝗿 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 
    [${contactEmail}](mailto:${contactEmail})
    ${contactTel}
   [URL de l'annonce]

══════════════════════════════════════════════════════════
CARACTÈRES UNICODE GRAS — UTILISE EXACTEMENT CES CARACTÈRES
══════════════════════════════════════════════════════════
Chiffres gras : 𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵
Lettres majuscules gras : 𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭
Lettres minuscules gras : 𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇
Lettres accentuées gras : 𝗲́ 𝗲̀ 𝗲̂ 𝗮̀ 𝗶̂ 𝗼̂ 𝘂̂ 𝗰̧

IMPORTANT : les titres de sections (𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻, 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀, 𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀...) sont TOUJOURS en gras Unicode exact — copie-les tels quels.

══════════════════════════════════════════════════════════
ADAPTATION SELON TYPE DE BIEN
══════════════════════════════════════════════════════════
- Maison/Villa/Appartement : composition par niveaux si info disponible + infos techniques complètes
- Terrain à bâtir : section 𝗔𝘁𝗼𝘂𝘁𝘀 𝗱𝘂 𝘁𝗲𝗿𝗿𝗮𝗶𝗻 : avec points, pas de section Infos techniques sauf si pertinent
- Commerce/Bureau : composition + infos pratiques + charges si disponibles  
- Industriel/Entrepôt : composition détaillée + 𝗜𝗻𝗳𝗼𝘀 𝗽𝗿𝗮𝘁𝗶𝗾𝘂𝗲𝘀 :
- Location : titre 𝗔 𝗟𝗢𝗨𝗘𝗥, prix = Loyer : X.XXX €/mois

N'invente AUCUNE information. Utilise uniquement ce qui est dans le contenu fourni.
Ne mets pas de ligne vide entre chaque tiret dans la composition — garde le même rythme que les exemples.
Prix : ${prixLabel}
`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2500,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `Ville : ${villeUrl}\nURL : ${url}${virtualVisit ? `\nVisite virtuelle : ${virtualVisit}` : ''}\n\nContenu de l'annonce :\n${text}` }]
        })
      });

      const aiData = await aiRes.json();
      if (aiData?.error) throw new Error(aiData.error.type + ': ' + aiData.error.message);
      postTexte = aiData?.content?.[0]?.text?.trim() || null;
      if (!postTexte) throw new Error('Réponse Claude vide');
    } catch(e) { genErr = e.message; }
  }

  try {
    // ── TITRE MONDAY ───────────────────────────────────────────────────────────
    const packLabel = pack.toUpperCase();
    const adresseTitre = adresseComplete || villeUrl;
    const itemName = `${packLabel} – ${adresseTitre}`;

    // ── COLONNES ───────────────────────────────────────────────────────────────
    const delegueId = DELEGUE_MAP[delegue];
    const colVals = {
      dropdown_mkxvvrvk: { ids: [1] },
      project_status:    { label: 'A faire' },
      project_owner:     { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (delegueId !== null && delegueId !== undefined) colVals.dropdown_mkxvwsdj = { ids: [delegueId] };
    if (agenceIndex !== null) colVals.color_mkv6tmwp = { index: agenceIndex };

    // ── CRÉER L'ITEM ───────────────────────────────────────────────────────────
    const createData = await mondayQ(`mutation {
      create_item(board_id: ${BOARD_ID}, group_id: "${GROUP_ID}",
        item_name: ${JSON.stringify(itemName)},
        column_values: ${JSON.stringify(JSON.stringify(colVals))}) { id }
    }`);
    const itemId = createData?.data?.create_item?.id;
    if (!itemId) throw new Error('create_item: ' + JSON.stringify(createData?.errors || createData));

    // ── UPDATE 1 : INFOS + PHOTO ───────────────────────────────────────────────
    const update1 = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      imageUrl ? `<p><img src="${imageUrl}" style="max-width:100%;border-radius:8px;margin-top:8px;" /></p>` : '',
    ].filter(Boolean).join('');
    await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update1)}) { id } }`);

    // ── UPDATE 2 : TEXTE DU POST ───────────────────────────────────────────────
    const update2 = postTexte
      ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
      : `<p><em>⚠️ Texte non généré${genErr ? ' — ' + genErr : ''}${!html ? ' — scrape échoué' : ''}.</em></p>`;
    await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update2)}) { id } }`);

    return res.status(200).json({ success: true, itemId, itemName, textGenerated: !!postTexte, agence: agenceIndex === 2 ? 'HUY' : agenceIndex === 1 ? 'LIÈGE' : null, scrapeMethod });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
