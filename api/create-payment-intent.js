
// ════════════════════════════════════════
// XV3FOISRIEN — /api/create-payment-intent
// Crée un PaymentIntent Stripe et retourne
// le clientSecret au frontend.
// ════════════════════════════════════════

const Stripe = require('stripe');

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  'https://xv3foisrien.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Méthode non autorisée' });

  const { nom, email, adresse, codePostal, ville, items, subtotal, shipping, total } = req.body;

  if (!nom || !email || !items?.length || !total) {
    return res.status(400).json({ error: 'Données manquantes' });
  }

  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    // Description des articles pour le libellé Stripe
    const description = items.map(i =>
      `${i.nom}${i.taille ? ' (T.' + i.taille + ')' : ''}`
    ).join(', ');

    const paymentIntent = await stripe.paymentIntents.create({
      amount:      Math.round(total * 100),  // en centimes
      currency:    'eur',
      description: 'xv3foisrien — ' + description,
      statement_descriptor_suffix: 'XV3FOISRIEN', // libellé sur relevé bancaire (max 22 car.)
      receipt_email: email,
      metadata: {
        client_nom:    nom,
        client_email:  email,
        client_adresse: `${adresse}, ${codePostal} ${ville}`,
        // Détail des articles en JSON (utilisé par le webhook)
        items_json:    JSON.stringify(items.map(i => ({
          id:     i.id,
          nom:    i.nom,
          prix:   i.prix,
          taille: i.taille || null,
          cat:    i.cat,
        }))),
        subtotal:  String(subtotal),
        shipping:  String(shipping || 0),
        total:     String(total),
        source:    'xv3foisrien.com',
      },
      automatic_payment_methods: { enabled: true },
    });

    return res.status(200).json({ clientSecret: paymentIntent.client_secret });

  } catch (err) {
    console.error('[create-payment-intent]', err.message);
    return res.status(500).json({ error: err.message });
  }
};
