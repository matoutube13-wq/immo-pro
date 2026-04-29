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
    'Joëlle De Lattin': 15, 'Axel Bourgeois': 16, 'Julia Kongo': 17
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

  // ── EXTRACTION URL (fallback si scrape échoue) ──────────────────────────────
  const urlParts = url.replace(/\/$/, '').split('/');
  const lastSeg   = urlParts[urlParts.length - 1] || '';
  const isNumeric = /^\d+$/.test(lastSeg);
  const villeSlug = isNumeric ? urlParts[urlParts.length - 2] : lastSeg;
  const typeSlug  = isNumeric ? urlParts[urlParts.length - 3] : urlParts[urlParts.length - 2];
  const villeUrl  = cap(villeSlug);
  const typeBienUrl = cap(typeSlug.split('-')[0]);

  // ── SCRAPE (triple fallback, timeouts courts) ───────────────────────────────
  let html = '', scrapeMethod = '';

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/html', 'Accept-Language': 'fr-BE,fr;q=0.9' },
      signal: AbortSignal.timeout(8000)
    });
    const h = await r.text();
    if (h.length > 2000) { html = h; scrapeMethod = 'direct'; }
  } catch(e) {}

  if (!html) {
    try {
      const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      const h = await r.text();
      if (h.length > 2000) { html = h; scrapeMethod = 'corsproxy'; }
    } catch(e) {}
  }

  if (!html) {
    try {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j?.contents?.length > 2000) { html = j.contents; scrapeMethod = 'allorigins'; }
    } catch(e) {}
  }

  // ── EXTRACTION HTML ─────────────────────────────────────────────────────────
  let agenceIndex = null, adresseComplete = null, allPhotos = [];
  let postTexte = null, genErr = null;

  if (html) {
    const htmlLower = html.toLowerCase();

    // Agence — basée sur les signaux explicites dans la page
    const isLiege = html.includes('04 336 35 82') || html.includes('04/336') ||
                    htmlLower.includes('treviliege') || htmlLower.includes('trevi liège') ||
                    htmlLower.includes('trevi liege') || htmlLower.includes('info@treviliege');
    const isRasquain = html.includes('085 25 39 03') || html.includes('085/25') ||
                       htmlLower.includes('trevirasquain') || htmlLower.includes('trevi rasquain') ||
                       htmlLower.includes('info@trevirasquain');
    if (isLiege && !isRasquain) agenceIndex = 1;
    else if (isRasquain && !isLiege) agenceIndex = 2;
    else if (isLiege && isRasquain) {
      const iL = Math.min(html.indexOf('04 336') > -1 ? html.indexOf('04 336') : 999999, htmlLower.indexOf('treviliege') > -1 ? htmlLower.indexOf('treviliege') : 999999);
      const iR = Math.min(html.indexOf('085 25') > -1 ? html.indexOf('085 25') : 999999, htmlLower.indexOf('trevirasquain') > -1 ? htmlLower.indexOf('trevirasquain') : 999999);
      agenceIndex = iL < iR ? 1 : 2;
    }

    // Contacts selon agence
    const contactEmail = agenceIndex === 1 ? 'info@treviliege.be' : 'info@trevirasquain.be';
    const contactTel   = agenceIndex === 1 ? '04 336 35 82' : '085 25 39 03';

    // Adresse complète (4 fallbacks)
    const streetM = html.match(/"streetAddress"\s*:\s*"([^"]+)"/i);
    const postalM = html.match(/"postalCode"\s*:\s*"([^"]+)"/i);
    const cityM   = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i);
    if (streetM) {
      adresseComplete = streetM[1].trim();
      if (postalM) adresseComplete += ', ' + postalM[1].trim();
      if (cityM)   adresseComplete += ' ' + cityM[1].trim();
    }
    if (!adresseComplete) {
      const m = html.match(/itemprop="streetAddress"[^>]*>\s*([^<]+)</i);
      if (m && m[1].trim().length > 4) adresseComplete = m[1].trim();
    }
    if (!adresseComplete) {
      const h1 = html.match(/<h1[^>]*>([^<]{10,80})<\/h1>/i);
      if (h1) adresseComplete = h1[1].trim().replace(/\s+/g, ' ');
    }
    if (adresseComplete) adresseComplete = adresseComplete.replace(/\s+/g, ' ').trim();

    // Photos — extraire TOUTES les images du bien
    const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                  html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogImg && ogImg[1]) allPhotos.push(ogImg[1]);

    const allImgUrls = [...html.matchAll(/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|webp|png)(?:\?[^"'\s<>]*)?/gi)]
      .map(m => m[0])
      .filter(u => {
        const l = u.toLowerCase();
        return !l.includes('logo') && !l.includes('icon') && !l.includes('avatar') &&
               !l.includes('sprite') && !l.includes('flag') && !l.includes('btn') &&
               !l.includes('background') && !l.includes('pixel') && !l.includes('tracking') &&
               (l.includes('photo') || l.includes('image') || l.includes('img') ||
                l.includes('media') || l.includes('upload') || l.includes('trevi') ||
                l.includes('annonce') || u.length > 90);
      });
    for (const imgUrl of allImgUrls) {
      if (!allPhotos.includes(imgUrl)) allPhotos.push(imgUrl);
    }
    allPhotos = allPhotos.slice(0, 20);

    // Prix
    const prixAP = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
    const prixAU = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*€/i);
    const prixSe = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
    let prixDetecte = null, prixType = null;
    if (prixAP)      { prixDetecte = prixAP[1].trim().replace(/\s/g,''); prixType = 'a_partir_de'; }
    else if (prixAU) { prixDetecte = prixAU[1].trim().replace(/\s/g,''); prixType = 'au_prix_de'; }
    else if (prixSe) { prixDetecte = prixSe[1].trim().replace(/\s/g,''); prixType = 'prix_fixe'; }
    const prixLabel = prixType==='a_partir_de' ? `à partir de ${prixDetecte} €` : prixType==='au_prix_de' ? `au prix de ${prixDetecte} €` : prixDetecte ? `${prixDetecte} €` : '[prix non détecté]';

    // Visite virtuelle
    const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;

    // Texte pour Claude
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,12000);

    // ── CLAUDE ──────────────────────────────────────────────────────────────────
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          system: `Tu es expert en communication immobilière pour TREVI Rasquain et TREVI Liège.
Tu génères des posts Facebook en respectant STRICTEMENT le format, les emojis, et les caractères gras Unicode ci-dessous.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES ABSOLUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Ne jamais inventer d'informations
- Utiliser uniquement ce qui est présent dans le contenu fourni
- Si une info est absente, ne pas mentionner la section
- Visite virtuelle : inclure UNIQUEMENT si un lien Matterport est présent
- Infos techniques : toujours toutes les inclure sans exception
- Prix : ${prixLabel}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT EXACT DU POST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[TITRE]
🏡 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [Type de bien] à [𝗩𝗜𝗟𝗟𝗘 𝗘𝗡 𝗚𝗥𝗔𝗦 𝗨𝗡𝗜𝗖𝗢𝗗𝗘] 📌
ou 🏡 𝗔 𝗟𝗢𝗨𝗘𝗥 – [Type de bien] à [𝗩𝗜𝗟𝗟𝗘] 📌
(Si nouvelles conditions : ajouter "NOUVELLES CONDITIONS" sur la ligne AVANT le titre)

[VISITE VIRTUELLE — uniquement si lien Matterport présent]
🎥 VISITE VIRTUELLE DISPONIBLE : ${virtualVisit || '[lien]'}

[ACCROCHE]
1 à 3 phrases valorisantes. Chiffres en gras Unicode : 𝟭𝟱𝟬 𝗺², 𝟮.𝟴𝟯𝟮 𝗺².

[COMPOSITION DU BIEN]
✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :
Si niveaux disponibles → sous-titres avec ✔️ :
✔️ 𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 : / ✔️ 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 : / ✔️ 𝗘́𝘁𝗮𝗴𝗲 :
Chaque élément : – [description] (tiret demi-cadratin –, jamais -)
Si pas de niveaux → ✨ 𝗖𝗮𝗿𝗮𝗰𝘁𝗲́𝗿𝗶𝘀𝘁𝗶𝗾𝘂𝗲𝘀 𝗽𝗿𝗶𝗻𝗰𝗶𝗽𝗮𝗹𝗲𝘀 :
Terrain → ✨ 𝗔𝘁𝗼𝘂𝘁𝘀 𝗱𝘂 𝘁𝗲𝗿𝗿𝗮𝗶𝗻 : / Commerce/Industriel → + ⚡️ 𝗜𝗻𝗳𝗼𝘀 𝗽𝗿𝗮𝘁𝗶𝗾𝘂𝗲𝘀 :

[EXTÉRIEURS — si applicable]
🌿 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 :
– [élément]

[INFOS TECHNIQUES]
⚡️ 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :
– PEB : [LETTRE] (𝗫𝗫𝗫 kWh/m²/an)
– Chauffage : [type]
– Châssis : [type]
– [tous les autres éléments disponibles]
– Électricité conforme / non conforme
⚠️ Actuellement occupé par des locataires (si bien loué)
✅ Libre à l'acte ! (si libre)

[PRIX]
Offre à partir de : 💰 Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)
Prix fixe : 💰 Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)
Location : 💰 Loyer : 𝗫.𝗫𝗫𝗫 €/mois [+ charges si dispo]
Viager : 💰 𝗩𝗶𝗮𝗴𝗲𝗿 𝗼𝗰𝗰𝘂𝗽𝗲́ – 𝗩𝗲𝗻𝘁𝗲 𝗱𝗲 𝗹𝗮 𝗻𝘂𝗲-𝗽𝗿𝗼𝗽𝗿𝗶𝗲́𝘁𝗲́ :\n– Bouquet : X €\n– Rente : X €/mois
Infos location : 📅 [Disponibilité, caution] / 📋 Candidature à : [email]

[BON À SAVOIR — si info importante]
🔑 𝗕𝗼𝗻 à 𝘀𝗮𝘃𝗼𝗶𝗿 : [info]

[CONTACT — toujours en dernier]
𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗼𝘂𝗿 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 🔑
✉️ ${contactEmail}
📞 ${contactTel}
${url}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CARACTÈRES UNICODE GRAS EXACTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Chiffres : 𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵
Majuscules : 𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭
Minuscules : 𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇
Accentuées : 𝗲́ 𝗲̀ 𝗲̂ 𝗮̀ 𝗶̂ 𝗼̂ 𝗰̧
Règle : – tiret demi-cadratin (pas -), une ligne vide entre sections, jamais de bullet •`,
          messages: [{ role: 'user', content: `Ville : ${villeUrl}\nURL : ${url}${virtualVisit ? `\nVisite virtuelle : ${virtualVisit}` : ''}\n\nContenu :\n${text}` }]
        })
      });
      const aiData = await aiRes.json();
      if (aiData?.error) throw new Error(aiData.error.type + ': ' + aiData.error.message);
      postTexte = aiData?.content?.[0]?.text?.trim() || null;
      if (!postTexte) throw new Error('Réponse Claude vide');
    } catch(e) { genErr = e.message; }
  }

  try {
    // ── TITRE ─────────────────────────────────────────────────────────────────
    const packLabel = pack.toUpperCase();
    const adresseTitre = adresseComplete || villeUrl;
    const itemName = `${packLabel} – ${adresseTitre}`;

    // ── COLONNES ──────────────────────────────────────────────────────────────
    const delegueId = DELEGUE_MAP[delegue];
    const colVals = {
      dropdown_mkxvvrvk: { ids: [1] },
      project_status:    { label: 'A faire' },
      project_owner:     { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (delegueId !== null && delegueId !== undefined) colVals.dropdown_mkxvwsdj = { ids: [delegueId] };
    if (agenceIndex !== null) colVals.color_mkv6tmwp = { index: agenceIndex };

    // ── CRÉER L'ITEM ──────────────────────────────────────────────────────────
    const createData = await mondayQ(`mutation {
      create_item(board_id: ${BOARD_ID}, group_id: "${GROUP_ID}",
        item_name: ${JSON.stringify(itemName)},
        column_values: ${JSON.stringify(JSON.stringify(colVals))}) { id }
    }`);
    const itemId = createData?.data?.create_item?.id;
    if (!itemId) throw new Error('create_item: ' + JSON.stringify(createData?.errors || createData));

    // ── UPDATE 1 : INFOS + PHOTO PRINCIPALE ───────────────────────────────────
    const photoHtml = allPhotos[0]
      ? `<p>📸 <img src="${allPhotos[0]}" style="max-width:100%;border-radius:8px;margin-top:8px;" /></p>`
      : '';
    const update1 = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      photoHtml
    ].filter(Boolean).join('');
    await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update1)}) { id } }`);

    // ── UPDATE 2 : TEXTE DU POST ───────────────────────────────────────────────
    const update2 = postTexte
      ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
      : `<p><em>⚠️ Texte non généré${genErr ? ' — ' + genErr : ''}${!html ? ' — scrape échoué' : ''}.</em></p>`;
    await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update2)}) { id } }`);

    // ── UPDATE 3 : GALERIE PHOTOS ──────────────────────────────────────────────
    if (allPhotos.length > 1) {
      const photosHtml = allPhotos.map((p, i) =>
        `<p><strong>Photo ${i + 1}</strong><br/><img src="${p}" style="max-width:100%;border-radius:8px;margin-bottom:6px;" /></p>`
      ).join('');
      const update3 = `<p><strong>📸 Galerie photos du bien (${allPhotos.length} photos)</strong></p>${photosHtml}`;
      await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update3)}) { id } }`);
    }

    return res.status(200).json({
      success: true, itemId, itemName,
      textGenerated: !!postTexte,
      photos: allPhotos.length,
      agence: agenceIndex === 2 ? 'HUY' : agenceIndex === 1 ? 'LIÈGE' : null,
      scrapeMethod
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
