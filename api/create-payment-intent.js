// ════════════════════════════════════════
// LOUISE RINCEAU — /api/create-payment-intent
// Crée un PaymentIntent Stripe et renvoie le clientSecret.
// Gère aussi :
//   • l'achat d'une CARTE CADEAU (req.body.giftCard)
//   • l'utilisation d'un CODE CADEAU sur une commande (req.body.giftCode)
//     → la remise est TOUJOURS recalculée côté serveur (anti-fraude)
// ════════════════════════════════════════

const Stripe = require('stripe');

const SITE     = 'https://louiserinceau.com';
const ADMIN_KEY = 'xv3_secret_2026_changez_moi';

// Vérifie un code cadeau côté serveur et renvoie son solde réel.
async function checkGiftCard(code) {
  try {
    const r = await fetch(SITE + '/gift-card.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'check', code }),
    });
    if (!r.ok) return { valid: false };
    return await r.json();
  } catch (e) {
    return { valid: false, error: e.message };
  }
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

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // ═══════════════ CAS 1 : ACHAT D'UNE CARTE CADEAU ═══════════════
    if (req.body.giftCard) {
      const { nom, email } = req.body;
      const amount  = Math.round(parseFloat(req.body.giftCard.amount) || 0);
      const message = (req.body.giftCard.message || '').slice(0, 300);
      if (!email || amount < 10 || amount > 1000) {
        return res.status(400).json({ error: 'Carte cadeau invalide (10 € à 1000 €, email requis)' });
      }
      const pi = await stripe.paymentIntents.create({
        amount:   amount * 100,
        currency: 'eur',
        description: `Carte cadeau Louise Rinceau — ${amount} €`,
        statement_descriptor_suffix: 'LOUISERINCEAU',
        receipt_email: email,
        metadata: {
          type:         'giftcard_purchase',
          gc_amount:    String(amount),
          gc_message:   message,
          client_nom:   nom || '',
          client_email: email,
          source:       'louiserinceau.com',
        },
        automatic_payment_methods: { enabled: true },
      });
      return res.status(200).json({ clientSecret: pi.client_secret });
    }

    // ═══════════════ CAS 2 : COMMANDE NORMALE ═══════════════
    const { nom, email, adresse, codePostal, ville, items, subtotal, shipping, total, giftCode } = req.body;
    if (!nom || !email || !items?.length || total === undefined) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const baseTotal = Math.round((parseFloat(total) || 0) * 100); // centimes
    let payable     = baseTotal;
    let giftInfo    = null;

    // ── Code cadeau : remise recalculée côté serveur ──
    if (giftCode) {
      const gc = await checkGiftCard(giftCode);
      if (!gc.valid) {
        return res.status(400).json({ error: 'Code cadeau invalide ou épuisé', giftInvalid: true });
      }
      const balanceCents  = Math.round(parseFloat(gc.balance) * 100);
      const discountCents = Math.min(balanceCents, baseTotal); // ne dépasse jamais le total
      payable  = baseTotal - discountCents;
      giftInfo = { code: gc.code, discount: discountCents };
    }

    const description = items.map(i => `${i.nom}${i.taille ? ' (T.' + i.taille + ')' : ''}`).join(', ');
    const metaBase = {
      client_nom:    nom,
      client_email:  email,
      client_adresse: `${adresse}, ${codePostal} ${ville}`,
      items_json: JSON.stringify(items.map(i => ({ id: i.id, nom: i.nom, prix: i.prix, taille: i.taille || null, cat: i.cat }))),
      subtotal: String(subtotal),
      shipping: String(shipping || 0),
      total:    String(total),
      source:   'louiserinceau.com',
      commentaire: (req.body.commentaire || '').slice(0, 400),
    };
    if (giftInfo) {
      metaBase.gift_code     = giftInfo.code;
      metaBase.gift_discount = (giftInfo.discount / 100).toFixed(2);
    }

    // ── Commande entièrement couverte par la carte cadeau ──
    // Stripe ne peut pas encaisser moins de 0,50 € : on signale au site
    // de finaliser la commande gratuitement via /api/confirm-gift-order.
    if (giftInfo && payable < 50) {
      return res.status(200).json({
        freeOrder: true,
        giftCode:  giftInfo.code,
        discount:  (giftInfo.discount / 100).toFixed(2),
      });
    }

    const pi = await stripe.paymentIntents.create({
      amount:   payable,
      currency: 'eur',
      description: 'Louise Rinceau — ' + description,
      statement_descriptor_suffix: 'LOUISERINCEAU',
      receipt_email: email,
      metadata: metaBase,
      automatic_payment_methods: { enabled: true },
    });

    return res.status(200).json({
      clientSecret: pi.client_secret,
      giftApplied:  giftInfo ? (giftInfo.discount / 100).toFixed(2) : null,
    });

  } catch (err) {
    console.error('[create-payment-intent]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
