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

  // ── EXTRACTION URL (fallback) ───────────────────────────────────────────────
  const urlParts = url.replace(/\/$/, '').split('/');
  const lastSeg   = urlParts[urlParts.length - 1] || '';
  const isNumeric = /^\d+$/.test(lastSeg);
  const villeSlug = isNumeric ? urlParts[urlParts.length - 2] : lastSeg;
  const typeSlug  = isNumeric ? urlParts[urlParts.length - 3] : urlParts[urlParts.length - 2];
  const villeUrl  = cap(villeSlug);
  const typeBienUrl = cap(typeSlug.split('-')[0]);

  // Extraire l'ID du bien depuis l'URL (ex: /7669004/ → 7669004)
  const bienIdMatch = url.match(/\/(\d{6,8})\//);
  const bienId = bienIdMatch ? bienIdMatch[1] : null;

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

    // ── AGENCE (signaux explicites dans la page) ─────────────────────────────
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

    const contactEmail = agenceIndex === 1 ? 'info@treviliege.be' : 'info@trevirasquain.be';
    const contactTel   = agenceIndex === 1 ? '04 336 35 82' : '085 25 39 03';

    // ── ADRESSE COMPLÈTE ─────────────────────────────────────────────────────
    // Méthode 1 : JSON-LD structuré (streetAddress + postalCode + locality)
    const streetM = html.match(/"streetAddress"\s*:\s*"([^"]+)"/i);
    const postalM = html.match(/"postalCode"\s*:\s*"([^"]+)"/i);
    const cityM   = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i);
    if (streetM) {
      adresseComplete = streetM[1].trim();
      if (postalM) adresseComplete += ', ' + postalM[1].trim();
      if (cityM)   adresseComplete += ' ' + cityM[1].trim();
    }
    // Méthode 2 : itemprop streetAddress
    if (!adresseComplete) {
      const m = html.match(/itemprop="streetAddress"[^>]*>\s*([^<]+)</i);
      if (m && m[1].trim().length > 4) adresseComplete = m[1].trim();
    }
    // Méthode 3 : og:description (souvent "Maison à vendre à Rue X, 4500 Huy")
    if (!adresseComplete) {
      const ogDesc = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
                     html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i);
      if (ogDesc) {
        const addrMatch = ogDesc[1].match(/\d{4}\s+[A-Za-zÀ-ÿ\s-]{2,30}/);
        if (addrMatch) adresseComplete = ogDesc[1].substring(0, ogDesc[1].indexOf(addrMatch[0]) + addrMatch[0].length).trim();
      }
    }
    // Méthode 4 : Claude extraira l'adresse depuis le texte (voir prompt)
    if (adresseComplete) adresseComplete = adresseComplete.replace(/\s+/g, ' ').trim();

    // ── PHOTOS (pattern storagewhise spécifique à trevi.be) ──────────────────
    // trevi.be héberge toutes les photos sur r2.storagewhise.eu/storage11049/Pictures/[bienId]/1920/
    if (bienId) {
      // Extraire toutes les URLs d'images storagewhise pour ce bien
      const storagePattern = new RegExp(`https://r2\\.storagewhise\\.eu/storage\\d+/Pictures/${bienId}/1920/[^"'\\s<>]+\\.(?:jpg|jpeg|webp|png)`, 'gi');
      const storageMatches = [...html.matchAll(storagePattern)].map(m => m[0]);
      // Dédupliquer
      const uniquePhotos = [...new Set(storageMatches)];
      allPhotos = uniquePhotos.slice(0, 30); // max 30 photos
    }

    // Fallback : og:image + autres images si storagewhise ne donne rien
    if (allPhotos.length === 0) {
      const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                    html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
      if (ogImg) allPhotos.push(ogImg[1]);
      const otherImgs = [...html.matchAll(/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|webp|png)(?:\?[^"'\s<>]*)?/gi)]
        .map(m => m[0])
        .filter(u => { const l = u.toLowerCase(); return !l.includes('logo') && !l.includes('icon') && !l.includes('sprite') && !l.includes('pixel') && (l.includes('photo') || l.includes('image') || l.includes('media') || l.includes('upload') || l.includes('trevi') || u.length > 90); });
      for (const img of otherImgs) { if (!allPhotos.includes(img)) allPhotos.push(img); }
      allPhotos = allPhotos.slice(0, 20);
    }

    // ── PRIX ─────────────────────────────────────────────────────────────────
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

    // Texte nettoyé pour Claude
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,12000);

    // ── CLAUDE ───────────────────────────────────────────────────────────────
    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2500,
          system: `Tu es expert en communication immobilière pour TREVI Rasquain et TREVI Liège.
Tu génères des posts Facebook en respectant STRICTEMENT le format, les emojis, et les caractères gras Unicode.

PREMIÈRE TÂCHE OBLIGATOIRE — extraire l'adresse complète :
Cherche dans le contenu l'adresse complète du bien (rue + numéro + code postal + ville).
Tu vas retourner TWO choses séparées par ---ADRESSE--- :
1. Le post Facebook complet
2. L'adresse complète du bien (ex: "Rue de la Paix 12, 4500 Huy") ou "INCONNU" si introuvable

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT EXACT DU POST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prix : ${prixLabel}

[TITRE]
🏡 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [Type de bien] à [𝗩𝗜𝗟𝗟𝗘 𝗘𝗡 𝗚𝗥𝗔𝗦 𝗨𝗡𝗜𝗖𝗢𝗗𝗘] 📌
ou 🏡 𝗔 𝗟𝗢𝗨𝗘𝗥 – [Type] à [𝗩𝗜𝗟𝗟𝗘] 📌

[VISITE VIRTUELLE — uniquement si lien Matterport présent]
🎥 VISITE VIRTUELLE DISPONIBLE : ${virtualVisit || ''}

[ACCROCHE] 1-3 phrases valorisantes. Chiffres en gras Unicode : 𝟭𝟱𝟬 𝗺².

[COMPOSITION]
✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :
Niveaux avec ✔️ : ✔️ 𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 : / ✔️ 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 : / ✔️ 𝗘́𝘁𝗮𝗴𝗲 :
Chaque élément avec – (tiret demi-cadratin, jamais -)
Sans niveaux → ✨ 𝗖𝗮𝗿𝗮𝗰𝘁𝗲́𝗿𝗶𝘀𝘁𝗶𝗾𝘂𝗲𝘀 𝗽𝗿𝗶𝗻𝗰𝗶𝗽𝗮𝗹𝗲𝘀 :
Terrain → ✨ 𝗔𝘁𝗼𝘂𝘁𝘀 𝗱𝘂 𝘁𝗲𝗿𝗿𝗮𝗶𝗻 :

[EXTÉRIEURS si applicable]
🌿 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 :

[INFOS TECHNIQUES — toutes sans exception]
⚡️ 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :
– PEB : [LETTRE] (𝗫𝗫𝗫 kWh/m²/an)
– Chauffage : [type]
– Châssis : [type]
– [tout le reste : panneaux, PAC, VMC, citerne, alarme, clim, etc.]
– Électricité conforme/non conforme
⚠️ si bien loué / ✅ si libre à l'acte

[PRIX]
Offre → 💰 Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)
Fixe → 💰 Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)
Location → 💰 Loyer : 𝗫.𝗫𝗫𝗫 €/mois [+ charges]\n📅 [disponibilité, caution]\n📋 Candidature à : [email si dispo]
Viager → 💰 𝗩𝗶𝗮𝗴𝗲𝗿 𝗼𝗰𝗰𝘂𝗽𝗲́ – 𝗩𝗲𝗻𝘁𝗲 𝗱𝗲 𝗹𝗮 𝗻𝘂𝗲-𝗽𝗿𝗼𝗽𝗿𝗶𝗲́𝘁𝗲́ :\n– Bouquet : X €\n– Rente : X €/mois

🔑 𝗕𝗼𝗻 à 𝘀𝗮𝘃𝗼𝗶𝗿 : [si info importante]

[CONTACT — toujours en dernier]
𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗼𝘂𝗿 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 🔑
✉️ ${contactEmail}
📞 ${contactTel}
${url}

CARACTÈRES UNICODE GRAS : 𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵 | 𝗔-𝗭 | 𝗮-𝘇 | 𝗲́ 𝗲̀ 𝗰̧
Règle : – demi-cadratin, ligne vide entre sections, jamais de bullet •
N'invente rien. Si une section n'a pas d'info disponible, l'omettre entièrement.`,
          messages: [{ role: 'user', content: `Ville : ${villeUrl}\nURL : ${url}${virtualVisit ? `\nVisite virtuelle : ${virtualVisit}` : ''}\n\nContenu :\n${text}` }]
        })
      });
      const aiData = await aiRes.json();
      if (aiData?.error) throw new Error(aiData.error.type + ': ' + aiData.error.message);
      const fullResponse = aiData?.content?.[0]?.text?.trim() || '';

      // Séparer le post et l'adresse
      const parts = fullResponse.split('---ADRESSE---');
      postTexte = parts[0]?.trim() || null;
      const adresseFromClaude = parts[1]?.trim();
      if (adresseFromClaude && adresseFromClaude !== 'INCONNU' && adresseFromClaude.length > 4) {
        if (!adresseComplete) adresseComplete = adresseFromClaude;
      }
      if (!postTexte) throw new Error('Réponse Claude vide');
    } catch(e) { genErr = e.message; }
  }

  try {
    // ── TITRE : PACK DU PAUVRE – Adresse complète ─────────────────────────────
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
      ? `<p>📸 <img src="${allPhotos[0]}" style="max-width:100%;border-radius:8px;" /></p>`
      : '';
    const update1 = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 <a href="${url}">${url}</a></p>`,
      adresseComplete ? `<p>📍 ${adresseComplete}</p>` : '',
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      photoHtml
    ].filter(Boolean).join('');
    await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update1)}) { id } }`);

    // ── UPDATE 2 : TEXTE DU POST ───────────────────────────────────────────────
    const update2 = postTexte
      ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
      : `<p><em>⚠️ Texte non généré${genErr ? ' — ' + genErr : ''}${!html ? ' — scrape échoué' : ''}.</em></p>`;
    await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update2)}) { id } }`);

    // ── UPDATE 3 : GALERIE PHOTOS (avec liens téléchargeables) ────────────────
    if (allPhotos.length > 0) {
      const photosHtml = allPhotos.map((p, i) =>
        `<p><strong>Photo ${i + 1}</strong> — <a href="${p}" target="_blank">⬇️ Télécharger</a><br/>` +
        `<img src="${p}" style="max-width:100%;border-radius:6px;margin-top:4px;" /></p>`
      ).join('');
      const update3 = `<p><strong>📸 Photos du bien — ${allPhotos.length} photo${allPhotos.length > 1 ? 's' : ''}</strong></p>${photosHtml}`;
      await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update3)}) { id } }`);
    }

    return res.status(200).json({
      success: true, itemId, itemName,
      textGenerated: !!postTexte,
      photos: allPhotos.length,
      agence: agenceIndex === 2 ? 'HUY' : agenceIndex === 1 ? 'LIÈGE' : null,
      scrapeMethod, adresse: adresseComplete
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
