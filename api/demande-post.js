export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { delegue, url, pack, remarques } = req.body;

  if (!delegue || !url || !pack) {
    return res.status(400).json({ error: 'Champs manquants' });
  }

  const now = new Date().toLocaleString('fr-BE', {
    timeZone: 'Europe/Brussels',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const sujet = `📱 Demande Post FB — ${pack} — ${delegue}`;

  const corps = `
Nouvelle demande de post Facebook reçue via Immo Pro.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 DÉTAILS DE LA DEMANDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 Délégué     : ${delegue}
📦 Type        : ${pack}
🔗 Lien annonce: ${url}
🕐 Date        : ${now}
${remarques ? `💬 Remarques   : ${remarques}` : '💬 Remarques   : Aucune'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Envoyé depuis Immo Pro · TREVI Rasquain
  `.trim();

  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY manquant');
    return res.status(500).json({ error: 'RESEND_API_KEY non configuré dans Vercel' });
  }

  try {
    const mailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Immo Pro <onboarding@resend.dev>',
        to: ['mathias@trevirasquain.be'],
        subject: sujet,
        text: corps
      })
    });

    const mailData = await mailRes.json();
    console.log('Resend response:', mailRes.status, JSON.stringify(mailData));

    if (!mailRes.ok) {
      throw new Error(JSON.stringify(mailData));
    }

    return res.status(200).json({ success: true, id: mailData.id });

  } catch (err) {
    console.error('Erreur envoi mail:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  api: { bodyParser: true }
};
