// API simplifiée : reçoit les données déjà scrapées et le texte déjà généré
// Le scrape et la génération Claude se font côté navigateur

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { delegue, url, pack, remarques, postTexte, ville } = req.body;
  if (!delegue || !url || !pack) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN;
  const BOARD_ID = '2115483966';

  const DELEGUE_MAP = {
    'Quentin Delloye':     1,
    'Benoît Rasquain':     2,
    'Caroline Gustin':     5,
    'Sarah Khounchi':      6,
    'Romain Marchandisse': 7,
    'Venceslas Viseur':    8,
    'Mathias Infantolino': 9,
    'Marie Tilman':        10,
    'Tim Fagot':           11,
    'Charlotte Dispa':     12,
    'Thibault Bourgeois':  13,
    'Thibaut Gustin':      14,
    'Joëlle De Lattin':    15,
    'Axel Bourgeois':      16,
    'Julia Kongo':         null
  };

  try {
    const delegueId = DELEGUE_MAP[delegue];
    const villeFormatted = (ville || url.split('/').filter(Boolean).pop()?.replace(/-/g,' ') || 'Bien');
    const itemName = `${pack} – ${villeFormatted.charAt(0).toUpperCase() + villeFormatted.slice(1)}`;

    const columnValues = {
      dropdown_mkv6q0jr: { ids: [1] },
      dropdown_mkxvvrvk: { ids: [1] },
      project_status:    { label: 'A faire' }
    };
    if (delegueId) columnValues.dropdown_mkxvwsdj = { ids: [delegueId] };

    // Créer la tâche
    const mutation = `mutation {
      create_item(
        board_id: ${BOARD_ID},
        group_id: "group_mkxsjfgg",
        item_name: ${JSON.stringify(itemName)},
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) { id }
    }`;

    const mondayRes = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MONDAY_TOKEN,
        'API-Version': '2024-01'
      },
      body: JSON.stringify({ query: mutation })
    });

    const mondayData = await mondayRes.json();
    console.log('Monday response:', JSON.stringify(mondayData));

    const itemId = mondayData?.data?.create_item?.id;
    if (!itemId) throw new Error('Monday: ' + JSON.stringify(mondayData?.errors || mondayData));

    // Ajouter l'update avec le texte
    const updateBody = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 Lien : <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      postTexte ? `<p>---</p><p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>` : '<p><em>Texte non généré</em></p>'
    ].filter(Boolean).join('');

    const updateMutation = `mutation {
      create_update(
        item_id: ${itemId},
        body: ${JSON.stringify(updateBody)}
      ) { id }
    }`;

    await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': MONDAY_TOKEN,
        'API-Version': '2024-01'
      },
      body: JSON.stringify({ query: updateMutation })
    });

    return res.status(200).json({ success: true, itemId, itemName });

  } catch (err) {
    console.error('monday-post error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
