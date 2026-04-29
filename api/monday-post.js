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

  const MOTS_HUY   = ['huy', 'amay', 'wanze', 'ben-ahin', 'tihange', 'engis'];
  const MOTS_LIEGE = ['liege', 'seraing', 'grace', 'hollogne', 'flemalle', 'herstal', 'saint-nicolas', 'ougree', 'jupille', 'grivegnee'];

  function cap(s) {
    return String(s||'').split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
  }

  async function mondayQuery(query) {
    const r = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN, 'API-Version': '2024-01' },
      body: JSON.stringify({ query })
    });
    return r.json();
  }

  try {
    // ── ÉTAPE 1 : CRÉER L'ITEM MONDAY IMMÉDIATEMENT ──────────────────────────
    // On crée l'item tout de suite pour ne pas bloquer si le scrape est long

    // Titre provisoire depuis l'URL
    const urlSlug = url.split('/').filter(Boolean).pop()?.replace(/-/g,' ') || 'Bien';
    const titreProv = `Post FB – ${cap(urlSlug)}`;

    const delegueId = DELEGUE_MAP[delegue];
    const searchNorm = url.toLowerCase().replace(/[éèêë]/g,'e').replace(/[àâ]/g,'a').replace(/[îï]/g,'i').replace(/[ôö]/g,'o').replace(/[ùûü]/g,'u');
    let agenceIndex = null;
    if (MOTS_HUY.some(k => searchNorm.includes(k)))   agenceIndex = 2;
    else if (MOTS_LIEGE.some(k => searchNorm.includes(k))) agenceIndex = 1;

    const colVals = {
      dropdown_mkv6q0jr: { ids: [1] },
      dropdown_mkxvvrvk: { ids: [1] },
      project_status:    { label: 'A faire' },
      project_owner:     { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (delegueId) colVals.dropdown_mkxvwsdj = { ids: [delegueId] };
    if (agenceIndex !== null) colVals.color_mkv6tmwp = { index: agenceIndex };

    const createData = await mondayQuery(`mutation {
      create_item(
        board_id: ${BOARD_ID},
        group_id: "${GROUP_ID}",
        item_name: ${JSON.stringify(titreProv)},
        column_values: ${JSON.stringify(JSON.stringify(colVals))}
      ) { id }
    }`);

    const itemId = createData?.data?.create_item?.id;
    if (!itemId) throw new Error('create_item failed: ' + JSON.stringify(createData?.errors || createData));

    // Répondre au front TOUT DE SUITE (avant le scrape lent)
    res.status(200).json({ success: true, itemId, itemName: titreProv });

    // ── ÉTAPE 2 : SCRAPE + CLAUDE EN ARRIÈRE-PLAN ────────────────────────────
    let postTexte = null, villeDetectee = null, adresse = null, typeBien = null;
    let debugLog = [];

    try {
      debugLog.push('Scrape start: ' + url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      const pageRes = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      clearTimeout(timer);
      const html = await pageRes.text();
      debugLog.push('HTML length: ' + html.length);

      const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
      const virtualVisit = matterport ? matterport[0] : null;

      const prixAP = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
      const prixAU = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*€/i);
      const prixSe = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
      let prixDetecte = null, prixType = null;
      if (prixAP)      { prixDetecte = prixAP[1].trim().replace(/\s/g,''); prixType = 'a_partir_de'; }
      else if (prixAU) { prixDetecte = prixAU[1].trim().replace(/\s/g,''); prixType = 'au_prix_de'; }
      else if (prixSe) { prixDetecte = prixSe[1].trim().replace(/\s/g,''); prixType = 'prix_fixe'; }
      const prixLabel = prixType==='a_partir_de' ? `à partir de ${prixDetecte} €` : prixType==='au_prix_de' ? `au prix de ${prixDetecte} €` : prixDetecte ? `${prixDetecte} €` : '[prix non détecté]';
      debugLog.push('Prix: ' + prixLabel);

      const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,10000);
      debugLog.push('Text length: ' + text.length);

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2500,
          system: `Tu es expert en communication immobilière pour TREVI Rasquain.
Génère DEUX choses séparées par ---JSON--- :

1. Post Facebook professionnel uniquement avec les données fournies.
Format :
A VENDRE – [Type] à 𝗩𝗜𝗟𝗟𝗘 🏡
${virtualVisit ? `\nVISITE VIRTUELLE DISPONIBLE 🎥 : ${virtualVisit}\n` : ''}
[Description 2-3 lignes]

𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 🏠 :
- [pièces]

𝗔𝘁𝗼𝘂𝘁𝘀 ✨ :
– [atouts]

𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 ⚙️ :
– PEB : [valeur]
– [chauffage]

💰 Prix : ${prixLabel}
(sous réserve d'acceptation des propriétaires)

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 👇
📧 info@trevirasquain.be
📞 085 25 39 03
🔗 ${url}

---JSON---
2. JSON uniquement sans markdown :
{"ville":"[commune]","adresse_complete":"[adresse complète ou null]","type_bien":"[Maison/Appartement/etc]"}`,
          messages: [{ role: 'user', content: `URL: ${url}\n${text}` }]
        })
      });

      const aiData = await aiRes.json();
      debugLog.push('Claude status: ' + aiRes.status + ' type: ' + aiData?.type);
      const full = aiData?.content?.[0]?.text || '';
      debugLog.push('Claude response length: ' + full.length);

      const parts = full.split('---JSON---');
      postTexte = parts[0]?.trim() || null;
      debugLog.push('PostTexte length: ' + (postTexte?.length || 0));

      try {
        const jsonRaw = (parts[1]||'').trim().replace(/^```json?\s*/,'').replace(/```$/,'');
        const parsed = JSON.parse(jsonRaw || '{}');
        villeDetectee = parsed.ville || null;
        adresse = parsed.adresse_complete && parsed.adresse_complete !== 'null' ? parsed.adresse_complete : null;
        typeBien = parsed.type_bien || null;
        debugLog.push('Ville: ' + villeDetectee + ' | Adresse: ' + adresse + ' | Type: ' + typeBien);
      } catch(je) {
        debugLog.push('JSON parse error: ' + je.message + ' | raw: ' + (parts[1]||'').substring(0,100));
      }

    } catch(scrapeErr) {
      debugLog.push('ERROR: ' + scrapeErr.message);
    }

    // ── ÉTAPE 3 : RENOMMER L'ITEM + AGENCE SI ON A LES INFOS ─────────────────
    if (villeDetectee || adresse || typeBien) {
      const newAdresse = adresse || villeDetectee || urlSlug;
      const newType = typeBien ? `${cap(typeBien)} – ` : '';
      const newName = `Post FB – ${newType}${cap(newAdresse)}`;

      // Mise à jour agence si on peut mieux détecter
      const searchAll = `${url} ${villeDetectee||''} ${adresse||''}`.toLowerCase().replace(/[éèêë]/g,'e').replace(/[àâ]/g,'a').replace(/[îï]/g,'i').replace(/[ôö]/g,'o').replace(/[ùûü]/g,'u');
      let newAgenceIndex = agenceIndex;
      if (newAgenceIndex === null) {
        if (MOTS_HUY.some(k => searchAll.includes(k))) newAgenceIndex = 2;
        else if (MOTS_LIEGE.some(k => searchAll.includes(k))) newAgenceIndex = 1;
      }

      const updateCols = {};
      if (newAgenceIndex !== null && newAgenceIndex !== agenceIndex) updateCols.color_mkv6tmwp = { index: newAgenceIndex };

      try {
        await mondayQuery(`mutation { change_item_value(board_id: ${BOARD_ID}, item_id: ${itemId}, column_id: "name", value: ${JSON.stringify(JSON.stringify(newName))}) { id } }`);
        if (Object.keys(updateCols).length > 0) {
          await mondayQuery(`mutation { change_multiple_column_values(board_id: ${BOARD_ID}, item_id: ${itemId}, column_values: ${JSON.stringify(JSON.stringify(updateCols))}) { id } }`);
        }
      } catch(renameErr) {
        debugLog.push('Rename error: ' + renameErr.message);
      }
    }

    // ── ÉTAPE 4 : UPDATE AVEC TEXTE + DEBUG ──────────────────────────────────
    const updateBody = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      '<p>─────────────────────────</p>',
      postTexte
        ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
        : `<p><em>⚠️ Texte non généré — voir debug ci-dessous.</em></p>`,
      '<p><small>' + debugLog.join(' | ') + '</small></p>'
    ].filter(Boolean).join('');

    await mondayQuery(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(updateBody)}) { id } }`);

  } catch (err) {
    // L'item n'a pas pu être créé → renvoyer l'erreur (mais res déjà envoyé potentiellement)
    console.error('[monday-post] Fatal:', err.message);
  }
}

export const config = { api: { bodyParser: true } };
