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
  const GROUP_ID = 'group_mm2xjesk';
  const TREVI_USER_ID = '80840427';
  const isCDC = pack.includes('coeur') || pack.includes('oeur');

  const DELEGUE_MAP = {
    'Quentin Delloye':1,'Benoît Rasquain':2,'Caroline Gustin':5,
    'Sarah Khounchi':6,'Romain Marchandisse':7,'Venceslas Viseur':8,
    'Mathias Infantolino':9,'Marie Tilman':10,'Tim Fagot':11,
    'Charlotte Dispa':12,'Thibault Bourgeois':13,'Thibaut Gustin':14,
    'Joëlle De Lattin':15,'Axel Bourgeois':16,'Julia Kongo':17
  };

  function cap(s){ return String(s||'').replace(/-/g,' ').split(' ').map(function(w){ return w.charAt(0).toUpperCase()+w.slice(1).toLowerCase(); }).join(' '); }

  async function mondayQ(query){
    const r = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_TOKEN, 'API-Version': '2024-01' },
      body: JSON.stringify({ query: query })
    });
    return r.json();
  }

  // Extraction URL
  const urlParts = url.replace(/\/$/, '').split('/');
  const lastSeg  = urlParts[urlParts.length-1] || '';
  const isNum    = /^\d+$/.test(lastSeg);
  const villeSlug = isNum ? urlParts[urlParts.length-2] : lastSeg;
  const typeSlug  = isNum ? urlParts[urlParts.length-3] : urlParts[urlParts.length-2];
  const villeUrl  = cap(villeSlug);
  const bienIdM   = url.match(/\/(\d{6,8})\//);
  const bienId    = bienIdM ? bienIdM[1] : null;

  // Scrape triple fallback
  let html = '', scrapeMethod = '';

  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)', 'Accept': 'text/html', 'Accept-Language': 'fr-BE,fr;q=0.9' },
      signal: AbortSignal.timeout(8000)
    });
    const h = await r.text();
    if (h.length > 2000) { html = h; scrapeMethod = 'direct'; }
  } catch(e) {}

  if (!html) {
    try {
      const r = await fetch('https://corsproxy.io/?' + encodeURIComponent(url), { signal: AbortSignal.timeout(8000) });
      const h = await r.text();
      if (h.length > 2000) { html = h; scrapeMethod = 'corsproxy'; }
    } catch(e) {}
  }

  if (!html) {
    try {
      const r = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(url), { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j && j.contents && j.contents.length > 2000) { html = j.contents; scrapeMethod = 'allorigins'; }
    } catch(e) {}
  }

  // Extraction
  let agenceIndex = null, adresseComplete = null, allPhotos = [];
  let postFb = null, postIg = null, genErr = null;

  if (html) {
    const hl = html.toLowerCase();

    // Agence
    const isLiege   = html.includes('04 336 35 82') || html.includes('04/336') || hl.includes('treviliege') || hl.includes('info@treviliege');
    const isRasquain = html.includes('085 25 39 03') || html.includes('085/25') || hl.includes('trevirasquain') || hl.includes('info@trevirasquain');
    if (isLiege && !isRasquain) agenceIndex = 1;
    else if (isRasquain && !isLiege) agenceIndex = 2;
    else if (isLiege && isRasquain) {
      const iL = Math.min(html.indexOf('04 336') > -1 ? html.indexOf('04 336') : 999999, hl.indexOf('treviliege') > -1 ? hl.indexOf('treviliege') : 999999);
      const iR = Math.min(html.indexOf('085 25') > -1 ? html.indexOf('085 25') : 999999, hl.indexOf('trevirasquain') > -1 ? hl.indexOf('trevirasquain') : 999999);
      agenceIndex = iL < iR ? 1 : 2;
    }
    const contactEmail = agenceIndex === 1 ? 'info@treviliege.be' : 'info@trevirasquain.be';
    const contactTel   = agenceIndex === 1 ? '04 336 35 82' : '085 25 39 03';

    // Adresse
    const sM = html.match(/"streetAddress"\s*:\s*"([^"]+)"/i);
    const pM = html.match(/"postalCode"\s*:\s*"([^"]+)"/i);
    const cM = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i);
    if (sM) {
      adresseComplete = sM[1].trim();
      if (pM) adresseComplete += ', ' + pM[1];
      if (cM) adresseComplete += ' ' + cM[1];
    }
    if (!adresseComplete) {
      const m = html.match(/itemprop="streetAddress"[^>]*>\s*([^<]+)</i);
      if (m && m[1].trim().length > 4) adresseComplete = m[1].trim();
    }
    if (!adresseComplete) {
      const m = html.match(/<h1[^>]*>([^<]{10,80})<\/h1>/i);
      if (m) adresseComplete = m[1].trim();
    }
    if (adresseComplete) adresseComplete = adresseComplete.replace(/\s+/g, ' ').trim();

    // Photos storagewhise
    if (bienId) {
      const pat = new RegExp('https://r2\\.storagewhise\\.eu/storage\\d+/Pictures/' + bienId + '/1920/[^"\'\\s<>]+\\.(?:jpg|jpeg|webp|png)', 'gi');
      allPhotos = Array.from(new Set(Array.from(html.matchAll(pat)).map(function(m){ return m[0]; }))).slice(0, 30);
    }
    if (allPhotos.length === 0) {
      const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i) || html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/i);
      if (og) allPhotos.push(og[1]);
      const others = Array.from(html.matchAll(/https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|webp|png)(?:\?[^"'\s<>]*)?/gi)).map(function(m){ return m[0]; }).filter(function(u){
        const l = u.toLowerCase();
        return !l.includes('logo') && !l.includes('icon') && !l.includes('sprite') && !l.includes('pixel') &&
               (l.includes('photo') || l.includes('image') || l.includes('media') || l.includes('upload') || l.includes('trevi') || u.length > 90);
      });
      for (let i = 0; i < others.length; i++) { if (!allPhotos.includes(others[i])) allPhotos.push(others[i]); }
      allPhotos = allPhotos.slice(0, 20);
    }

    // Prix
    const pAP = html.match(/[\u00e0]\s+partir\s+de\s+([\d\s.,]+)\s*[\u20ac]/i);
    const pAU = html.match(/au\s+prix\s+de\s+([\d\s.,]+)\s*[\u20ac]/i);
    const pSe = html.match(/([\d]{2,3}[\s.][\d]{3})\s*[\u20ac]/);
    let prix = null, prixType = null;
    if (pAP) { prix = pAP[1].trim().replace(/\s/g, ''); prixType = 'a_partir'; }
    else if (pAU) { prix = pAU[1].trim().replace(/\s/g, ''); prixType = 'au_prix'; }
    else if (pSe) { prix = pSe[1].trim().replace(/\s/g, ''); prixType = 'fixe'; }
    const prixLabel = prixType === 'a_partir' ? 'a partir de ' + prix + ' EUR' : prixType === 'au_prix' ? 'au prix de ' + prix + ' EUR' : prix ? prix + ' EUR' : 'prix non detecte';

    // Matterport
    const matt = html.match(/https:\/\/my\.matterport\.com\/show\/\?m=[a-zA-Z0-9]+/);
    const vv = matt ? matt[0] : null;

    // Texte pour Claude
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 12000);

    // Prompt Claude — SANS caractères Unicode supplementaires dans le code source
    const igBlock = isCDC ? [
      '',
      'SECTION INSTAGRAM (obligatoire pour ce bien) :',
      'Apres le post Facebook, ecris exactement "---INSTAGRAM---" sur une ligne seule, puis le post Instagram court :',
      'Titre : emoji maison A VENDRE ou A LOUER, type de bien, point emoji',
      '2-3 atouts cles tres courts (surface, chambres, PEB, atout principal)',
      '1 phrase accroche courte + emoji',
      'Prix court',
      contactEmail + ' / ' + contactTel,
    ].join('\n') : '';

    const SYSTEM = 'Tu es expert en communication immobiliere pour TREVI Rasquain et TREVI Liege.\n' +
      'Tu generes des posts Facebook immobiliers de haute qualite.\n\n' +
      'CONTEXTE :\n' +
      '- Prix : ' + prixLabel + '\n' +
      '- Visite virtuelle : ' + (vv || 'aucune') + '\n' +
      '- Contact : ' + contactEmail + ' / ' + contactTel + '\n' +
      '- URL : ' + url + '\n\n' +
      'REGLES ABSOLUES :\n' +
      '1. N invente AUCUNE information\n' +
      '2. Si une section n a pas de donnees, omets-la\n' +
      '3. Adapte la structure au type de bien (maison, appart, terrain, commerce, industriel, viager, location)\n' +
      '4. Soigne l accroche, sois creatif mais factuel\n' +
      '5. Une ligne vide entre chaque section\n' +
      '6. Utilise le tiret demi-cadratin U+2013 (signe moins long), jamais le trait d union\n\n' +
      'FORMAT POST FACEBOOK :\n\n' +
      'LIGNE 1 TITRE : emoji maison " A VENDRE " tiret type de bien " a " VILLE EN GRAS UNICODE point carte emoji\n' +
      '(pour location : A LOUER au lieu de A VENDRE)\n' +
      '(si exclusivite mentionnee : bloc exclusivite avant le titre)\n' +
      (vv ? 'LIGNE 2 : emoji camera " VISITE VIRTUELLE DISPONIBLE : ' + vv + '"\n' : '') +
      '\nACCROCHE : 2-3 phrases valorisantes. Surface en gras unicode (ex: 150 m2 en gras). Mots importants en gras unicode.\n\n' +
      'COMPOSITION DU BIEN : emoji etoile " Composition du bien :"\n' +
      '  - Si niveaux dispo : sous-titres avec emoji coche (Sous-sol, Rez-de-chaussee, Etage)\n' +
      '  - Chaque element : tiret U+2013 description\n' +
      '  - Terrain : section "Atouts du terrain :"\n' +
      '  - Commerce/Industriel : "Composition" + "Infos pratiques :"\n\n' +
      'EXTERIEURS (si applicable) : emoji plante " Exterieurs :"\n\n' +
      'INFOS TECHNIQUES : emoji eclair " Infos techniques :"\n' +
      '  - PEB : LETTRE (XXX kWh/m2/an)\n' +
      '  - Chauffage, chassis, tous les equipements disponibles\n' +
      '  - Electricite conforme ou non conforme\n' +
      '  - Si loue : triangle avertissement + " Actuellement loue"\n' +
      '  - Si libre : coche + " Libre a l acte"\n\n' +
      'PRIX :\n' +
      '  - Offre : emoji argent " Faire offre a partir de XXX.000 EUR" puis "(sous reserve d acceptation du proprietaire)"\n' +
      '  - Fixe : emoji argent " Prix : XXX.000 EUR" puis parenthese sous reserve\n' +
      '  - Location : emoji argent " Loyer : X.XXX EUR/mois" + charges + emoji calendrier disponibilite\n' +
      '  - Viager : emoji argent gras "Viager occupe - Vente de la nue-propriete :" tiret Bouquet tiret Rente\n\n' +
      'BON A SAVOIR (si info importante) : emoji cle " Bon a savoir : info"\n\n' +
      'CONTACT (toujours en dernier) :\n' +
      '"Pour plus de renseignements ou pour planifier une visite" emoji cle\n' +
      'emoji lettre ' + contactEmail + '\n' +
      'emoji telephone ' + contactTel + '\n' +
      '[Lien complet de l annonce en premier commentaire]' + '\n' +
      igBlock + '\n\n' +
      'IMPORTANT TECHNIQUE :\n' +
      '- Pour les titres, villes, chiffres importants : utilise les vrais caracteres gras Unicode mathematiques (Mathematical Bold)\n' +
      '- Chiffres gras : serie qui commence par 0x1D7CE\n' +
      '- Lettres gras : serie Mathematical Bold (0x1D400+)\n' +
      '- Tiret entre elements : U+2013 (demi-cadratin)\n' +
      '- Jamais de bullet points classiques\n\n' +
      'A la toute fin, ecris "---ADRESSE---" puis l adresse complete (rue + numero + code postal + ville) ou "INCONNU".';

    try {
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
          system: SYSTEM,
          messages: [{ role: 'user', content: 'Ville : ' + villeUrl + '\nURL : ' + url + (vv ? '\nVisite virtuelle : ' + vv : '') + '\n\nContenu :\n' + text }]
        })
      });
      const aiData = await aiRes.json();
      if (aiData && aiData.error) throw new Error(aiData.error.type + ': ' + aiData.error.message);
      const full = (aiData && aiData.content && aiData.content[0] && aiData.content[0].text) ? aiData.content[0].text.trim() : '';
      if (!full) throw new Error('Reponse Claude vide');

      const adresseParts = full.split('---ADRESSE---');
      const adresseFromClaude = adresseParts[1] ? adresseParts[1].trim() : '';
      if (adresseFromClaude && adresseFromClaude !== 'INCONNU' && adresseFromClaude.length > 4 && !adresseComplete)
        adresseComplete = adresseFromClaude;

      const mainContent = adresseParts[0] || '';
      const igParts = mainContent.split('---INSTAGRAM---');
      postFb = igParts[0] ? igParts[0].trim() : null;
      if (isCDC && igParts[1]) postIg = igParts[1].trim();
      if (!postFb) throw new Error('Post Facebook vide');
    } catch(e) { genErr = e.message; }
  }

  try {
    // Titre
    const packLabel = pack.toUpperCase();
    const titre = adresseComplete || villeUrl;
    const itemName = packLabel + ' \u2013 ' + titre;

    // Colonnes
    const did = DELEGUE_MAP[delegue];
    const colVals = {
      dropdown_mkxvvrvk: { ids: isCDC ? [2] : [1] },
      project_status: { label: 'A faire' },
      project_owner: { personsAndTeams: [{ id: TREVI_USER_ID, kind: 'person' }] }
    };
    if (did !== null && did !== undefined) colVals.dropdown_mkxvwsdj = { ids: [did] };
    if (agenceIndex !== null) colVals.color_mkv6tmwp = { index: agenceIndex };

    // Créer item
    const colValsStr = JSON.stringify(JSON.stringify(colVals));
    const createMut = 'mutation { create_item(board_id: ' + BOARD_ID + ', group_id: "' + GROUP_ID + '", item_name: ' + JSON.stringify(itemName) + ', column_values: ' + colValsStr + ') { id } }';
    const cd = await mondayQ(createMut);
    const itemId = cd && cd.data && cd.data.create_item ? cd.data.create_item.id : null;
    if (!itemId) throw new Error('create_item failed: ' + JSON.stringify((cd && cd.errors) || cd));

    // Update 1 : infos + photo
    const u1Parts = ['<p><strong>Demande de ' + delegue + '</strong></p>', '<p>Pack : ' + pack + '</p>', '<p><a href="' + url + '">' + url + '</a></p>'];
    if (adresseComplete) u1Parts.push('<p>' + adresseComplete + '</p>');
    if (remarques) u1Parts.push('<p>Remarques : ' + remarques + '</p>');
    // Photo omise de l'update 1 — déjà présente dans la galerie photos
    await mondayQ('mutation { create_update(item_id: ' + itemId + ', body: ' + JSON.stringify(u1Parts.join('')) + ') { id } }');

    // Update 2 : post Facebook
    const u2 = postFb
      ? '<p><strong>POST FACEBOOK</strong></p><pre>' + postFb + '</pre>'
      : '<p><em>Post non genere' + (genErr ? ' : ' + genErr : '') + (!html ? ' (scrape echoue)' : '') + '.</em></p>';
    await mondayQ('mutation { create_update(item_id: ' + itemId + ', body: ' + JSON.stringify(u2) + ') { id } }');

    // Update 3 : post Instagram (CDC seulement)
    if (isCDC) {
      const u3 = postIg
        ? '<p><strong>POST INSTAGRAM</strong></p><pre>' + postIg + '</pre>'
        : '<p><em>Post Instagram non genere.</em></p>';
      await mondayQ('mutation { create_update(item_id: ' + itemId + ', body: ' + JSON.stringify(u3) + ') { id } }');
    }

    // Update 4 : galerie photos
    if (allPhotos.length > 0) {
      let photosHtml = '<p><strong>Photos du bien (' + allPhotos.length + ')</strong></p>';
      for (let i = 0; i < allPhotos.length; i++) {
        photosHtml += '<p><strong>Photo ' + (i+1) + '</strong> — <a href="' + allPhotos[i] + '" target="_blank">Telecharger</a><br/><img src="' + allPhotos[i] + '" style="max-width:100%;border-radius:6px;margin-top:4px;" /></p>';
      }
      await mondayQ('mutation { create_update(item_id: ' + itemId + ', body: ' + JSON.stringify(photosHtml) + ') { id } }');
    }

    // Update commentaire lien (toujours)
    const commentText = "<p><strong>Texte pour le commentaire de la publication :</strong></p><p>Retrouvez l'annonce complète avec toutes les photos ici<br/><a href=\"" + url + "\">" + url + "</a></p>";
    await mondayQ('mutation { create_update(item_id: ' + itemId + ', body: ' + JSON.stringify(commentText) + ') { id } }');

    return res.status(200).json({
      success: true, itemId: itemId, itemName: itemName,
      textGenerated: !!postFb, instagramGenerated: !!postIg,
      photos: allPhotos.length,
      agence: agenceIndex === 2 ? 'HUY' : agenceIndex === 1 ? 'LIEGE' : null,
      scrapeMethod: scrapeMethod, adresse: adresseComplete
    });

  } catch(err) {
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
