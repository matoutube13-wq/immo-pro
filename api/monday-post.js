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

  // ── SCRAPE (triple fallback) ────────────────────────────────────────────────
  let html = '', scrapeMethod = '';

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-BE,fr;q=0.9' },
      signal: AbortSignal.timeout(12000)
    });
    const h = await r.text();
    if (h.length > 2000 && (h.includes('trevi') || h.includes('bien'))) { html = h; scrapeMethod = 'direct'; }
  } catch(e) {}

  if (!html) {
    try {
      const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
      const h = await r.text();
      if (h.length > 2000) { html = h; scrapeMethod = 'corsproxy'; }
    } catch(e) {}
  }

  if (!html) {
    try {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      if (j?.contents?.length > 2000) { html = j.contents; scrapeMethod = 'allorigins'; }
    } catch(e) {}
  }

  // ── EXTRACTION HTML ─────────────────────────────────────────────────────────
  let agenceIndex = null, adresseComplete = null, imageUrl = null;
  let postTexte = null, genErr = null;

  if (html) {
    // Agence depuis le contenu scrapé — basé sur les mentions explicites dans la page trevi.be
    // trevi.be mentionne clairement "TREVI RASQUAIN", "TREVI LIEGE", "trevirasquain.be", "treviliege.be"
    // ainsi que les numéros de téléphone et emails spécifiques à chaque agence
    const htmlLower = html.toLowerCase();
    
    // Signaux LIÈGE (04 336 35 82, treviliege, TREVI LIÈGE, info@treviliege)
    const isLiege = (
      html.includes('04 336 35 82') ||
      html.includes('04/336') ||
      html.includes('04.336') ||
      htmlLower.includes('treviliege') ||
      htmlLower.includes('trevi liège') ||
      htmlLower.includes('trevi liege') ||
      htmlLower.includes('info@treviliege') ||
      html.includes('+3204336')
    );
    
    // Signaux HUY/RASQUAIN (085 25 39 03, trevirasquain, TREVI RASQUAIN, info@trevirasquain)
    const isRasquain = (
      html.includes('085 25 39 03') ||
      html.includes('085/25.39.03') ||
      html.includes('085/25') ||
      html.includes('085.25') ||
      htmlLower.includes('trevirasquain') ||
      htmlLower.includes('trevi rasquain') ||
      htmlLower.includes('info@trevirasquain') ||
      html.includes('+32085')
    );

    if (isLiege && !isRasquain) {
      agenceIndex = 1; // LIÈGE
    } else if (isRasquain && !isLiege) {
      agenceIndex = 2; // HUY
    } else if (isLiege && isRasquain) {
      // Les deux présents (ex: footer avec les deux agences) → regarder lequel est mentionné en premier
      const idxLiege = Math.min(
        html.indexOf('04 336') > -1 ? html.indexOf('04 336') : 999999,
        htmlLower.indexOf('treviliege') > -1 ? htmlLower.indexOf('treviliege') : 999999
      );
      const idxRasquain = Math.min(
        html.indexOf('085 25') > -1 ? html.indexOf('085 25') : 999999,
        htmlLower.indexOf('trevirasquain') > -1 ? htmlLower.indexOf('trevirasquain') : 999999
      );
      agenceIndex = idxLiege < idxRasquain ? 1 : 2;
    }

    // Adresse complète — chercher rue + numéro + code postal + ville
    // Pattern 1 : JSON-LD structuré (le plus fiable)
    const streetMatch = html.match(/"streetAddress"\s*:\s*"([^"]+)"/i);
    const postalMatch = html.match(/"postalCode"\s*:\s*"([^"]+)"/i);
    const cityMatch   = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i);
    if (streetMatch && (postalMatch || cityMatch)) {
      adresseComplete = streetMatch[1].trim();
      if (postalMatch) adresseComplete += ', ' + postalMatch[1].trim();
      if (cityMatch)   adresseComplete += ' ' + cityMatch[1].trim();
    }
    // Pattern 2 : itemprop
    if (!adresseComplete) {
      const m = html.match(/itemprop="streetAddress"[^>]*>\s*([^<]+)</i);
      if (m && m[1].trim().length > 4) adresseComplete = m[1].trim();
    }
    // Pattern 3 : og:description contient souvent l'adresse (ex: "Maison à vendre à Rue X 12, 4500 Huy")
    if (!adresseComplete) {
      const og = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
                 html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i);
      if (og) {
        // Chercher une adresse dans la description og (Rue ... XX, XXXX Ville)
        const addrInOg = og[1].match(/([A-Za-zÀ-ÿ\s'-]+(?:rue|avenue|chaussée|voie|place|square|clos|sentier|chemin|allée|boulevard|drève|impasse|passage|quai|route|ruelle|venelle|dreve)[^,]{2,40},?\s*\d{4}\s+[A-Za-zÀ-ÿ\s-]+)/i);
        if (addrInOg) adresseComplete = addrInOg[1].trim();
      }
    }
    // Pattern 4 : h1 en dernier recours
    if (!adresseComplete) {
      const h1 = html.match(/<h1[^>]*>([^<]{10,80})<\/h1>/i);
      if (h1 && h1[1].trim().length > 4) adresseComplete = h1[1].trim().replace(/\s+/g, ' ');
    }
    if (adresseComplete) adresseComplete = adresseComplete.replace(/\s+/g, ' ').trim();

    // Extraction de TOUTES les photos du bien
    let allPhotos = [];
    
    // 1. Chercher dans les balises og:image (souvent la photo principale)
    const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                  html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogImg && ogImg[1]) allPhotos.push(ogImg[1]);

    // 2. Chercher toutes les URLs d'images dans le HTML (photos du bien)
    const allImgUrls = [...html.matchAll(/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|webp|png)(?:\?[^"'\s<>]*)?/gi)]
      .map(m => m[0])
      .filter(u => {
        const l = u.toLowerCase();
        // Exclure logos, icônes, sprites, avatars, flags, etc.
        return !l.includes('logo') && !l.includes('icon') && !l.includes('avatar') &&
               !l.includes('sprite') && !l.includes('flag') && !l.includes('bullet') &&
               !l.includes('arrow') && !l.includes('btn') && !l.includes('button') &&
               !l.includes('background') && !l.includes('bg-') && !l.includes('pixel') &&
               !l.includes('tracking') && !l.includes('analytics') && !l.includes('badge') &&
               // Garder uniquement les images qui ressemblent à des photos de biens
               (l.includes('photo') || l.includes('image') || l.includes('img') ||
                l.includes('media') || l.includes('upload') || l.includes('property') ||
                l.includes('bien') || l.includes('trevi') || l.includes('annonce') ||
                u.length > 90);
      });
    
    // Dédupliquer et ajouter toutes les photos trouvées
    for (const imgUrl of allImgUrls) {
      if (!allPhotos.includes(imgUrl)) allPhotos.push(imgUrl);
    }
    
    // Limiter à 20 photos max, garder la première comme photo principale
    allPhotos = allPhotos.slice(0, 20);
    imageUrl = allPhotos[0] || null;

    // Prix
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

    // Contacts agence (selon l'agence détectée)
    const contactEmail = agenceIndex === 1 ? 'info@treviliege.be' : 'info@trevirasquain.be';
    const contactTel   = agenceIndex === 1 ? '04 336 35 82' : '085 25 39 03';

    // Visite virtuelle
    const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;

    // Texte nettoyé pour Claude
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 12000);

    // ── CLAUDE ─────────────────────────────────────────────────────────────────
    try {
      const SYSTEM_PROMPT = `Tu es expert en communication immobilière pour TREVI Rasquain et TREVI Liège.
Tu génères des posts Facebook en respectant STRICTEMENT et EXACTEMENT le format, les emojis, et les caractères gras Unicode ci-dessous.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RÈGLES ABSOLUES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Ne jamais inventer d'informations
- Utiliser uniquement ce qui est présent dans le contenu fourni
- Si une info est absente, ne pas mentionner la section
- Visite virtuelle : inclure UNIQUEMENT si un lien Matterport est présent
- Infos techniques : toujours toutes les inclure sans exception (PEB + kWh, chauffage, châssis, électricité, panneaux, pompe à chaleur, VMC, citerne, alarme, clim, etc.)
- Prix : ${prixLabel}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTACTS (selon l'agence détectée dans le contenu)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${contactEmail} / ${contactTel}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT EXACT DU POST — NE JAMAIS DÉVIER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[BLOC EXCLUSIVITÉ — uniquement si mentionné dans le contenu]
👀 𝙉𝙤𝙪𝙫𝙚𝙖𝙪𝙩𝙚́ 𝙚𝙣 𝙖𝙫𝙖𝙣𝙩-𝙥𝙧𝙚𝙢𝙞𝙚̀𝙧𝙚 𝙨𝙪𝙧 𝙣𝙤𝙨 𝙧𝙚́𝙨𝙚𝙖𝙪𝙭 !
𝙑𝙤𝙪𝙨 ê𝙩𝙚𝙨 𝙡𝙚𝙨 𝙥𝙧𝙚𝙢𝙞𝙚𝙧𝙨 à 𝙡𝙖 𝙙𝙚́𝙘𝙤𝙪𝙫𝙧𝙞𝙧 — 𝙣𝙚 𝙩𝙖𝙧𝙙𝙚𝙯 𝙥𝙖𝙨 à 𝙥𝙧𝙤𝙜𝙧𝙖𝙢𝙢𝙚𝙧 𝙫𝙤𝙩𝙧𝙚 𝙫𝙞𝙨𝙞𝙩𝙚 ! 🔑

[TITRE]
🏡 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [Type de bien] à [𝗩𝗜𝗟𝗟𝗘 𝗘𝗡 𝗚𝗥𝗔𝗦 𝗨𝗡𝗜𝗖𝗢𝗗𝗘] 📌
ou
🏡 𝗔 𝗟𝗢𝗨𝗘𝗥 – [Type de bien] à [𝗩𝗜𝗟𝗟𝗘 𝗘𝗡 𝗚𝗥𝗔𝗦 𝗨𝗡𝗜𝗖𝗢𝗗𝗘] 📌
(Si nouvelles conditions : ajouter "NOUVELLES CONDITIONS" sur la ligne AVANT le titre)

[VISITE VIRTUELLE — uniquement si lien Matterport présent]
🎥 VISITE VIRTUELLE DISPONIBLE : https://my.matterport.com/show/?m=XXXXX

[ACCROCHE]
1 à 3 phrases mettant en valeur le bien, sa localisation, ses points forts.
Ton naturel et engageant. Chiffres importants en gras Unicode : 𝟭𝟱𝟬 𝗺², 𝟮.𝟴𝟯𝟮 𝗺², etc.
Mots importants en gras Unicode quand pertinent.

[COMPOSITION DU BIEN]
✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :

Si infos par niveau disponibles, utiliser sous-titres avec ✔️ :
✔️ 𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 :
– [élément]
✔️ 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 :
– [élément]
✔️ 𝗘́𝘁𝗮𝗴𝗲 : (ou 𝟭𝗲𝗿 𝗲́𝘁𝗮𝗴𝗲 :, 𝟮𝗲 𝗲́𝘁𝗮𝗴𝗲 :)
– [élément]

Si pas d'infos par niveau :
✨ 𝗖𝗮𝗿𝗮𝗰𝘁𝗲́𝗿𝗶𝘀𝘁𝗶𝗾𝘂𝗲𝘀 𝗽𝗿𝗶𝗻𝗰𝗶𝗽𝗮𝗹𝗲𝘀 :
– [élément]

Pour terrain → ✨ 𝗔𝘁𝗼𝘂𝘁𝘀 𝗱𝘂 𝘁𝗲𝗿𝗿𝗮𝗶𝗻 : ou ✨ 𝗖𝗮𝗿𝗮𝗰𝘁𝗲́𝗿𝗶𝘀𝘁𝗶𝗾𝘂𝗲𝘀 :
Pour commerce/industriel → ✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 : + ⚡️ 𝗜𝗻𝗳𝗼𝘀 𝗽𝗿𝗮𝘁𝗶𝗾𝘂𝗲𝘀 :

[EXTÉRIEURS — si applicable]
🌿 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 :
– [élément]

[SITUATION GÉOGRAPHIQUE — si terrain ou bien avec atouts de localisation]
🏗️ 𝗦𝗶𝘁𝘂𝗮𝘁𝗶𝗼𝗻 𝗽𝗿𝗶𝘃𝗶𝗹𝗲́𝗴𝗶𝗲́𝗲 :
– [proximité commodités, transports, écoles, etc.]

[INFOS TECHNIQUES — toujours complet si disponible]
⚡️ 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :
– PEB : [LETTRE] (𝗫𝗫𝗫 kWh/m²/an)
– Chauffage : [type]
– Châssis : [type]
– [tous les autres éléments : panneaux photovoltaïques, pompe à chaleur, VMC, citerne, alarme, clim, boiler, adoucisseur, vidéophone, etc.]
– Électricité conforme (ou non conforme)
– RC : [montant] € (si disponible)
Si bien loué : ⚠️ Actuellement occupé par des locataires (obligations locatives à respecter)
Si libre à l'acte : ✅ Libre à l'acte !

[PRIX — adapter selon le type]
Vente offre à partir de :
💰 Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 €
(sous réserve d'acceptation du propriétaire)

Prix fixe :
💰 Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 €
(sous réserve d'acceptation du propriétaire)

Location :
💰 Loyer : 𝗫.𝗫𝗫𝗫 €/mois + [charges si disponibles]
📅 [Disponibilité, mois de caution, candidatures si disponibles]
📋 Candidature à envoyer à : [email candidatures si disponible]

Viager :
💰 𝗩𝗶𝗮𝗴𝗲𝗿 𝗼𝗰𝗰𝘂𝗽𝗲́ – 𝗩𝗲𝗻𝘁𝗲 𝗱𝗲 𝗹𝗮 𝗻𝘂𝗲-𝗽𝗿𝗼𝗽𝗿𝗶𝗲́𝘁𝗲́ :
– Bouquet : [montant] €
– Rente : [montant] €/mois

[BON À SAVOIR — si info importante complémentaire]
🔑 𝗕𝗼𝗻 à 𝘀𝗮𝘃𝗼𝗶𝗿 : [info importante ex: bien loué 750€/mois, libre à l'acte, soumis accord SPI, etc.]

[CONTACT — toujours en dernier, exactement ainsi]
𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗼𝘂𝗿 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 🔑
✉️ ${contactEmail}
📞 ${contactTel}
[URL complète de l'annonce]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CARACTÈRES UNICODE GRAS EXACTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Chiffres : 𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵
Majuscules : 𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭
Minuscules : 𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇
Accentuées gras : 𝗲́ 𝗲̀ 𝗲̂ 𝗮̀ 𝗶̂ 𝗼̂ 𝘂̂ 𝗰̧
Italique : 𝙉𝙤𝙪𝙫𝙚𝙖𝙪𝙩𝙚́ (pour le bloc exclusivité uniquement)

RÈGLE MISE EN PAGE :
- Une ligne vide entre chaque section principale
- Chaque élément de liste sur sa propre ligne avec – (tiret demi-cadratin, jamais un trait d'union -)
- Jamais de bullet points classiques (•)
- Les titres de sections (𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻, 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀, etc.) : toujours en gras Unicode exact
`;function handler(req, res) {
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

  // ── SCRAPE (triple fallback) ────────────────────────────────────────────────
  let html = '', scrapeMethod = '';

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-BE,fr;q=0.9' },
      signal: AbortSignal.timeout(12000)
    });
    const h = await r.text();
    if (h.length > 2000 && (h.includes('trevi') || h.includes('bien'))) { html = h; scrapeMethod = 'direct'; }
  } catch(e) {}

  if (!html) {
    try {
      const r = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
      const h = await r.text();
      if (h.length > 2000) { html = h; scrapeMethod = 'corsproxy'; }
    } catch(e) {}
  }

  if (!html) {
    try {
      const r = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(12000) });
      const j = await r.json();
      if (j?.contents?.length > 2000) { html = j.contents; scrapeMethod = 'allorigins'; }
    } catch(e) {}
  }

  // ── EXTRACTION HTML ─────────────────────────────────────────────────────────
  let agenceIndex = null, adresseComplete = null, imageUrl = null;
  let postTexte = null, genErr = null;

  if (html) {
    // Agence depuis le contenu
    const htmlLower = html.toLowerCase();
    if (htmlLower.includes('trevi huy') || htmlLower.includes('agence de huy') || htmlLower.includes('agence huy') || html.includes('085 25 39 03') || html.includes('085/25') || html.includes('085.25')) {
      agenceIndex = 2; // HUY
    } else if (htmlLower.includes('trevi li') || htmlLower.includes('agence de li') || htmlLower.includes('treviliege') || html.includes('04 336') || html.includes('04/336')) {
      agenceIndex = 1; // LIÈGE
    }

    // Adresse
    const adressePatterns = [
      html.match(/"streetAddress"\s*:\s*"([^"]+)"/i),
      html.match(/itemprop="streetAddress"[^>]*>([^<]+)</i),
      html.match(/<h1[^>]*>([^<]{10,80})<\/h1>/i),
    ];
    for (const m of adressePatterns) {
      if (m && m[1] && m[1].trim().length > 4) { adresseComplete = m[1].trim().replace(/\s+/g, ' '); break; }
    }

    // Image og:image
    const ogImg = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) ||
                  html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
    if (ogImg) {
      imageUrl = ogImg[1];
    } else {
      const imgs = [...html.matchAll(/https?:\/\/[^"'\s]+\.(?:jpg|jpeg|webp|png)(?:\?[^"'\s]*)?/gi)]
        .map(m => m[0]).filter(u => { const l = u.toLowerCase(); return !l.includes('logo') && !l.includes('icon') && !l.includes('avatar') && !l.includes('sprite') && (l.includes('photo') || l.includes('image') || l.includes('img') || l.includes('media') || l.includes('upload') || u.length > 80); });
      if (imgs.length) imageUrl = imgs[0];
    }

    // Prix
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

    // Contacts agence (selon l'agence détectée)
    const contactEmail = agenceIndex === 1 ? 'info@treviliege.be' : 'info@trevirasquain.be';
    const contactTel   = agenceIndex === 1 ? '04 336 35 82' : '085 25 39 03';

    // Visite virtuelle
    const matterport = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const virtualVisit = matterport ? matterport[0] : null;

    // Texte nettoyé pour Claude
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 12000);

    // ── CLAUDE ─────────────────────────────────────────────────────────────────
    try {
      const SYSTEM_PROMPT = `Tu es expert en communication immobilière pour TREVI Rasquain.
Tu génères des posts Facebook en respectant STRICTEMENT le format, le style, et les emojis des exemples ci-dessous.

══════════════════════════════════════════════════════════
FORMAT EXACT — NE JAMAIS DÉVIER
══════════════════════════════════════════════════════════

LIGNE 1 — TITRE :
• Vente   : 🏠 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [description du bien] à 𝗩𝗜𝗟𝗟𝗘 🏡
• Location: 🏠 𝗔 𝗟𝗢𝗨𝗘𝗥 – [description du bien] à 𝗩𝗜𝗟𝗟𝗘 🏡
• Si nouvelles conditions : ajouter " NOUVELLES CONDITIONS " sur la ligne AVANT le titre

LIGNE 2 — VISITE VIRTUELLE (uniquement si disponible) :
📹 VISITE VIRTUELLE DISPONIBLE : [lien matterport]

LIGNE 3+ — ACCROCHE :
2-3 phrases accrocheuses et valorisantes.
Chiffres importants en gras Unicode : 𝟭𝟱𝟬 𝗺², 𝟮.𝟴𝟯𝟮 𝗺², etc.
Mots clés en gras Unicode quand pertinent.

SECTION COMPOSITION :
✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :
Si plusieurs niveaux définis, utiliser sous-titres avec emoji adapté :
  ✅ 𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 :
  ✅ 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 :
  ✅ 𝗘́𝘁𝗮𝗴𝗲 : (ou 𝟭𝗲𝗿 𝗲́𝘁𝗮𝗴𝗲 :, 𝟮𝗲 𝗲́𝘁𝗮𝗴𝗲 :)
  🌿 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 :
Chaque élément : – [description] (tiret demi-cadratin, pas un trait d'union)

Pour terrain → ✨ 𝗖𝗮𝗿𝗮𝗰𝘁𝗲́𝗿𝗶𝘀𝘁𝗶𝗾𝘂𝗲𝘀 : ou ✨ 𝗔𝘁𝗼𝘂𝘁𝘀 𝗱𝘂 𝘁𝗲𝗿𝗿𝗮𝗶𝗻 :
Pour commerce/industriel → ✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 : + ⚡ 𝗜𝗻𝗳𝗼𝘀 𝗽𝗿𝗮𝘁𝗶𝗾𝘂𝗲𝘀 :

SECTION INFOS TECHNIQUES :
⚡ 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :
– PEB : [CLASSE] (𝗫𝗫𝗫 kWh/m²/an)
– Chauffage [type]
– Châssis [type]
– [Panneaux solaires si présents]
– [Alarme, citerne, adoucisseur, VMC, etc. si présents]
– Électricité conforme (ou non conforme)
– RC : [montant] € (si disponible)
Si bien loué : ⚠️ Actuellement occupé par des locataires (obligations locatives à respecter)

SECTION PRIX :
• Prix fixe vente    : 💰 Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 €
• Prix à partir de   : 💰 Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 €
• Location           : 💰 Loyer : 𝗫.𝗫𝗫𝗫 €/mois
Toujours : (sous réserve d'acceptation du propriétaire) OU (des propriétaires) OU (des vendeurs)
Si infos location supplémentaires :
📅 [Disponibilité, caution, candidatures...]

BON À SAVOIR (si info importante complémentaire) :
🔑 𝗕𝗼𝗻 à 𝘀𝗮𝘃𝗼𝗶𝗿 : [info]

SECTION CONTACT — TOUJOURS EN DERNIER, EXACTEMENT AINSI :
🔑 𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗼𝘂𝗿 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 
📧 ${contactEmail}
📞 ${contactTel}
[URL complète de l'annonce]

══════════════════════════════════════════════════════════
CARACTÈRES UNICODE GRAS — UTILISE CES CARACTÈRES EXACTEMENT
══════════════════════════════════════════════════════════
Chiffres : 𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵
Majuscules : 𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭
Minuscules : 𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇
Accentuées : 𝗲́ 𝗲̀ 𝗲̂ 𝗮̀ 𝗶̂ 𝗼̂ 𝘂̂ 𝗰̧

RÈGLES ABSOLUES :
- N'invente AUCUNE information non présente dans le contenu fourni
- Sections sans info disponible → omises entièrement
- Prix : ${prixLabel}
- Ville dans le titre : TOUJOURS en gras Unicode majuscules
- Les titres de sections (𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻, 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀, etc.) : copier exactement les caractères gras Unicode
`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2500,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `Ville : ${villeUrl}\nURL : ${url}${virtualVisit ? `\nVisite virtuelle : ${virtualVisit}` : ''}\n\nContenu de l'annonce :\n${text}` }]
        })
      });

      const aiData = await aiRes.json();
      if (aiData?.error) throw new Error(aiData.error.type + ': ' + aiData.error.message);
      postTexte = aiData?.content?.[0]?.text?.trim() || null;
      if (!postTexte) throw new Error('Réponse Claude vide');
    } catch(e) { genErr = e.message; }
  }

  try {
    // ── TITRE MONDAY ───────────────────────────────────────────────────────────
    const packLabel = pack.toUpperCase();
    const adresseTitre = adresseComplete || villeUrl;
    const itemName = `${packLabel} – ${adresseTitre}`;

    // ── COLONNES ───────────────────────────────────────────────────────────────
    const delegueId = DELEGUE_MAP[delegue];
    const colVals = {
      dropdown_mkxvvrvk: { ids: [1] },
      project_status:    { label: 'A faire' },
      project_owner:     { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (delegueId !== null && delegueId !== undefined) colVals.dropdown_mkxvwsdj = { ids: [delegueId] };
    if (agenceIndex !== null) colVals.color_mkv6tmwp = { index: agenceIndex };

    // ── CRÉER L'ITEM ───────────────────────────────────────────────────────────
    const createData = await mondayQ(`mutation {
      create_item(board_id: ${BOARD_ID}, group_id: "${GROUP_ID}",
        item_name: ${JSON.stringify(itemName)},
        column_values: ${JSON.stringify(JSON.stringify(colVals))}) { id }
    }`);
    const itemId = createData?.data?.create_item?.id;
    if (!itemId) throw new Error('create_item: ' + JSON.stringify(createData?.errors || createData));

    // ── UPDATE 1 : INFOS DE LA DEMANDE ──────────────────────────────────────────
    const update1 = [
      `<p><strong>📋 Demande de ${delegue}</strong></p>`,
      `<p>📦 Pack : ${pack}</p>`,
      `<p>🔗 <a href="${url}">${url}</a></p>`,
      remarques ? `<p>💬 Remarques : ${remarques}</p>` : '',
      imageUrl ? `<p>📸 Photo principale :<br/><img src="${imageUrl}" style="max-width:100%;border-radius:8px;margin-top:8px;" /></p>` : '',
    ].filter(Boolean).join('');
    await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update1)}) { id } }`);

    // ── UPDATE 2 : TEXTE DU POST ───────────────────────────────────────────────
    const update2 = postTexte
      ? `<p><strong>✍️ TEXTE DU POST — PRÊT À PUBLIER</strong></p><pre>${postTexte}</pre>`
      : `<p><em>⚠️ Texte non généré${genErr ? ' — ' + genErr : ''}${!html ? ' — scrape échoué' : ''}.</em></p>`;
    await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update2)}) { id } }`);

    // ── UPDATE 3 : GALERIE PHOTOS DU BIEN ─────────────────────────────────────
    if (allPhotos.length > 1) {
      const photosHtml = allPhotos.map((photoUrl, i) =>
        `<p><strong>Photo ${i + 1}</strong><br/><img src="${photoUrl}" style="max-width:100%;border-radius:8px;margin-bottom:8px;" /></p>`
      ).join('');
      const update3 = `<p><strong>📸 Photos du bien (${allPhotos.length} photos)</strong></p>${photosHtml}`;
      await mondayQ(`mutation { create_update(item_id: ${itemId}, body: ${JSON.stringify(update3)}) { id } }`);
    }

    return res.status(200).json({ success: true, itemId, itemName, textGenerated: !!postTexte, agence: agenceIndex === 2 ? 'HUY' : agenceIndex === 1 ? 'LIÈGE' : null, scrapeMethod });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
