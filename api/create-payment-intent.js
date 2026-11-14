// ════════════════════════════════════════
// LOUISE RINCEAU — /api/create-payment-intent
// Crée un PaymentIntent Stripe et renvoie le clientSecret.
// Gère aussi :
//   • l'achat d'une CARTE CADEAU (req.body.giftCard)
//   • la réservation d'une INITIATION à l'atelier (req.body.workshop)
//   • l'utilisation d'un CODE CADEAU sur une commande (req.body.giftCode)
//     → la remise est TOUJOURS recalculée côté serveur (anti-fraude)
// ════════════════════════════════════════

const Stripe = require('stripe');

const SITE     = 'https://louiserinceau.com';
const WORKSHOP_PRICE = 130; // € par personne — initiation « Créez votre bague »

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

    // ═══════════════ CAS 1 bis : INITIATION À L'ATELIER ═══════════════
    if (req.body.workshop) {
      const { nom, email } = req.body;
      const w   = req.body.workshop || {};
      const qty = Math.min(4, Math.max(1, parseInt(w.qty, 10) || 1));
      if (!nom || !email) {
        return res.status(400).json({ error: 'Nom et email requis' });
      }
      // Les réservations peuvent être fermées depuis le back-office.
      try {
        const r = await fetch(SITE + '/save-data.php?t=' + Date.now());
        const d = r.ok ? await r.json() : null;
        if (d && d.settings && d.settings.atelierOuvert === false) {
          return res.status(409).json({ error: 'Les réservations sont momentanément fermées', closed: true });
        }
      } catch (e) { /* site injoignable : on ne bloque pas la réservation */ }
