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

  // Agence : index Monday (color_mkv6tmwp) — plus fiable que le label
  // index 2 = HUY, index 1 = LIÈGE (d'après get_board_info)
  const MOTS_HUY   = ['huy', 'amay', 'wanze', 'ben-ahin', 'tihange', 'engis', 'andenne'];
  const MOTS_LIEGE = ['liege', 'seraing', 'ans-', 'ans/', 'grace', 'hollogne', 'flemalle', 'herstal', 'saint-nicolas', 'ougree', 'grivegnee', 'chenee', 'wandre', 'jupille'];

  function capitalise(s) {
    return String(s || '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  }

  try {
    // ── 1. SCRAPE DIRECT (Vercel → trevi.be) ────────────────────────────────
    let postTexte = null, villeDetectee = null, adresse = null, typeBien = null;
    let scrapeError = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      const pageRes = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-BE,fr;q=0.9',
        }
      });
      clearTimeout(timeout);

      const html = await pageRes.text();
      console.log('[monday-post] scrape OK, html length:', html.length);

      if (html.length < 500) throw new Error('Page trop courte — probablement bloquée');

      const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
      const virtualVisit = matterport ? matterport[0] : null;

      const prixAPartir = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
      const prixAuPrix  = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*€/i);
      const prixSeul    = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
      let prixDetecte = null, prixType = null;
      if (prixAPartir)     { prixDetecte = prixAPartir[1].trim().replace(/\s/g,''); prixType = 'a_partir_de'; }
      else if (prixAuPrix) { prixDetecte = prixAuPrix[1].trim().replace(/\s/g,'');  prixType = 'au_prix_de'; }
      else if (prixSeul)   { prixDetecte = prixSeul[1].trim().replace(/\s/g,'');    prixType = 'prix_fixe'; }

      const prixLabel =
        prixType === 'a_partir_de' ? `à partir de ${prixDetecte} €` :
        prixType === 'au_prix_de'  ? `au prix de ${prixDetecte} €` :
        prixDetecte ? `${prixDetecte} €` : '[prix non détecté]';

      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 10000);

      // ── 2. CLAUDE ───────────────────────────────────────────────────────────
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

1. Un post Facebook professionnel basé uniquement sur les données fournies. N'invente rien.
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
2. JSON uniquement (rien d'autre après, pas de markdown) :
{"ville":"[commune]","adresse_complete":"[adresse complète visible, ex: Rue de la Paix 12, 4000 Liège — sinon null]","type_bien":"[Maison/Appartement/Villa/Terrain/etc]","surface":"[m² ou null]","nb_chambres":"[nb ou null]"}`,
          messages: [{ role: 'user', content: `URL : ${url}\nContenu :\n${text}` }]
        })
      });

      const aiData = await aiRes.json();
      console.log('[monday-post] Claude status:', aiRes.status, 'type:', aiData?.type);
      const full = aiData?.content?.[0]?.text || '';
      const parts = full.split('---JSON---');
      postTexte = parts[0]?.trim() || null;

      try {
        const jsonRaw = parts[1]?.trim().replace(/^```json?\s*/,'').replace(/```$/,'') || '{}';
        const parsed = JSON.parse(jsonRaw);
        villeDetectee = parsed.ville || null;
        adresse = parsed.adresse_complete && parsed.adresse_complete !== 'null' ? parsed.adresse_complete : null;
        typeBien = parsed.type_bien || null;
      } catch (jsonErr) {
        console.warn('[monday-post] JSON parse error:', jsonErr.message);
      }

      console.log('[monday-post] ville:', villeDetectee, '| adresse:', adresse, '| type:', typeBien);
      console.log('[monday-post] postTexte length:', postTexte?.length || 0);

    } catch (scrapeErr) {
      scrapeError = scrapeErr.message;
      console.error('[monday-post] Scrape/Claude error:', scrapeErr.message);
    }

    // ── 3. TITRE ──────────────────────────────────────────────────────────────
    const titreAdresse = adresse || villeDetectee || url.split('/').filter(Boolean).pop()?.replace(/-/g,' ') || 'Bien';
    const titrePack = pack === 'Pack du pauvre' ? 'Post FB' : 'Post FB ⭐';
    const titreType = typeBien ? `${capitalise(typeBien)} – ` : '';
    const itemName = `${titrePack} – ${titreType}${capitalise(titreAdresse)}`;

    // ── 4. AGENCE (par index, plus fiable que le label) ───────────────────────
    const searchText = `${url} ${villeDetectee || ''} ${adresse || ''}`.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // supprimer accents pour la recherche
    let agenceIndex = null;
    if (MOTS_HUY.some(k => searchText.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) {
      agenceIndex = 2; // HUY
    } else if (MOTS_LIEGE.some(k => searchText.includes(k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))) {
      agenceIndex = 1; // LIÈGE
    }

    // ── 5. COLONNES ───────────────────────────────────────────────────────────
    const delegueId = DELEGUE_MAP[delegue];
    const columnValues = {
      dropdown_mkv6q0jr: { ids: [1] },
      dropdown_mkxvvrvk: { ids: [1] },
      project_status:    { label: 'A faire' },
      project_owner:     { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (delegueId) columnValues.dropdown_mkxvwsdj = { ids: [delegueId] };
    if (agenceIndex !== null) columnValues.color_mkv6tmwp = { index: agenceIndex };

    console.log('[monday-post] columnValues:', JSON.stringify(columnValues));

    // ── 6. CRÉER L'ITEM ───────────────────────────────────────────────────────
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
    console.log('[monday-post] create_item response:', JSON.stringify(mondayData));
    const itemId = mondayData?.data?.create_item?.id;
    if (!itemId) throw new Error('Monday create_item: ' + JSON.stringify(mondayData?.errors || mondayData));

    // ── 7. UPDATE AVEC LE TEXTE ───────────────────────────────────────────────
    const updateBody = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 Lien : <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      '<p>─────────────────────────</p>',
      postTexte
        ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
        : `<p><em>⚠️ Texte non généré${scrapeError ? ` (erreur: ${scrapeError})` : ''} — à rédiger manuellement.</em></p>`
    ].filter(Boolean).join('');

    await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN, 'API-Version': '2024-01' },
      body: JSON.stringify({ query: `mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(updateBody)}) { id } }` })
    });

    return res.status(200).json({ success: true, itemId, itemName, textGenerated: !!postTexte, scrapeError });

  } catch (err) {
    console.error('[monday-post] Fatal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
