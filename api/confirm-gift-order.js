// ════════════════════════════════════════
// LOUISE RINCEAU — /api/confirm-gift-order
// Finalise une commande ENTIÈREMENT couverte par une carte cadeau
// (Stripe ne peut pas encaisser moins de 0,50 €).
// Tout est revérifié côté serveur (prix réels, solde de la carte) → anti-fraude.
// ════════════════════════════════════════

const { Resend } = require('resend');

const SITE      = 'https://louiserinceau.com';
const ADMIN_KEY = 'xv3_secret_2026_changez_moi';

async function getData() {
  const r = await fetch(SITE + '/save-data.php', { headers: { 'Origin': SITE } });
  if (!r.ok) throw new Error('GET data HTTP ' + r.status);
  return r.json();
}

module.exports = async function handler(req, res) {
  const allowed = [
    'https://louiserinceau.com', 'https://www.louiserinceau.com',
    'https://xv3foisrien.com',   'https://www.xv3foisrien.com',
  ];
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', allowed.includes(origin) ? origin : allowed[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Méthode non autorisée' });

  const { nom, email, adresse, codePostal, ville, items, giftCode, commentaire } = req.body;
  if (!nom || !email || !items?.length || !giftCode) {
    return res.status(400).json({ error: 'Données manquantes' });
  }

  try {
    const data     = await getData();
    const produits = data.produits || [];
    const settings = data.settings || {};
    const byId = Object.fromEntries(produits.map(p => [p.id, p]));

    // 1. Recalculer le sous-total à partir des PRIX RÉELS du serveur
    let subtotal = 0;
    for (const it of items) {
      const p = byId[it.id];
      if (!p) return res.status(400).json({ error: 'Article introuvable : ' + it.id });
      subtotal += parseFloat(p.prix) || 0;
    }
    const freeFrom = parseFloat(settings.shippingFree)  || 100;
    const shipFlat = parseFloat(settings.shippingPrice) || 5;
    const shipping = subtotal >= freeFrom ? 0 : shipFlat;
    const realTotal = subtotal + shipping;

    // 2. Vérifier la carte cadeau (solde réel)
    const gcRes = await fetch(SITE + '/gift-card.php', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check', code: giftCode }),
    });
    const gc = await gcRes.json();
    if (!gc.valid) return res.status(400).json({ error: 'Code cadeau invalide ou épuisé', giftInvalid: true });

    // 3. La carte doit bien couvrir la totalité (sinon ce n'est pas une commande gratuite)
    if (parseFloat(gc.balance) + 0.001 < realTotal) {
      return res.status(409).json({ error: 'La carte ne couvre pas la totalité', needStripe: true, total: realTotal });
    }

    // 4. Débiter la carte du montant réel
    await fetch(SITE + '/gift-card.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
      body: JSON.stringify({ action: 'redeem', code: giftCode, amount: realTotal, order: 'gift-' + Date.now() }),
    });

    // 5. Marquer les pièces vendues (mêmes règles que le webhook)
    try {
      const soldIds = items.map(i => i.id);
      let prods = produits.map(p => {
        if (!soldIds.includes(p.id)) return p;
        if (p.stock !== undefined && p.stock !== null) return p; // géré par mark-sold.php côté site
        return { ...p, epuise: true };
      });
      await fetch(SITE + '/save-data.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY, 'Origin': SITE },
        body: JSON.stringify({ produits: prods, settings: data.settings || null, categories: data.categories || null }),
      });
    } catch (e) { console.error('[confirm-gift-order] stock error:', e.message); }

    // 6. Emails de confirmation
    const resend = new Resend(process.env.RESEND_API_KEY);
    const serif = "Georgia,'Times New Roman',serif";
    const lignes = items.map(it => {
      const p = byId[it.id];
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #E7E5E2;font-size:14px;color:#55504C">${p.nom}${it.taille ? ' — Taille ' + it.taille : ''}</td><td style="padding:10px 0;border-bottom:1px solid #E7E5E2;font-size:14px;text-align:right;font-family:${serif};color:#141312">${p.prix},00 €</td></tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#FBFBFA;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#141312">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FBFBFA;padding:40px 20px"><tr><td align="center">
  <table width="100%" style="max-width:540px;background:#fff;border:1px solid #E7E5E2">
    <tr><td align="center" style="padding:34px 32px 20px;border-bottom:1px solid #E7E5E2">
      <img src="${SITE}/images/logo-louise-rinceau.png" alt="Louise Rinceau" height="46" style="height:46px;width:auto;margin:0 auto 12px">
      <p style="margin:0;font-family:${serif};font-size:20px;letter-spacing:.3em;text-transform:uppercase">Louise&nbsp;Rinceau</p></td></tr>
    <tr><td style="padding:34px">
      <p style="margin:0 0 10px;font-family:${serif};font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#8A847F">Confirmation de commande</p>
      <h1 style="margin:0 0 20px;font-family:${serif};font-size:28px;font-weight:400">Merci, ${nom} ✦</h1>
      <p style="margin:0 0 24px;font-size:14px;font-weight:300;line-height:1.8;color:#55504C">Votre commande est confirmée, réglée avec votre carte cadeau. Votre bijou est en préparation à Marseille.</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px">${lignes}
        <tr><td style="padding:12px 0 0;font-family:${serif};font-size:12px;text-transform:uppercase;letter-spacing:.1em">Réglé par carte cadeau</td><td style="padding:12px 0 0;font-family:${serif};font-size:16px;text-align:right">${realTotal.toFixed(2).replace('.', ',')} €</td></tr>
      </table>
      <div style="background:#FBFBFA;border:1px solid #E7E5E2;padding:16px;margin-bottom:20px">
        <p style="margin:0 0 6px;font-family:${serif};font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8A847F">Expédition vers</p>
        <p style="margin:0;font-size:13px;color:#55504C;line-height:1.6">${nom}<br>${adresse}, ${codePostal} ${ville}</p></div>
      <p style="margin:0;font-size:13px;color:#55504C;line-height:1.8">Une question ? <a href="mailto:contact@louiserinceau.com" style="color:#141312">contact@louiserinceau.com</a></p>
    </td></tr></table></td></tr></table></body></html>`;

    if (email) {
      try { await resend.emails.send({ from: 'Louise Rinceau <commandes@louiserinceau.com>', to: email, subject: '✦ Votre commande Louise Rinceau est confirmée', html }); } catch (e) {}
    }
    try {
      await resend.emails.send({
        from: 'Louise Rinceau Bot <commandes@louiserinceau.com>', to: 'contact@louiserinceau.com',
        subject: `🛒 Commande (carte cadeau) — ${realTotal.toFixed(2)} € — ${nom}`,
        html: `<p><b>Commande réglée par carte cadeau</b></p><p>Client : ${nom} (${email})<br>Adresse : ${adresse}, ${codePostal} ${ville}<br>Total : ${realTotal.toFixed(2)} €<br>Carte : ${giftCode}<br>Articles : ${items.map(i => (byId[i.id]?.nom || i.id) + (i.taille ? ' T.' + i.taille : '')).join(', ')}${commentaire ? '<br>Commentaire : ' + commentaire : ''}</p>`,
      });
    } catch (e) {}

    return res.status(200).json({ success: true, total: realTotal });

  } catch (err) {
    console.error('[confirm-gift-order]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
