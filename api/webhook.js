// ════════════════════════════════════════
// XV3FOISRIEN — /api/webhook
// Reçoit les événements Stripe en POST.
// Valide la signature avec STRIPE_WEBHOOK_SECRET.
// Déclenche l'email de confirmation via Resend.
//
// URL à coller dans Stripe Dashboard → Webhooks :
//   https://xv3-api.vercel.app/api/webhook
//
// Événements à écouter :
//   payment_intent.succeeded
// ════════════════════════════════════════

const Stripe = require('stripe');
const { Resend } = require('resend');

// Vercel bufferise le body — on a besoin du raw buffer pour
// vérifier la signature Stripe (OBLIGATOIRE).
// Désactive le bodyParser Vercel pour lire le raw body (requis par Stripe)
module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end',  () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const stripe       = Stripe(process.env.STRIPE_SECRET_KEY);
  const resend       = new Resend(process.env.RESEND_API_KEY);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // ── 1. Lire le body brut & vérifier la signature ────────────
  let event;
  try {
    const rawBody = await getRawBody(req);
    const sig     = req.headers['stripe-signature'];

    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET manquant');
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[webhook] Signature invalide :', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ── 2. Traiter uniquement payment_intent.succeeded ──────────
  if (event.type === 'payment_intent.succeeded') {
    const pi       = event.data.object;
    const meta     = pi.metadata || {};
    const email    = meta.client_email || pi.receipt_email || '';
    const nom      = meta.client_nom   || 'Client';
    const adresse  = meta.client_adresse || '';
    const total    = (pi.amount / 100).toFixed(2).replace('.', ',');
    const shipping = meta.shipping ? parseFloat(meta.shipping).toFixed(2).replace('.', ',') : '0,00';

    let items = [];
    try { items = JSON.parse(meta.items_json || '[]'); } catch (e) {}

    const itemsHtml = items.map(i => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px">${i.nom}${i.taille ? ' — Taille ' + i.taille : ''}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:14px;text-align:right;font-weight:600">${i.prix},00 €</td>
      </tr>`).join('');

    const emailHtml = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:40px 20px">
  <tr><td align="center">
    <table width="100%" style="max-width:520px;background:#ffffff;border:1.5px solid #080808">

      <!-- Header -->
      <tr>
        <td style="background:#080808;padding:28px 32px">
          <p style="margin:0;font-size:22px;font-weight:900;letter-spacing:.18em;text-transform:uppercase;color:#ffffff">XV3foisrien</p>
          <p style="margin:4px 0 0;font-size:10px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:rgba(255,255,255,.35)">Bijoux artisanaux · Marseille</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:32px 32px 24px">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#888">Confirmation de commande</p>
          <h1 style="margin:0 0 24px;font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:-.02em;color:#080808;line-height:1.1">Merci,<br>${nom} ✦</h1>
          <p style="margin:0 0 24px;font-size:14px;font-weight:300;line-height:1.75;color:#444">
            Votre paiement a bien été reçu. Votre bijou est en cours de préparation dans notre atelier à Marseille.
            Vous recevrez un email dès l'expédition.
          </p>

          <!-- Articles -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
            <tr>
              <td colspan="2" style="font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#888;padding-bottom:8px;border-bottom:1.5px solid #080808">Votre commande</td>
            </tr>
            ${itemsHtml}
            ${parseFloat(shipping) > 0 ? `
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;color:#666">Livraison</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;text-align:right;color:#666">${shipping} €</td>
            </tr>` : `
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;color:#2a7a2a">✓ Livraison offerte</td>
              <td style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;text-align:right;color:#2a7a2a">0,00 €</td>
            </tr>`}
            <tr>
              <td style="padding:12px 0 0;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Total payé</td>
              <td style="padding:12px 0 0;font-size:18px;font-weight:900;text-align:right">${total} €</td>
            </tr>
          </table>

          <!-- Adresse -->
          <div style="background:#f5f5f4;padding:16px;margin-bottom:24px">
            <p style="margin:0 0 4px;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#888">Expédition vers</p>
            <p style="margin:0;font-size:13px;font-weight:300;color:#444;line-height:1.6">${nom}<br>${adresse}</p>
          </div>

          <!-- Délai -->
          <div style="border-left:3px solid #080808;padding:12px 16px;margin-bottom:24px">
            <p style="margin:0;font-size:13px;font-weight:300;color:#444;line-height:1.65">
              <strong style="font-weight:700">Délai de livraison :</strong> 2–5 jours ouvrés.<br>
              Chaque pièce est unique — faite main à Marseille à partir d'argenterie recyclée.
            </p>
          </div>

          <p style="margin:0;font-size:13px;font-weight:300;line-height:1.75;color:#666">
            Une question ? Écrivez-nous à
            <a href="mailto:contact@xv3foisrien.com" style="color:#080808;font-weight:600">contact@xv3foisrien.com</a><br>
            ou retrouvez-nous sur Instagram <a href="https://www.instagram.com/xv3foisrien" style="color:#080808;font-weight:600">@xv3foisrien</a>
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#f5f5f4;padding:20px 32px;border-top:1px solid #eee">
          <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#aaa;text-align:center">
            © 2026 XV3foisrien · Bijoux artisanaux · Argenterie recyclée<br>
            Créé à Paris 18ème · Atelier à Marseille
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

    // ── 3. Envoyer l'email client via Resend ──────────────────
    if (email) {
      try {
        await resend.emails.send({
          from:    'XV3foisrien <commandes@xv3foisrien.com>',
          to:      email,
          subject: '✦ Votre commande XV3foisrien est confirmée',
          html:    emailHtml,
        });
      } catch (mailErr) {
        // L'email échoue silencieusement — la commande est quand même validée
        console.error('[webhook] Resend error:', mailErr.message);
      }
    }

    // ── 4. Marquer les bijoux épuisés sur le serveur ──────────
    // Visible immédiatement sur mobile ET desktop
    try {
      const soldIds = items.map(i => i.id);

      // Lire data.json avec Origin header pour passer le CORS d'OVH
      const dataRes = await fetch('https://xv3foisrien.com/save-data.php', {
        headers: { 'Origin': 'https://xv3foisrien.com' }
      });
      if (!dataRes.ok) throw new Error('GET save-data HTTP ' + dataRes.status);
      const currentData = await dataRes.json();
      let produits = currentData.produits || null;

      if (produits && produits.length > 0) {
        produits = produits.map(p =>
          soldIds.includes(p.id) ? { ...p, epuise: true } : p
        );
        const saveRes = await fetch('https://xv3foisrien.com/save-data.php', {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Key':  'xv3_secret_2026_changez_moi',
            'Origin':       'https://xv3foisrien.com',
          },
          body: JSON.stringify({
            produits,
            settings:   currentData.settings   || null,
            categories: currentData.categories || null,
          }),
        });
        if (!saveRes.ok) throw new Error('POST save-data HTTP ' + saveRes.status);
        console.log('[webhook] Stock mis à jour pour:', soldIds.join(', '));
      }
    } catch (stockErr) {
      console.error('[webhook] Stock update error:', stockErr.message);
    }

    // ── 5. Notifier l'artisan ─────────────────────────────────
    try {
      await resend.emails.send({
        from:    'XV3foisrien Bot <commandes@xv3foisrien.com>',
        to:      'contact@xv3foisrien.com',
        subject: `🛒 Nouvelle commande — ${total} € — ${nom}`,
        html:    `<p><b>Nouvelle commande !</b></p>
                  <p><b>Client :</b> ${nom} (${email})</p>
                  <p><b>Adresse :</b> ${adresse}</p>
                  <p><b>Montant :</b> ${total} €</p>
                  <p><b>Articles :</b><br>${items.map(i => `— ${i.nom}${i.taille ? ' T.' + i.taille : ''} · ${i.prix}€`).join('<br>')}</p>
                  <p><b>PaymentIntent :</b> ${pi.id}</p>`,
      });
    } catch (mailErr) {
      console.error('[webhook] Notif artisan error:', mailErr.message);
    }
  }

  // ── 5. Répondre 200 à Stripe (obligatoire) ──────────────────
  return res.status(200).json({ received: true });
};
