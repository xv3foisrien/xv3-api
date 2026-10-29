// ════════════════════════════════════════
// LOUISE RINCEAU — /api/webhook
// Reçoit les événements Stripe en POST.
// Valide la signature avec STRIPE_WEBHOOK_SECRET.
// Déclenche l'email de confirmation via Resend.
//
// URL à coller dans Stripe Dashboard → Webhooks :
//   https://xv3-api-z22c.vercel.app/api/webhook
//
// Événements à écouter :
//   payment_intent.succeeded
// ════════════════════════════════════════

const Stripe = require('stripe');
const { Resend } = require('resend');

// Vercel bufferise le body — on a besoin du raw buffer pour
// vérifier la signature Stripe (OBLIGATOIRE).
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

  const stripe        = Stripe(process.env.STRIPE_SECRET_KEY);
  const resend        = new Resend(process.env.RESEND_API_KEY);
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

    const serif = "Georgia,'Times New Roman',serif";

    const itemsHtml = items.map(i => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #E7E5E2;font-size:14px;color:#55504C">${i.nom}${i.taille ? ' — Taille ' + i.taille : ''}</td>
        <td style="padding:10px 0;border-bottom:1px solid #E7E5E2;font-size:14px;text-align:right;font-family:${serif};color:#141312">${i.prix},00 €</td>
      </tr>`).join('');

    const emailHtml = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FBFBFA;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#141312">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FBFBFA;padding:40px 20px">
  <tr><td align="center">
    <table width="100%" style="max-width:540px;background:#ffffff;border:1px solid #E7E5E2">

      <!-- Header -->
      <tr>
        <td align="center" style="padding:34px 32px 26px;border-bottom:1px solid #E7E5E2">
          <img src="https://louiserinceau.com/images/logo-louise-rinceau.png" alt="Louise Rinceau" height="48" style="display:block;height:48px;width:auto;margin:0 auto 12px">
          <p style="margin:0;font-family:${serif};font-size:20px;font-weight:400;letter-spacing:.3em;text-transform:uppercase;color:#141312">Louise&nbsp;Rinceau</p>
          <p style="margin:8px 0 0;font-family:${serif};font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#8A847F">Bijoux faits main · Marseille</p>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:34px 34px 26px">
          <p style="margin:0 0 10px;font-family:${serif};font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#8A847F">Confirmation de commande</p>
          <h1 style="margin:0 0 22px;font-family:${serif};font-size:28px;font-weight:400;letter-spacing:.02em;color:#141312;line-height:1.15">Merci, ${nom} ✦</h1>
          <p style="margin:0 0 26px;font-size:14px;font-weight:300;line-height:1.8;color:#55504C">
            Votre paiement a bien été reçu. Votre bijou est en cours de préparation dans notre atelier à Marseille.
            Vous recevrez un email dès l'expédition.
          </p>

          <!-- Articles -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px">
            <tr>
              <td colspan="2" style="font-family:${serif};font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:#8A847F;padding-bottom:10px;border-bottom:1px solid #141312">Votre commande</td>
            </tr>
            ${itemsHtml}
            ${parseFloat(shipping) > 0 ? `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #E7E5E2;font-size:13px;color:#55504C">Livraison</td>
              <td style="padding:10px 0;border-bottom:1px solid #E7E5E2;font-size:13px;text-align:right;color:#55504C">${shipping} €</td>
            </tr>` : `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #E7E5E2;font-size:13px;color:#1a7a36">✓ Livraison offerte</td>
              <td style="padding:10px 0;border-bottom:1px solid #E7E5E2;font-size:13px;text-align:right;color:#1a7a36">0,00 €</td>
            </tr>`}
            <tr>
              <td style="padding:14px 0 0;font-family:${serif};font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:#141312">Total payé</td>
              <td style="padding:14px 0 0;font-family:${serif};font-size:18px;text-align:right;color:#141312">${total} €</td>
            </tr>
          </table>

          <!-- Adresse -->
          <div style="background:#FBFBFA;border:1px solid #E7E5E2;padding:16px;margin-bottom:24px">
            <p style="margin:0 0 6px;font-family:${serif};font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8A847F">Expédition vers</p>
            <p style="margin:0;font-size:13px;font-weight:300;color:#55504C;line-height:1.6">${nom}<br>${adresse}</p>
          </div>

          <!-- Délai -->
          <div style="border-left:2px solid #141312;padding:12px 16px;margin-bottom:24px">
            <p style="margin:0;font-size:13px;font-weight:300;color:#55504C;line-height:1.7">
              <strong style="font-weight:600;color:#141312">Délai de préparation :</strong> 5 à 10 jours ouvrés avant expédition (variable selon les créations en cours).<br>
              Chaque pièce est unique — faite main à Marseille à partir d'argenterie ancienne.
            </p>
          </div>

          <p style="margin:0;font-size:13px;font-weight:300;line-height:1.8;color:#55504C">
            Une question ? Écrivez-nous à
            <a href="mailto:contact@louiserinceau.com" style="color:#141312;font-weight:600;text-decoration:none;border-bottom:1px solid #8A847F">contact@louiserinceau.com</a><br>
            ou retrouvez-nous sur Instagram <a href="https://www.instagram.com/louiserinceau" style="color:#141312;font-weight:600;text-decoration:none;border-bottom:1px solid #8A847F">@louiserinceau</a>
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="background:#FBFBFA;padding:22px 32px;border-top:1px solid #E7E5E2">
          <p style="margin:0;font-family:${serif};font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8A847F;text-align:center;line-height:1.9">
            © 2026 Louise Rinceau · Bijoux artisanaux · Argenterie ancienne<br>
            17 rue du Petit Puits, 13002 Marseille
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

    // ── 3. Envoyer l'email client via Resend ──────────────────
    // ⚠️ L'adresse d'envoi doit être sur un domaine VÉRIFIÉ dans Resend.
    //    Tant que louiserinceau.com n'est pas vérifié dans Resend, on
    //    envoie depuis xv3foisrien.com (déjà vérifié) mais le nom affiché
    //    est "Louise Rinceau". Une fois louiserinceau.com vérifié dans
    //    Resend, remplace l'adresse par : Louise Rinceau <commandes@louiserinceau.com>
    if (email) {
      try {
        await resend.emails.send({
          from:    'Louise Rinceau <commandes@xv3foisrien.com>',
          to:      email,
          subject: '✦ Votre commande Louise Rinceau est confirmée',
          html:    emailHtml,
        });
      } catch (mailErr) {
        console.error('[webhook] Resend error:', mailErr.message);
      }
    }

    // ── 4. Marquer les bijoux épuisés sur le serveur ──────────
    // On pointe vers louiserinceau.com (évite la redirection 301 de
    // xv3foisrien.com qui casserait le POST).
    try {
      const soldIds = items.map(i => i.id);

      const dataRes = await fetch('https://louiserinceau.com/save-data.php', {
        headers: { 'Origin': 'https://louiserinceau.com' }
      });
      if (!dataRes.ok) throw new Error('GET save-data HTTP ' + dataRes.status);
      const currentData = await dataRes.json();
      let produits = currentData.produits || null;

      if (produits && produits.length > 0) {
        produits = produits.map(p => {
          if (!soldIds.includes(p.id)) return p;
          // Les pièces AVEC stock sont décrémentées côté site (mark-sold.php) :
          // on ne les touche pas ici pour éviter un double décompte.
          if (p.stock !== undefined && p.stock !== null) return p;
          // Pièces uniques (sans stock) : filet de sécurité → marquer épuisé.
          return { ...p, epuise: true };
        });
        const saveRes = await fetch('https://louiserinceau.com/save-data.php', {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Key':  'xv3_secret_2026_changez_moi',
            'Origin':       'https://louiserinceau.com',
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

    // ── 5. Notifier l'artisane ────────────────────────────────
    try {
      await resend.emails.send({
        from:    'Louise Rinceau Bot <commandes@xv3foisrien.com>',
        to:      'contact@louiserinceau.com',
        subject: `🛒 Nouvelle commande — ${total} € — ${nom}`,
        html:    `<p><b>Nouvelle commande !</b></p>
                  <p><b>Client :</b> ${nom} (${email})</p>
                  <p><b>Adresse :</b> ${adresse}</p>
                  <p><b>Montant :</b> ${total} €</p>
                  <p><b>Articles :</b><br>${items.map(i => `— ${i.nom}${i.taille ? ' T.' + i.taille : ''} · ${i.prix}€`).join('<br>')}</p>
                  <p><b>PaymentIntent :</b> ${pi.id}</p>`,
      });
    } catch (mailErr) {
      console.error('[webhook] Notif artisane error:', mailErr.message);
    }
  }

  // ── 6. Répondre 200 à Stripe (obligatoire) ──────────────────
  return res.status(200).json({ received: true });
};
