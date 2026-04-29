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

  // Communes autour de HUY (agence index=2)
  const HUY_VILLES = [
    'huy','amay','wanze','andenne','ben-ahin','tihange','engis',
    'villers-le-bouillet','burdinne','braives','hannut','wasseiges',
    'tinlot','modave','marchin','clavier','nandrin','verlaine',
    'oreye','remicourt','berloz','crisnee','bassenge','oupeye',
    'waremme','borgworm','lincent','geer','donceel','faimes','graces'
  ];
  // Communes autour de LIÈGE (agence index=1)
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

  try {
    // ── EXTRACTION DEPUIS L'URL ───────────────────────────────────────────────
    // Format trevi.be: /fr/bien/[ref]/[type-transaction]/[ville]/[id]
    const urlParts = url.replace(/\/$/, '').split('/');
    const villeSlug = urlParts[urlParts.length - 2] || '';
    const typeSlug  = urlParts[urlParts.length - 3] || '';
    const ville     = cap(villeSlug);
    const typeBien  = cap(typeSlug.split('-')[0]);
    const transaction = typeSlug.includes('louer') ? 'À LOUER' : 'À VENDRE';

    // Agence depuis l'URL (sans scrape, toujours fiable)
    let agenceIndex = null;
    if (HUY_VILLES.some(v => villeSlug === v || villeSlug.startsWith(v + '-')))
      agenceIndex = 2; // HUY
    else if (LIEGE_VILLES.some(v => villeSlug === v || villeSlug.startsWith(v + '-')))
      agenceIndex = 1; // LIÈGE

    // ── SCRAPE VIA ALLORIGINS ─────────────────────────────────────────────────
    let postTexte = null;
    let scrapeErr = null;

    try {
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const proxyRes = await fetch(proxyUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(25000)
      });
      const proxyData = await proxyRes.json();
      const html = proxyData?.contents || '';

      if (html.length < 200) throw new Error(`allorigins retourné ${html.length} chars`);

      // Prix
      const prixAP = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
      const prixAU = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*€/i);
      const prixSe = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
      let prixDetecte = null, prixType = null;
      if (prixAP)      { prixDetecte = prixAP[1].trim().replace(/\s/g,''); prixType = 'a_partir_de'; }
      else if (prixAU) { prixDetecte = prixAU[1].trim().replace(/\s/g,''); prixType = 'au_prix_de'; }
      else if (prixSe) { prixDetecte = prixSe[1].trim().replace(/\s/g,''); prixType = 'prix_fixe'; }
      const prixLabel =
        prixType==='a_partir_de' ? `à partir de ${prixDetecte} €` :
        prixType==='au_prix_de'  ? `au prix de ${prixDetecte} €` :
        prixDetecte ? `${prixDetecte} €` : '[prix non détecté]';

      // Matterport
      const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
      const virtualVisit = matterport ? matterport[0] : null;

      // Texte nettoyé
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 10000);

      // Claude
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
– [garage, jardin, cave, etc.]

𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 ⚙️ :
– PEB : [classe et valeur]
– [chauffage]

💰 Prix : ${prixLabel}
(sous réserve d'acceptation des propriétaires)

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 👇
📧 info@trevirasquain.be
📞 085 25 39 03
🔗 ${url}`,
          messages: [{ role: 'user', content: `Ville : ${ville}\nContenu :\n${text}` }]
        })
      });
      const aiData = await aiRes.json();
      postTexte = aiData?.content?.[0]?.text?.trim() || null;
      if (!postTexte) throw new Error('Claude réponse vide — type: ' + aiData?.type + ' error: ' + JSON.stringify(aiData?.error));

    } catch(e) {
      scrapeErr = e.message;
    }

    // ── TITRE ─────────────────────────────────────────────────────────────────
    const titrePack = pack === 'Pack du pauvre' ? 'Post FB' : 'Post FB ⭐';
    const itemName = `${titrePack} – ${typeBien} – ${ville}`;

    // ── COLONNES ──────────────────────────────────────────────────────────────
    const delegueId = DELEGUE_MAP[delegue];
    const colVals = {
      dropdown_mkv6q0jr: { ids: [1] },
      dropdown_mkxvvrvk: { ids: [1] },
      project_status:    { label: 'A faire' },
      project_owner:     { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (delegueId !== undefined && delegueId !== null)
      colVals.dropdown_mkxvwsdj = { ids: [delegueId] };
    if (agenceIndex !== null)
      colVals.color_mkv6tmwp = { index: agenceIndex };

    // ── CRÉER L'ITEM ──────────────────────────────────────────────────────────
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

    // ── UPDATE AVEC TEXTE ─────────────────────────────────────────────────────
    const updateBody = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      '<p>─────────────────────────</p>',
      postTexte
        ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
        : `<p><em>⚠️ Texte non généré (${scrapeErr || 'erreur inconnue'}).</em></p>`
    ].filter(Boolean).join('');

    await mondayQ(`mutation {
      create_update(item_id: ${itemId}, body: ${JSON.stringify(updateBody)}) { id }
    }`);

    // ── RÉPONSE AU FRONT (APRÈS tout le travail) ──────────────────────────────
    return res.status(200).json({
      success: true,
      itemId,
      itemName,
      textGenerated: !!postTexte,
      agence: agenceIndex === 2 ? 'HUY' : agenceIndex === 1 ? 'LIÈGE' : null,
      scrapeErr
    });

  } catch (err) {
    console.error('[monday-post]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
