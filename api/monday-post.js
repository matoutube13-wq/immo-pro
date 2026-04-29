export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { delegue, url, pack, remarques } = req.body;
  if (!delegue || !url) return res.status(400).json({ error: 'Champs manquants' });

  const MONDAY_TOKEN = process.env.MONDAY_API_TOKEN;
  const BOARD_ID = '2115483966';

  // Map délégué → ID dropdown Monday
  const DELEGUE_MAP = {
    'Quentin Delloye':    1,
    'Benoît Rasquain':    2,
    'Caroline Gustin':    5,
    'Sarah Khounchi':     6,
    'Romain Marchandisse':7,
    'Venceslas Viseur':   8,
    'Mathias Infantolino':9,
    'Marie Tilman':       10,
    'Tim Fagot':          11,
    'Charlotte Dispa':    12,
    'Thibault Bourgeois': 13,
    'Thibaut Gustin':     14,
    'Joëlle De Lattin':   15,
    'Axel Bourgeois':     16
  };

  try {
    // ── 1. SCRAPE via allorigins ─────────────────────────────────────────────
    const proxyRes = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url));
    const proxyData = await proxyRes.json();
    const html = proxyData.contents || '';

    if (!html || html.length < 200) {
      throw new Error('Impossible de lire la page — vérifiez le lien');
    }

    const matterport  = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;
    const isLocation  = /louer|location/i.test(html);
    const prixAPartir = html.match(/partir\s+de\s+([\d\s.,]+)\s*€/i);
    const loyerM      = html.match(/([\d]{3,4})\s*€\s*\/\s*mois/i);
    const prixSeul    = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
    const viager      = /viager/i.test(html);

    let prixType = null, prixVal = '';
    if (prixAPartir)  { prixVal = prixAPartir[1].trim().replace(/\s/g,''); prixType = 'a_partir_de'; }
    else if (loyerM)  { prixVal = loyerM[1].trim(); prixType = 'loyer'; }
    else if (prixSeul){ prixVal = prixSeul[1].trim().replace(/\s/g,''); prixType = 'prix'; }

    const prixLabel = prixType === 'a_partir_de' ? `à partir de ${prixVal} €` :
                      prixType === 'loyer'        ? `${prixVal} €/mois` :
                      prixVal ? `${prixVal} €` : 'prix non détecté';

    // Extraire ville depuis URL
    const urlParts = url.split('/').filter(Boolean);
    const villeRaw = urlParts[urlParts.length - 1]?.replace(/-/g, ' ') || 'Bien';
    const ville = villeRaw.charAt(0).toUpperCase() + villeRaw.slice(1);

    const texte = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim().substring(0, 9000);

    // ── 2. GÉNÉRATION CLAUDE ─────────────────────────────────────────────────
    const typePost = isLocation ? '𝗔 𝗟𝗢𝗨𝗘𝗥' : '𝗔 𝗩𝗘𝗡𝗗𝗥𝗘';
    const prixSection = prixType === 'a_partir_de'
      ? "💰 Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)"
      : prixType === 'loyer' ? "💰 Loyer : 𝗫.𝗫𝗫𝗫 €/mois"
      : viager ? "💰 𝗩𝗶𝗮𝗴𝗲𝗿 𝗼𝗰𝗰𝘂𝗽𝗲́ – Bouquet : X € / Rente : X €/mois"
      : "💰 Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)";

    const systemPrompt = `Tu es expert en communication immobilière pour TREVI Rasquain en Belgique.
Génère un post Facebook qui suit EXACTEMENT ce format (caractères Unicode gras obligatoires) :

🏡 ${typePost} – [Type de bien] à [VILLE EN GRAS UNICODE] 📌
${virtualVisit ? `🎥 VISITE VIRTUELLE DISPONIBLE : ${virtualVisit}` : ''}
[1-2 phrases d'accroche percutantes]

✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :
[Si niveaux détaillés disponibles :]
✔️ 𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 : [SI APPLICABLE] – [éléments]
✔️ 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 : – [éléments]
✔️ 𝗘́𝘁𝗮𝗴𝗲 : [SI APPLICABLE] – [éléments]
✔️ 𝟮𝗲 𝗲́𝘁𝗮𝗴𝗲 : [SI APPLICABLE] – [éléments]
[Sinon :]
✨ 𝗖𝗮𝗿𝗮𝗰𝘁𝗲́𝗿𝗶𝘀𝘁𝗶𝗾𝘂𝗲𝘀 𝗽𝗿𝗶𝗻𝗰𝗶𝗽𝗮𝗹𝗲𝘀 :
– [éléments]

🌿 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 : [UNIQUEMENT si jardin/terrasse/garage disponible]
– [éléments]

⚡️ 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :
– PEB : [valeur]
– Chauffage : [type]
– Châssis : [type]

${prixSection}
[Remplace X par le vrai prix détecté : ${prixLabel}]

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 🔑
✉️ info@trevirasquain.be
📞 085 25 39 03

${url}

RÈGLES STRICTES : Utilise UNIQUEMENT les infos présentes. N'invente rien. Garde les caractères Unicode gras. Omets les sections sans info.`;

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
        system: systemPrompt,
        messages: [{ role: 'user', content: `URL : ${url}\n\nContenu de la page :\n${texte}` }]
      })
    });

    const aiData = await aiRes.json();
    const postTexte = aiData?.content?.[0]?.text?.trim() || '';

    // ── 3. CRÉER LA TÂCHE MONDAY ─────────────────────────────────────────────
    const delegueId = DELEGUE_MAP[delegue];
    const itemName  = `${pack} – ${ville}`;

    const columnValues = {
      ...(delegueId ? { dropdown_mkxvwsdj: { ids: [delegueId] } } : {}),
      dropdown_mkv6q0jr: { ids: [1] },       // Post classique
      dropdown_mkxvvrvk: { ids: [1] },       // Facebook
      project_status:    { label: 'A faire' }
    };

    const mutation = `
      mutation {
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
    const itemId = mondayData?.data?.create_item?.id;

    if (!itemId) {
      console.error('Monday error:', JSON.stringify(mondayData));
      throw new Error('Impossible de créer la tâche Monday');
    }

    // ── 4. AJOUTER L'UPDATE (texte du post dans la conversation) ─────────────
    const updateLines = [
      `📋 **Demande de ${delegue}**`,
      `📦 Pack : ${pack}`,
      `🔗 Lien : ${url}`,
      remarques ? `💬 Remarques : ${remarques}` : null,
      '',
      '---',
      '✍️ **TEXTE DU POST — PRÊT À PUBLIER**',
      '',
      postTexte || '_(génération échouée — relancer manuellement)_'
    ].filter(l => l !== null).join('\n');

    const updateMutation = `
      mutation {
        create_update(
          item_id: ${itemId},
          body: ${JSON.stringify(updateLines)}
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

    return res.status(200).json({ success: true, itemId, itemName, postTexte });

  } catch (err) {
    console.error('monday-post error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
