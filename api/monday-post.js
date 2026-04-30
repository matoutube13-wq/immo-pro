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
  const isCDC = pack === 'Coup de c\u0153ur';

  const DELEGUE_MAP = {
    'Quentin Delloye':1,'Beno\u00EEt Rasquain':2,'Caroline Gustin':5,
    'Sarah Khounchi':6,'Romain Marchandisse':7,'Venceslas Viseur':8,
    'Mathias Infantolino':9,'Marie Tilman':10,'Tim Fagot':11,
    'Charlotte Dispa':12,'Thibault Bourgeois':13,'Thibaut Gustin':14,
    'Jo\u00EBlle De Lattin':15,'Axel Bourgeois':16,'Julia Kongo':17
  };

  function cap(s){ return String(s||'').replace(/-/g,' ').split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' '); }

  async function mondayQ(query){
    const r = await fetch('https://api.monday.com/v2', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':MONDAY_TOKEN,'API-Version':'2024-01'},
      body:JSON.stringify({query})
    });
    return r.json();
  }

  // ── EXTRACTION URL ──────────────────────────────────────────────────────────
  const urlParts = url.replace(/\/$/, '').split('/');
  const lastSeg  = urlParts[urlParts.length-1] || '';
  const isNum    = /^\d+$/.test(lastSeg);
  const villeSlug= isNum ? urlParts[urlParts.length-2] : lastSeg;
  const typeSlug = isNum ? urlParts[urlParts.length-3] : urlParts[urlParts.length-2];
  const villeUrl = cap(villeSlug);
  const bienIdM  = url.match(/\/(\d{6,8})\//);
  const bienId   = bienIdM ? bienIdM[1] : null;

  // ── SCRAPE (triple fallback) ─────────────────────────────────────────────────
  let html = '', scrapeMethod = '';

  try {
    const r = await fetch(url, {
      headers:{'User-Agent':'Mozilla/5.0 (compatible; Googlebot/2.1)','Accept':'text/html','Accept-Language':'fr-BE,fr;q=0.9'},
      signal:AbortSignal.timeout(8000)
    });
    const h = await r.text();
    if (h.length > 2000) { html = h; scrapeMethod = 'direct'; }
  } catch(e) {}

  if (!html) {
    try {
      const r = await fetch('https://corsproxy.io/?' + encodeURIComponent(url), {signal:AbortSignal.timeout(8000)});
      const h = await r.text();
      if (h.length > 2000) { html = h; scrapeMethod = 'corsproxy'; }
    } catch(e) {}
  }

  if (!html) {
    try {
      const r = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), {signal:AbortSignal.timeout(8000)});
      const j = await r.json();
      if (j && j.contents && j.contents.length > 2000) { html = j.contents; scrapeMethod = 'allorigins'; }
    } catch(e) {}
  }

  // ── EXTRACTION ───────────────────────────────────────────────────────────────
  let agenceIndex=null, adresseComplete=null, allPhotos=[];
  let postFb=null, postIg=null, genErr=null;

  if (html) {
    const hl = html.toLowerCase();

    // Agence
    const isLiege   = html.includes('04 336 35 82') || html.includes('04/336') || hl.includes('treviliege') || hl.includes('trevi li\u00E8ge') || hl.includes('info@treviliege');
    const isRasquain = html.includes('085 25 39 03') || html.includes('085/25') || hl.includes('trevirasquain') || hl.includes('trevi rasquain') || hl.includes('info@trevirasquain');
    if (isLiege && !isRasquain) agenceIndex = 1;
    else if (isRasquain && !isLiege) agenceIndex = 2;
    else if (isLiege && isRasquain) {
      const iL = Math.min(html.indexOf('04 336')>-1?html.indexOf('04 336'):999999, hl.indexOf('treviliege')>-1?hl.indexOf('treviliege'):999999);
      const iR = Math.min(html.indexOf('085 25')>-1?html.indexOf('085 25'):999999, hl.indexOf('trevirasquain')>-1?hl.indexOf('trevirasquain'):999999);
      agenceIndex = iL < iR ? 1 : 2;
    }
    const contactEmail = agenceIndex===1 ? 'info@treviliege.be' : 'info@trevirasquain.be';
    const contactTel   = agenceIndex===1 ? '04 336 35 82' : '085 25 39 03';

    // Adresse
    const sM = html.match(/"streetAddress"\s*:\s*"([^"]+)"/i);
    const pM = html.match(/"postalCode"\s*:\s*"([^"]+)"/i);
    const cM = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i);
    if (sM) { adresseComplete = sM[1].trim(); if(pM) adresseComplete+=', '+pM[1]; if(cM) adresseComplete+=' '+cM[1]; }
    if (!adresseComplete) { const m=html.match(/itemprop="streetAddress"[^>]*>\s*([^<]+)</i); if(m&&m[1].trim().length>4) adresseComplete=m[1].trim(); }
    if (!adresseComplete) { const m=html.match(/<h1[^>]*>([^<]{10,80})<\/h1>/i); if(m) adresseComplete=m[1].trim(); }
    if (adresseComplete) adresseComplete = adresseComplete.replace(/\s+/g,' ').trim();

    // Photos storagewhise
    if (bienId) {
      const pat = new RegExp('https://r2\\.storagewhise\\.eu/storage\\d+/Pictures/'+bienId+'/1920/[^"\'\\s<>]+\\.(?:jpg|jpeg|webp|png)','gi');
      allPhotos = [...new Set([...html.matchAll(pat)].map(m=>m[0]))].slice(0,30);
    }
    if (allPhotos.length===0) {
      const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
      if (og) allPhotos.push(og[1]);
      const others = [...html.matchAll(/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|webp|png)(?:\?[^"'\s<>]*)?/gi)].map(m=>m[0]).filter(u=>{const l=u.toLowerCase();return!l.includes('logo')&&!l.includes('icon')&&!l.includes('sprite')&&!l.includes('pixel')&&(l.includes('photo')||l.includes('image')||l.includes('media')||l.includes('upload')||l.includes('trevi')||u.length>90);});
      for (const img of others) { if(!allPhotos.includes(img)) allPhotos.push(img); }
      allPhotos = allPhotos.slice(0,20);
    }

    // Prix
    const pAP=html.match(/\u00E0\s+partir\s+de\s+([\d\s.,]+)\s*\u20AC/i);
    const pAU=html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*\u20AC/i);
    const pSe=html.match(/([\d]{2,3}[\s.][\d]{3})\s*\u20AC/);
    let prix=null, prixType=null;
    if (pAP) { prix=pAP[1].trim().replace(/\s/g,''); prixType='a_partir'; }
    else if (pAU) { prix=pAU[1].trim().replace(/\s/g,''); prixType='au_prix'; }
    else if (pSe) { prix=pSe[1].trim().replace(/\s/g,''); prixType='fixe'; }
    const prixLabel = prixType==='a_partir' ? 'à partir de '+prix+' €' : prixType==='au_prix' ? 'au prix de '+prix+' €' : prix ? prix+' €' : '[prix non détecté]';

    // Matterport
    const matt = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const vv   = matt ? matt[0] : null;

    // Texte nettoyé
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().substring(0,12000);

    // ── PROMPT CLAUDE ─────────────────────────────────────────────────────────
    const igSection = isCDC ? [
      '',
      '═══════════════════════════════════════════',
      'FORMAT POST INSTAGRAM — OBLIGATOIRE POUR CE BIEN',
      '═══════════════════════════════════════════',
      'Après le post Facebook, ajoute exactement "---INSTAGRAM---" sur une ligne seule, puis :',
      '',
      '🏡 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [Type de bien] · [𝗩𝗶𝗹𝗹𝗲]',
      '[ou 🏡 𝗔 𝗟𝗢𝗨𝗘𝗥]',
      '',
      '✨ [surface] · [X ch] · PEB [lettre] · [2-3 atouts majeurs courts]',
      '',
      '[1 phrase d\'accroche percutante + emoji]',
      '',
      '💰 [prix formaté]',
      '',
      '📩 ' + contactEmail + ' · 📞 ' + contactTel,
    ].join('\n') : '';

    const SYSTEM = [
      'Tu es expert en communication immobilière belge pour TREVI Rasquain et TREVI Liège.',
      'Tu génères des publications immobilières de haute qualité.',
      '',
      'INFORMATIONS CONTEXTUELLES :',
      '- Prix détecté : ' + prixLabel,
      '- Visite virtuelle : ' + (vv || 'aucune'),
      '- Contact agence : ' + contactEmail + ' / ' + contactTel,
      '- URL annonce : ' + url,
      '',
      '═══════════════════════════════════════════',
      'RÈGLES ABSOLUES',
      '═══════════════════════════════════════════',
      '1. N\'invente AUCUNE information — utilise uniquement ce qui est dans le contenu fourni',
      '2. Si une section n\'a pas de données, omets-la entièrement',
      '3. Adapte la structure au TYPE de bien (maison, appart, terrain, commerce, industriel, viager, location)',
      '4. Chaque bien est unique — sois créatif dans l\'accroche tout en restant factuel',
      '5. RETOURS À LA LIGNE : utilise une vraie ligne vide entre chaque section principale',
      '6. Utilise – (tiret demi-cadratin U+2013), jamais le trait d\'union -',
      '',
      '═══════════════════════════════════════════',
      'FORMAT POST FACEBOOK — STRICT',
      '═══════════════════════════════════════════',
      '',
      '[Si exclusivité] 👀 𝙉𝙤𝙪𝙫𝙚𝙖𝙪𝙩𝙚́ 𝙚𝙣 𝙖𝙫𝙖𝙣𝙩-𝙥𝙧𝙚𝙢𝙞𝙚̀𝙧𝙚 𝙨𝙪𝙧 𝙣𝙤𝙨 𝙧𝙚́𝙨𝙚𝙖𝙪𝙭 !',
      '',
      '🏡 𝗔 𝗩𝗘𝗡𝗗𝗥𝗘 – [description] à [𝗩𝗜𝗟𝗟𝗘 𝗘𝗡 𝗚𝗥𝗔𝗦] 📌',
      '[ou 🏡 𝗔 𝗟𝗢𝗨𝗘𝗥 pour location]',
      (vv ? '🎥 VISITE VIRTUELLE DISPONIBLE : ' + vv : ''),
      '',
      '[ACCROCHE : 2-3 phrases. Surface en gras 𝟭𝟱𝟬 𝗺², mots importants en gras Unicode]',
      '',
      '✨ 𝗖𝗼𝗺𝗽𝗼𝘀𝗶𝘁𝗶𝗼𝗻 𝗱𝘂 𝗯𝗶𝗲𝗻 :',
      '[si niveaux → ✔️ 𝗦𝗼𝘂𝘀-𝘀𝗼𝗹 : / ✔️ 𝗥𝗲𝘇-𝗱𝗲-𝗰𝗵𝗮𝘂𝘀𝘀𝗲́𝗲 : / ✔️ 𝗘́𝘁𝗮𝗴𝗲 :]',
      '[si pas de niveaux → liste directe avec –]',
      '[terrain → ✨ 𝗔𝘁𝗼𝘂𝘁𝘀 𝗱𝘂 𝘁𝗲𝗿𝗿𝗮𝗶𝗻 :]',
      '',
      '🌿 𝗘𝘅𝘁𝗲́𝗿𝗶𝗲𝘂𝗿𝘀 : [si applicable]',
      '– [extérieur]',
      '',
      '⚡️ 𝗜𝗻𝗳𝗼𝘀 𝘁𝗲𝗰𝗵𝗻𝗶𝗾𝘂𝗲𝘀 :',
      '– PEB : [LETTRE] (𝗫𝗫𝗫 kWh/m²/an)',
      '– Chauffage : [type]',
      '– Châssis : [type]',
      '– [TOUS les éléments disponibles : panneaux PV, PAC, VMC, citerne, alarme, clim, adoucisseur, RC, vidéophone…]',
      '– Électricité conforme [ou non conforme]',
      '[⚠️ Actuellement loué si applicable / ✅ Libre à l\'acte si applicable]',
      '',
      '[PRIX selon type :]',
      '💰 Faire offre à partir de 𝗫𝗫𝗫.𝟬𝟬𝟬 € / (sous réserve d\'acceptation du propriétaire)',
      '💰 Prix : 𝗫𝗫𝗫.𝟬𝟬𝟬 € / (sous réserve d\'acceptation du propriétaire)',
      '💰 Loyer : 𝗫.𝗫𝗫𝗫 €/mois [+ charges] / 📅 [disponibilité] / 📋 Candidature à : [email]',
      '💰 𝗩𝗶𝗮𝗴𝗲𝗿 𝗼𝗰𝗰𝘂𝗽𝗲́ – 𝗩𝗲𝗻𝘁𝗲 𝗱𝗲 𝗹𝗮 𝗻𝘂𝗲-𝗽𝗿𝗼𝗽𝗿𝗶𝗲́𝘁𝗲́ : / – Bouquet : X € / – Rente : X €/mois',
      '',
      '[🔑 𝗕𝗼𝗻 à 𝘀𝗮𝘃𝗼𝗶𝗿 : info importante si applicable]',
      '',
      '𝗣𝗼𝘂𝗿 𝗽𝗹𝘂𝘀 𝗱𝗲 𝗿𝗲𝗻𝘀𝗲𝗶𝗴𝗻𝗲𝗺𝗲𝗻𝘁𝘀 𝗼𝘂 𝗽𝗼𝘂𝗿 𝗽𝗹𝗮𝗻𝗶𝗳𝗶𝗲𝗿 𝘂𝗻𝗲 𝘃𝗶𝘀𝗶𝘁𝗲 🔑',
      '✉️ ' + contactEmail,
      '📞 ' + contactTel,
      url,
      igSection,
      '',
      'Après TOUT le contenu, ajoute "---ADRESSE---" puis l\'adresse complète (rue + numéro + code postal + ville) ou "INCONNU".',
      '',
      '═══════════════════════════════════════════',
      'CARACTÈRES UNICODE GRAS',
      '═══════════════════════════════════════════',
      'Chiffres : 𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵',
      'Majuscules : 𝗔𝗕𝗖𝗗𝗘𝗙𝗚𝗛𝗜𝗝𝗞𝗟𝗠𝗡𝗢𝗣𝗤𝗥𝗦𝗧𝗨𝗩𝗪𝗫𝗬𝗭',
      'Minuscules : 𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇',
      'Accentuées : 𝗲́ 𝗲̀ 𝗲̂ 𝗮̀ 𝗶̂ 𝗼̂ 𝗰̧',
    ].join('\n');

    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
        body:JSON.stringify({
          model:'claude-haiku-4-5-20251001',
          max_tokens:3000,
          system:SYSTEM,
          messages:[{role:'user',content:'Ville : '+villeUrl+'\nURL : '+url+(vv?'\nVisite virtuelle : '+vv:'')+'\n\nContenu de l\'annonce :\n'+text}]
        })
      });
      const aiData = await aiRes.json();
      if (aiData && aiData.error) throw new Error(aiData.error.type+': '+aiData.error.message);
      const full = (aiData && aiData.content && aiData.content[0] && aiData.content[0].text) ? aiData.content[0].text.trim() : '';

      // Parser : FB ---INSTAGRAM--- contenu ---ADRESSE--- adresse
      const adresseParts = full.split('---ADRESSE---');
      const adresseFromClaude = adresseParts[1] ? adresseParts[1].trim() : '';
      if (adresseFromClaude && adresseFromClaude !== 'INCONNU' && adresseFromClaude.length > 4 && !adresseComplete)
        adresseComplete = adresseFromClaude;

      const mainContent = adresseParts[0] || '';
      const igParts = mainContent.split('---INSTAGRAM---');
      postFb = igParts[0] ? igParts[0].trim() : null;
      if (isCDC && igParts[1]) postIg = igParts[1].trim();
      if (!postFb) throw new Error('Réponse Claude vide');
    } catch(e) { genErr = e.message; }
  }

  try {
    // ── TITRE ─────────────────────────────────────────────────────────────────
    const packLabel = pack.toUpperCase();
    const titre = adresseComplete || villeUrl;
    const itemName = packLabel + ' – ' + titre;

    // ── COLONNES ──────────────────────────────────────────────────────────────
    const did = DELEGUE_MAP[delegue];
    const colVals = {
      dropdown_mkxvvrvk: {ids: isCDC ? [2] : [1]},
      project_status: {label:'A faire'},
      project_owner: {personsAndTeams:[{id:TREVI_USER_ID,kind:'person'}]}
    };
    if (did !== null && did !== undefined) colVals.dropdown_mkxvwsdj = {ids:[did]};
    if (agenceIndex !== null) colVals.color_mkv6tmwp = {index:agenceIndex};

    // ── CRÉER L'ITEM ──────────────────────────────────────────────────────────
    const cd = await mondayQ('mutation{create_item(board_id:'+BOARD_ID+',group_id:"'+GROUP_ID+'",item_name:'+JSON.stringify(itemName)+',column_values:'+JSON.stringify(JSON.stringify(colVals))+'){id}}');
    const itemId = cd && cd.data && cd.data.create_item ? cd.data.create_item.id : null;
    if (!itemId) throw new Error('create_item failed: '+JSON.stringify(cd && cd.errors || cd));

    // ── UPDATE 1 : INFOS + PHOTO ───────────────────────────────────────────────
    const u1Parts = [
      '<p><strong>📋 Demande de ' + delegue + '</strong></p>',
      '<p>📦 Pack : ' + pack + '</p>',
      '<p>🔗 <a href="' + url + '">' + url + '</a></p>',
    ];
    if (adresseComplete) u1Parts.push('<p>📍 ' + adresseComplete + '</p>');
    if (remarques) u1Parts.push('<p>💬 Remarques : ' + remarques + '</p>');
    if (allPhotos[0]) u1Parts.push('<p>📸 <img src="' + allPhotos[0] + '" style="max-width:100%;border-radius:8px;" /></p>');
    await mondayQ('mutation{create_update(item_id:'+itemId+',body:'+JSON.stringify(u1Parts.join(''))+'){id}}');

    // ── UPDATE 2 : POST FACEBOOK ───────────────────────────────────────────────
    const u2 = postFb
      ? '<p><strong>✍️ POST FACEBOOK — PRÊT À PUBLIER</strong></p><pre>' + postFb + '</pre>'
      : '<p><em>⚠️ Post non généré' + (genErr?' — '+genErr:'') + (!html?' — scrape échoué':'') + '.</em></p>';
    await mondayQ('mutation{create_update(item_id:'+itemId+',body:'+JSON.stringify(u2)+'){id}}');

    // ── UPDATE 3 : POST INSTAGRAM (CDC seulement) ──────────────────────────────
    if (isCDC) {
      const u3 = postIg
        ? '<p><strong>📸 POST INSTAGRAM — PRÊT À PUBLIER</strong></p><pre>' + postIg + '</pre>'
        : '<p><em>⚠️ Post Instagram non généré.</em></p>';
      await mondayQ('mutation{create_update(item_id:'+itemId+',body:'+JSON.stringify(u3)+'){id}}');
    }

    // ── UPDATE 4 : GALERIE PHOTOS ──────────────────────────────────────────────
    if (allPhotos.length > 0) {
      const photosHtml = allPhotos.map(function(p,i){
        return '<p><strong>Photo '+(i+1)+'</strong> — <a href="'+p+'" target="_blank">⬇️ Télécharger</a><br/><img src="'+p+'" style="max-width:100%;border-radius:6px;margin-top:4px;" /></p>';
      }).join('');
      const u4 = '<p><strong>📸 Photos du bien — ' + allPhotos.length + ' photo' + (allPhotos.length>1?'s':'') + '</strong></p>' + photosHtml;
      await mondayQ('mutation{create_update(item_id:'+itemId+',body:'+JSON.stringify(u4)+'){id}}');
    }

    return res.status(200).json({
      success:true, itemId, itemName,
      textGenerated:!!postFb, instagramGenerated:!!postIg,
      photos:allPhotos.length,
      agence:agenceIndex===2?'HUY':agenceIndex===1?'LIÈGE':null,
      scrapeMethod, adresse:adresseComplete
    });

  } catch(err) {
    return res.status(500).json({error:err.message});
  }
}

export const config = {api:{bodyParser:true}};
