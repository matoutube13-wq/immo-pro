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
  const TREVI_USER_ID = '80840427'; // Compte "Trevi Rasquain" → Responsable Création

  const DELEGUE_MAP = {
    'Quentin Delloye': 1, 'Benoît Rasquain': 2, 'Caroline Gustin': 5,
    'Sarah Khounchi': 6, 'Romain Marchandisse': 7, 'Venceslas Viseur': 8,
    'Mathias Infantolino': 9, 'Marie Tilman': 10, 'Tim Fagot': 11,
    'Charlotte Dispa': 12, 'Thibault Bourgeois': 13, 'Thibaut Gustin': 14,
    'Joëlle De Lattin': 15, 'Axel Bourgeois': 16, 'Julia Kongo': null
  };

  // Mots-clés pour détection agence (colonne color_mkv6tmwp)
  const MOTS_HUY   = ['huy', 'amay', 'ben-ahin', 'benahin', 'tihange', 'andenne', 'wanze', 'gives', 'engis'];
  const MOTS_LIEGE = ['liège', 'liege', 'seraing', 'ans ', 'grâce', 'grace-hollogne', 'hollogne', 'flémalle', 'flemalle', 'herstal', 'saint-nicolas', 'ougrée', 'ougree', 'grivegnee', 'grivegnée', 'chênée', 'chenee', 'wandre'];

  try {
    // ── 1. SCRAPE + GÉNÉRATION CLAUDE ────────────────────────────────────────
    let postTexte = null, villeDetectee = null, adresse = null, typeBien = null;

    try {
      const pageRes = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const html = await pageRes.text();

      const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
      const virtualVisit = matterport ? matterport[0] : null;

      const prixAPartir = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
      const prixAuPrix  = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*€/i);
      const prixSeul    = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
      let prixDetecte = null, prixType = null;
      if (prixAPartir)    { prixDetecte = prixAPartir[1].trim().replace(/\s/g,''); prixType = 'a_partir_de'; }
      else if (prixAuPrix){ prixDetecte = prixAuPrix[1].trim().replace(/\s/g,''); prixType = 'au_prix_de'; }
      else if (prixSeul)  { prixDetecte = prixSeul[1].trim().replace(/\s/g,'');   prixType = 'prix_fixe'; }

      const prixLabel =
        prixType === 'a_partir_de' ? `à partir de ${prixDetecte} €` :
        prixType === 'au_prix_de'  ? `au prix de ${prixDetecte} €` :
        prixDetecte ? `${prixDetecte} €` : '[prix non détecté]';

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
          max_tokens: 2500,
          system: `Tu es expert en communication immobilière pour TREVI Rasquain.
Génère DEUX choses séparées par ---JSON--- :

1. Un post Facebook professionnel basé uniquement sur les données fournies.
Format EXACT :
A VENDRE – [Type de bien] à 𝗩𝗜𝗟𝗟𝗘 🏡
${virtualVisit ? `\nVISITE VIRTUELLE DISPONIBLE 🎥 : ${virtualVisit}\n` : ''}
[Description 2-3 lignes]

𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 🏠 :
- [pièces]

𝗔𝘁𝗼𝘂𝘁𝘀 𝘀𝘂𝗽𝗽𝗹𝗲́𝗺𝗲𝗻𝘁𝗮𝗶𝗿𝗲𝘀 ✨ :
– [garage, jardin, etc.]

𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 ⚙️ :
– PEB : [valeur]
– [chauffage]

💰 Prix : ${prixLabel}
(sous réserve d'acceptation des propriétaires)

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 👇
📧 info@trevirasquain.be
📞 085 25 39 03
🔗 ${url}

---JSON---
2. JSON uniquement (rien d'autre) :
{"ville":"[commune]","adresse_complete":"[adresse complète visible ou null]","type_bien":"[Maison/Appartement/etc]","surface":"[m² ou null]","nb_chambres":"[nb ou null]"}`,
          messages: [{ role: 'user', content: `URL : ${url}\nContenu :\n${text}` }]
        })
      });

      const aiData = await aiRes.json();
      const full = aiData?.content?.[0]?.text || '';
      const parts = full.split('---JSON---');
      postTexte = parts[0]?.trim() || null;
      try {
        const parsed = JSON.parse(parts[1]?.trim() || '{}');
        villeDetectee = parsed.ville || null;
        adresse = parsed.adresse_complete || null;
        typeBien = parsed.type_bien || null;
      } catch { /* ignore */ }

    } catch (scrapeErr) {
      console.warn('Scrape/Claude error:', scrapeErr.message);
    }

    // ── 2. TITRE DE L'ITEM ────────────────────────────────────────────────────
    function capitalise(s) {
      return String(s).split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    const titreAdresse = adresse || villeDetectee || url.split('/').filter(Boolean).pop()?.replace(/-/g,' ') || 'Bien';
    const titrePack = pack === 'Pack du pauvre' ? 'Post FB' : 'Post FB ⭐';
    const titreType = typeBien ? `${capitalise(typeBien)} – ` : '';
    const itemName = `${titrePack} – ${titreType}${capitalise(titreAdresse)}`;

    // ── 3. DÉTECTION AGENCE ───────────────────────────────────────────────────
    const searchText = `${url} ${villeDetectee || ''} ${adresse || ''}`.toLowerCase();
    let agenceLabel = null;
    if (MOTS_HUY.some(k => searchText.includes(k))) agenceLabel = 'HUY';
    else if (MOTS_LIEGE.some(k => searchText.includes(k))) agenceLabel = 'LIÈGE';

    // ── 4. COLONNES MONDAY ────────────────────────────────────────────────────
    const delegueId = DELEGUE_MAP[delegue];
    const columnValues = {
      dropdown_mkv6q0jr: { ids: [1] },          // Post classique
      dropdown_mkxvvrvk: { ids: [1] },          // Canal Fb
      project_status:    { label: 'A faire' },
      project_owner:     { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (delegueId) columnValues.dropdown_mkxvwsdj = { ids: [delegueId] };
    if (agenceLabel) columnValues.color_mkv6tmwp = { label: agenceLabel };

    // ── 5. CRÉER L'ITEM ───────────────────────────────────────────────────────
    const mondayRes = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN, 'API-Version': '2024-01' },
      body: JSON.stringify({ query: `mutation {
        create_item(
          board_id: ${BOARD_ID},
          group_id: "${GROUP_ID}",
          item_name: ${JSON.stringify(itemName)},
          column_values: ${JSON.stringify(JSON.stringify(columnValues))}
        ) { id }
      }` })
    });
    const mondayData = await mondayRes.json();
    const itemId = mondayData?.data?.create_item?.id;
    if (!itemId) throw new Error('Monday: ' + JSON.stringify(mondayData?.errors || mondayData));

    // ── 6. UPDATE AVEC LE TEXTE ───────────────────────────────────────────────
    const updateBody = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 Lien : <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      '<p>─────────────────────────</p>',
      postTexte
        ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
        : `<p><em>⚠️ Texte non généré — à rédiger manuellement.</em></p>`
    ].filter(Boolean).join('');

    await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN, 'API-Version': '2024-01' },
      body: JSON.stringify({ query: `mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(updateBody)}) { id } }` })
    });

    return res.status(200).json({ success: true, itemId, itemName });

  } catch (err) {
    console.error('monday-post error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
