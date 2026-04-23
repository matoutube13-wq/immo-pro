export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { delegue, url, pack, remarques, date } = req.body;
  if (!delegue || !url || !pack) return res.status(400).json({ error: 'Champs manquants' });

  const now = date || new Date().toLocaleString('fr-BE', {
    timeZone: 'Europe/Brussels',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  // ── 1. SCRAPE DE LA PAGE ────────────────────────────────────────────────────
  let postTexte = '';
  try {
    const pageRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await pageRes.text();

    const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;

    const prixAPartirMatch = html.match(/à\s+partir\s+de\s+([\d\s.,]+)\s*€/i);
    const loyerMatch       = html.match(/([\d]{3,4})\s*€\s*\/\s*mois/i);
    const prixSeulMatch    = html.match(/([\d]{2,3}[\s.][\d]{3})\s*€/);
    const viagerMatch      = html.match(/viager/i);
    const isLocation       = html.match(/\blouer\b|\blocation\b|\bloué\b/i);

    let prixType = null, prixDetecte = null;
    if (prixAPartirMatch)  { prixDetecte = prixAPartirMatch[1].trim().replace(/\s/g,''); prixType = 'a_partir_de'; }
    else if (loyerMatch)   { prixDetecte = loyerMatch[1].trim(); prixType = 'loyer'; }
    else if (prixSeulMatch){ prixDetecte = prixSeulMatch[1].trim().replace(/\s/g,''); prixType = 'prix_fixe'; }

    const prixLabel =
      prixType === 'a_partir_de' ? `à partir de ${prixDetecte} €` :
      prixType === 'loyer'       ? `${prixDetecte} €/mois` :
      prixDetecte ? `${prixDetecte} €` : '[prix non détecté]';

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ').trim().substring(0, 10000);

    // ── 2. GÉNÉRATION CLAUDE ──────────────────────────────────────────────────
    const systemPrompt = `Tu es expert en communication immobilière pour TREVI Rasquain en Belgique.
Génère un post Facebook qui suit EXACTEMENT ce format (caractères Unicode gras obligatoires) :

${isLocation ? '🏡 𝗔 𝗟𝗢𝗨𝗘𝗥 – [Type de bien] à 𝗩𝗜𝗟𝗟𝗘 📌' : '🏡 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [Type de bien] à 𝗩𝗜𝗟𝗟𝗘 📌'}
${virtualVisit ? `🎥 VISITE VIRTUELLE DISPONIBLE : ${virtualVisit}` : ''}
[1-2 phrases d'accroche courtes et percutantes]

✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :
[Si infos par niveau disponibles :]
✔️ 𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 : [SI APPLICABLE]
– [élément]
✔️ 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 :
– [élément]
✔️ 𝗘́𝘁𝗮𝗴𝗲 : [SI APPLICABLE]
– [élément]
[Sinon :]
✨ 𝗖𝗮𝗿𝗮𝗰𝘁𝗲́𝗿𝗶𝘀𝘁𝗶𝗾𝘂𝗲𝘀 𝗽𝗿𝗶𝗻𝗰𝗶𝗽𝗮𝗹𝗲𝘀 :
– [élément]

🌿 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 : [SI APPLICABLE uniquement]
– [élément]

⚡️ 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :
– PEB : [lettre] ([kWh/m²/an])
– Chauffage : [type]
– Châssis : [type]

${prixType === 'a_partir_de' ? `💰 Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)` :
  prixType === 'loyer' ? `💰 Loyer : 𝗫.𝗫𝗫𝗫 €/mois` :
  viagerMatch ? `💰 𝗩𝗶𝗮𝗴𝗲𝗿 𝗼𝗰𝗰𝘂𝗽𝗲́ – Bouquet : X € / Rente : X €/mois` :
  `💰 Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 €\n(sous réserve d'acceptation du propriétaire)`}
[Remplace X par le vrai prix : ${prixLabel}]

𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 🔑
✉️ info@trevirasquain.be
📞 085 25 39 03

${url}

RÈGLES : Utilise UNIQUEMENT les infos présentes. N'invente rien. Garde les caractères Unicode gras exactement. Omets les sections sans info.`;

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
        messages: [{ role: 'user', content: `URL : ${url}\n\nContenu :\n${text}` }]
      })
    });

    const aiData = await aiRes.json();
    postTexte = aiData?.content?.[0]?.text?.trim() || '';

  } catch (scrapeErr) {
    console.error('Scrape/Claude error:', scrapeErr.message);
  }

  // ── 3. CONSTRUIRE LE MAIL ───────────────────────────────────────────────────
  const lines = [
    '📋 NOUVELLE DEMANDE DE POST FACEBOOK',
    '─────────────────────────────────────',
    '',
    '👤 Délégué    : ' + delegue,
    '📦 Pack       : ' + pack,
    '🔗 Annonce    : ' + url,
    '🕐 Date       : ' + now,
  ];
  if (remarques && remarques !== 'Aucune') lines.push('💬 Remarques  : ' + remarques);

  if (postTexte) {
    lines.push('');
    lines.push('─────────────────────────────────────');
    lines.push('✍️ TEXTE DU POST — PRÊT À PUBLIER');
    lines.push('─────────────────────────────────────');
    lines.push('');
    lines.push(postTexte);
  }

  const message = lines.join('\n');

  // ── 4. ENVOI VIA RESEND ─────────────────────────────────────────────────────
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return res.status(500).json({ error: 'RESEND_API_KEY manquant' });

  try {
    const mailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Immo Pro <onboarding@resend.dev>',
        to: ['matoutube13@gmail.com'],
        bcc: ['mathias@trevirasquain.be'],
        subject: `📱 Demande Post FB — ${pack} — ${delegue}`,
        text: message
      })
    });

    const mailData = await mailRes.json();
    if (!mailRes.ok) throw new Error(JSON.stringify(mailData));

    return res.status(200).json({ success: true });

  } catch (mailErr) {
    console.error('Mail error:', mailErr.message);
    return res.status(500).json({ error: 'Erreur envoi mail : ' + mailErr.message });
  }
}

export const config = { api: { bodyParser: true } };
