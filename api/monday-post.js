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

  const HUY_VILLES = [
    'huy','amay','wanze','andenne','ben-ahin','tihange','engis',
    'villers-le-bouillet','burdinne','braives','hannut','wasseiges',
    'tinlot','modave','marchin','clavier','nandrin','verlaine',
    'oreye','remicourt','berloz','crisnee','bassenge','waremme',
    'borgworm','lincent','geer','donceel','faimes'
  ];
  const LIEGE_VILLES = [
    'liege','seraing','ans','grace-hollogne','flemalle','herstal',
    'saint-nicolas','juprelle','awans','fexhe','soumagne',
    'beyne-heusay','chenee','grivegnee','wandre','bressoux','jupille',
    'fleron','trooz','chaudfontaine','angleur','esneux','sprimont',
    'neupre','vise','blegny','olne','pepinster','theux','spa',
    'aywaille','lierneux','stoumont'
  ];

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

  // ── EXTRACTION DEPUIS L'URL ─────────────────────────────────────────────────
  const urlParts = url.replace(/\/$/, '').split('/');
  const lastSeg  = urlParts[urlParts.length - 1] || '';
  const isNumeric = /^\d+$/.test(lastSeg);
  const villeSlug = isNumeric ? urlParts[urlParts.length - 2] : lastSeg;
  const typeSlug  = isNumeric ? urlParts[urlParts.length - 3] : urlParts[urlParts.length - 2];
  const ville     = cap(villeSlug);
  const typeBien  = cap(typeSlug.split('-')[0]);
  const transaction = typeSlug.includes('louer') ? 'À LOUER' : 'À VENDRE';

  let agenceIndex = null;
  if (HUY_VILLES.some(v => villeSlug.toLowerCase() === v || villeSlug.toLowerCase().startsWith(v + '-')))
    agenceIndex = 2;
  else if (LIEGE_VILLES.some(v => villeSlug.toLowerCase() === v || villeSlug.toLowerCase().startsWith(v + '-')))
    agenceIndex = 1;

  // ── SCRAPE DIRECT DEPUIS VERCEL ─────────────────────────────────────────────
  // On essaie d'abord directement, puis via cors.sh comme fallback
  let html = '';
  let scrapeMethod = '';

  try {
    // Tentative 1 : direct
    const r1 = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'fr-BE,fr;q=0.9',
      },
      signal: AbortSignal.timeout(12000)
    });
    const h1 = await r1.text();
    if (h1.length > 2000 && h1.includes('trevi')) {
      html = h1;
      scrapeMethod = 'direct';
    }
  } catch(e1) { /* essai 2 */ }

  if (!html) {
    try {
      // Tentative 2 : corsproxy.io
      const r2 = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(12000)
      });
      const h2 = await r2.text();
      if (h2.length > 2000) { html = h2; scrapeMethod = 'corsproxy'; }
    } catch(e2) { /* essai 3 */ }
  }

  if (!html) {
    try {
      // Tentative 3 : allorigins
      const r3 = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(12000)
      });
      const j3 = await r3.json();
      if (j3?.contents?.length > 2000) { html = j3.contents; scrapeMethod = 'allorigins'; }
    } catch(e3) { /* tous échoués */ }
  }

  // ── GÉNÉRATION CLAUDE ───────────────────────────────────────────────────────
  let postTexte = null;
  let genErr = null;

  if (html) {
    try {
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

      const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
      const virtualVisit = matterport ? matterport[0] : null;

      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 10000);

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          system: `Tu es expert en communication immobilière pour TREVI Rasquain.
Rédige un post Facebook professionnel basé uniquement sur les données fournies. N'invente rien.

Format EXACT :
${transaction} – ${typeBien} à 𝗩𝗜𝗟𝗟𝗘 🏡
${virtualVisit ? `\nVISITE VIRTUELLE 🎥 : ${virtualVisit}\n` : ''}
[Description 2-3 lignes accrocheuses]

𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 🏠 :
- [liste des pièces]

𝗔𝘁𝗼𝘂𝘁𝘀 ✨ :
– [garage, jardin, cave, etc. si disponibles]

𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 ⚙️ :
– PEB : [classe et valeur]
– [chauffage]

💰 Prix : ${prixLabel}
(sous réserve d'acceptation des propriétaires)

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 👇
📧 info@trevirasquain.be
📞 085 25 39 03
🔗 ${url}`,
          messages: [{ role: 'user', content: `Ville : ${ville}\nContenu de l'annonce :\n${text}` }]
        })
      });

      const aiData = await aiRes.json();
      if (aiData?.error) throw new Error(aiData.error.type + ': ' + aiData.error.message);
      postTexte = aiData?.content?.[0]?.text?.trim() || null;
      if (!postTexte) throw new Error('Réponse Claude vide');

    } catch(e) {
      genErr = e.message;
    }
  }

  try {
    // ── TITRE ────────────────────────────────────────────────────────────────
    const titrePack = pack === 'Pack du pauvre' ? 'Post FB' : 'Post FB ⭐';
    const itemName = `${titrePack} – ${typeBien} – ${ville}`;

    // ── COLONNES ─────────────────────────────────────────────────────────────
    const delegueId = DELEGUE_MAP[delegue];
    const colVals = {
      dropdown_mkv6q0jr: { ids: [1] },
      dropdown_mkxvvrvk: { ids: [1] },
      project_status:    { label: 'A faire' },
      project_owner:     { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (delegueId !== null && delegueId !== undefined)
      colVals.dropdown_mkxvwsdj = { ids: [delegueId] };
    if (agenceIndex !== null)
      colVals.color_mkv6tmwp = { index: agenceIndex };

    // ── CRÉER L'ITEM ─────────────────────────────────────────────────────────
    const createData = await mondayQ(`mutation {
      create_item(
        board_id: ${BOARD_ID},
        group_id: "${GROUP_ID}",
        item_name: ${JSON.stringify(itemName)},
        column_values: ${JSON.stringify(JSON.stringify(colVals))}
      ) { id }
    }`);
    const itemId = createData?.data?.create_item?.id;
    if (!itemId) throw new Error('create_item: ' + JSON.stringify(createData?.errors || createData));

    // ── UPDATE ───────────────────────────────────────────────────────────────
    const debugInfo = html
      ? `Scrape: ${scrapeMethod} (${html.length} chars)${genErr ? ' | Erreur Claude: ' + genErr : ''}`
      : `Scrape échoué sur les 3 méthodes (direct, corsproxy, allorigins)`;

    const updateBody = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      '<p>─────────────────────────</p>',
      postTexte
        ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
        : `<p><em>⚠️ Texte non généré — ${debugInfo}</em></p>`
    ].filter(Boolean).join('');

    await mondayQ(`mutation {
      create_update(item_id: ${itemId}, body: ${JSON.stringify(updateBody)}) { id }
    }`);

    return res.status(200).json({
      success: true, itemId, itemName,
      textGenerated: !!postTexte,
      agence: agenceIndex === 2 ? 'HUY' : agenceIndex === 1 ? 'LIÈGE' : null
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
