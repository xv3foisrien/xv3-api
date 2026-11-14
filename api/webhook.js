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
const crypto = require('crypto');

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

const SITE      = 'https://louiserinceau.com';
const ADMIN_KEY = process.env.ADMIN_KEY || ''; // clé partagée avec le site (identique à lr-config.php sur OVH)

// Neutralise le HTML dans les textes saisis par les clients (nom, message…)
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Code cadeau lisible : LR-XXXX-XXXX (sans caractères ambigus).
// Il est calculé à partir du paiement Stripe : si Stripe renvoie deux fois la
// même notification, on retombe sur le MÊME code (jamais deux cartes pour un paiement).
function genGiftCode(paymentId) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I,O,0,1 — 32 caractères
  const h = crypto.createHmac('sha256', ADMIN_KEY || 'louise-rinceau').update(String(paymentId)).digest();
  const pick = from => Array.from({ length: 4 }, (_, i) => A[h[from + i] % 32]).join('');
  return `LR-${pick(0)}-${pick(4)}`;
}

// Email de la carte cadeau envoyé à l'acheteur
function giftCardEmailHtml(code, amount, message, buyerNom) {
  const serif = "Georgia,'Times New Roman',serif";
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FBFBFA;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#141312">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FBFBFA;padding:40px 20px"><tr><td align="center">
  <table width="100%" style="max-width:540px;background:#ffffff;border:1px solid #E7E5E2">
    <tr><td align="center" style="padding:34px 32px 20px;border-bottom:1px solid #E7E5E2">
      <img src="${SITE}/images/logo-louise-rinceau.png" alt="Louise Rinceau" height="46" style="display:block;height:46px;width:auto;margin:0 auto 12px">
      <p style="margin:0;font-family:${serif};font-size:20px;letter-spacing:.3em;text-transform:uppercase;color:#141312">Louise&nbsp;Rinceau</p>
      <p style="margin:8px 0 0;font-family:${serif};font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#8A847F">Carte cadeau · Bijoux faits main</p>
    </td></tr>
    <tr><td style="padding:34px 34px 10px;text-align:center">
      <p style="margin:0 0 6px;font-family:${serif};font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#8A847F">Votre carte cadeau</p>
      <h1 style="margin:0 0 18px;font-family:${serif};font-size:40px;font-weight:400;color:#141312">${amount}&nbsp;€</h1>
      <div style="border:1px solid #141312;padding:16px;margin:0 auto 18px;max-width:320px">
        <p style="margin:0 0 6px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8A847F">Code à utiliser au paiement</p>
        <p style="margin:0;font-family:${serif};font-size:26px;letter-spacing:.12em;color:#141312">${code}</p>
      </div>
      ${message ? `<p style="margin:0 0 18px;font-size:14px;font-style:italic;color:#55504C;line-height:1.8">« ${esc(message)} »</p>` : ''}
      <p style="margin:0 0 26px;font-size:14px;font-weight:300;line-height:1.8;color:#55504C">
        Offrez cette carte à la personne de votre choix. Au moment de régler sur
        <a href="${SITE}" style="color:#141312">louiserinceau.com</a>, il suffit de saisir le code dans le panier :
        le montant se déduit automatiquement. Utilisable en plusieurs fois jusqu'à épuisement du solde.
      </p>
      <a href="${SITE}/tous-les-bijoux.html" style="display:inline-block;font-family:${serif};font-size:12px;letter-spacing:.2em;text-transform:uppercase;background:#141312;color:#fff;text-decoration:none;padding:14px 28px;margin-bottom:10px">Découvrir les bijoux</a>
    </td></tr>
    <tr><td style="background:#FBFBFA;padding:22px 32px;border-top:1px solid #E7E5E2">
      <p style="margin:0;font-family:${serif};font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8A847F;text-align:center;line-height:1.9">
        © 2026 Louise Rinceau · Fait main à Marseille<br>17 rue du Petit Puits, 13002 Marseille · contact@louiserinceau.com
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

// Traite l'achat d'une carte cadeau : crée le code, le stocke, envoie l'email.
async function handleGiftCardPurchase(pi, meta, resend) {
  const amount = parseInt(meta.gc_amount, 10) || Math.round(pi.amount / 100);
  const email  = meta.client_email || pi.receipt_email || '';
  const nom    = meta.client_nom || '';
  const message = meta.gc_message || '';
  const code   = genGiftCode(pi.id);

  // 1. Enregistrer la carte sur le serveur
  let saved = false, saveErr = '';
  try {
    const r = await fetch(SITE + '/gift-card.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
      body: JSON.stringify({ action: 'create', code, amount, buyer_email: email, message }),
    });
    const j = r.ok ? await r.json().catch(() => null) : null;
    saved = !!(j && j.success);
    if (!saved) saveErr = 'HTTP ' + r.status;
  } catch (e) { saveErr = e.message; }
  if (!saved) console.error('[webhook] gift create error:', saveErr);

  // 2. Envoyer la carte à l'acheteur — seulement si elle est bien enregistrée
  //    (sinon le code ne fonctionnerait pas au paiement).
  if (email && saved) {
    try {
      await resend.emails.send({
        from:    'Louise Rinceau <commandes@louiserinceau.com>',
        to:      email,
        subject: `🎁 Votre carte cadeau Louise Rinceau — ${amount} €`,
        html:    giftCardEmailHtml(code, amount, message, nom),
      });
    } catch (e) { console.error('[webhook] gift email error:', e.message); }
  }

  // 3. Notifier l'artisane (avec une alerte claire si l'enregistrement a échoué)
  try {
    await resend.emails.send({
      from:    'Louise Rinceau Bot <commandes@louiserinceau.com>',
      to:      'contact@louiserinceau.com',
      subject: saved ? `🎁 Carte cadeau vendue — ${amount} € — ${code}` : `⚠️ Carte cadeau PAYÉE mais NON enregistrée — ${amount} €`,
      html:    `<p><b>${saved ? 'Carte cadeau achetée' : 'ATTENTION : le paiement est encaissé mais la carte n\'a pas pu être enregistrée sur le site (' + esc(saveErr) + '). Le client n\'a PAS reçu son code. Contactez-le.'}</b></p><p>Montant : ${amount} €<br>Code : ${code}<br>Acheteur : ${esc(nom)} (${esc(email)})<br>PaymentIntent : ${pi.id}</p>`,
    });
  } catch (e) {}

  return saved;
}

// Traite la réservation d'une initiation à l'atelier.
async function handleWorkshopBooking(pi, meta, resend) {
  const serif = "Georgia,'Times New Roman',serif";
  const qty   = parseInt(meta.ws_qty, 10) || 1;
  const total = parseInt(meta.ws_total, 10) || Math.round(pi.amount / 100);
  const email = meta.client_email || pi.receipt_email || '';
  const nom   = meta.client_nom || '';
  const dispo = meta.ws_dispo || '';
  const tel   = meta.ws_tel || '';
  const benef = meta.ws_beneficiaire || '';
  const ref   = 'AT-' + String(pi.id).slice(-6).toUpperCase();

  // 1. Enregistrer la réservation (visible dans le back-office)
  let saved = false;
  try {
    const r = await fetch(SITE + '/atelier.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
      body: JSON.stringify({ action: 'create', ref, nom, email, tel, qty, total, dispo, beneficiaire: benef }),
    });
    const j = r.ok ? await r.json().catch(() => null) : null;
    saved = !!(j && j.success);
  } catch (e) { console.error('[webhook] atelier create error:', e.message); }

  // 2. Confirmation au client (imprimable / transférable si c'est un cadeau)
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#FBFBFA;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#141312">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FBFBFA;padding:40px 20px"><tr><td align="center">
  <table width="100%" style="max-width:540px;background:#ffffff;border:1px solid #E7E5E2">
    <tr><td align="center" style="padding:34px 32px 20px;border-bottom:1px solid #E7E5E2">
      <img src="${SITE}/images/logo-louise-rinceau.png" alt="Louise Rinceau" height="46" style="display:block;height:46px;width:auto;margin:0 auto 12px">
      <p style="margin:0;font-family:${serif};font-size:20px;letter-spacing:.3em;text-transform:uppercase;color:#141312">Louise&nbsp;Rinceau</p>
      <p style="margin:8px 0 0;font-family:${serif};font-size:10px;letter-spacing:.26em;text-transform:uppercase;color:#8A847F">L'atelier · Marseille</p>
    </td></tr>
    <tr><td style="padding:34px 34px 14px;text-align:center">
      <p style="margin:0 0 6px;font-family:${serif};font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#8A847F">${benef ? 'Bon pour une initiation' : 'Réservation confirmée'}</p>
      <h1 style="margin:0 0 14px;font-family:${serif};font-size:30px;font-weight:400;color:#141312;line-height:1.2">Créez votre bague</h1>
      ${benef ? `<p style="margin:0 0 14px;font-family:${serif};font-size:17px;font-style:italic;color:#141312">Pour ${esc(benef)}</p>` : ''}
      <div style="border:1px solid #141312;padding:16px;margin:0 auto 20px;max-width:320px">
        <p style="margin:0 0 6px;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8A847F">Référence de réservation</p>
        <p style="margin:0 0 8px;font-family:${serif};font-size:24px;letter-spacing:.12em;color:#141312">${ref}</p>
        <p style="margin:0;font-size:13px;color:#55504C">${qty} participant${qty > 1 ? 's' : ''} · ${total},00 € réglés</p>
      </div>
    </td></tr>
    <tr><td style="padding:0 34px 30px">
      <div style="border-left:2px solid #141312;padding:12px 16px;margin-bottom:22px">
        <p style="margin:0;font-size:14px;font-weight:300;color:#55504C;line-height:1.8">
          <strong style="font-weight:600;color:#141312">Et maintenant ?</strong><br>
          Merci${nom ? ', ' + esc(nom) : ''} ! Nous vous écrivons très vite pour <strong style="font-weight:600;color:#141312">convenir ensemble de la date</strong> de l'initiation, selon vos disponibilités et celles de l'atelier. Prévoyez entre 2 et 3 heures sur place : vous partirez d'une cuillère ancienne pour repartir avec votre bague polie.
          ${benef ? "<br>S'il s'agit d'un cadeau, vous pouvez imprimer ou transférer cet email : la personne invitée n'aura qu'à nous communiquer la référence ci-dessus pour choisir sa date." : ''}
        </p>
      </div>
      <p style="margin:0 0 6px;font-family:${serif};font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8A847F">Le lieu</p>
      <p style="margin:0 0 20px;font-size:13px;font-weight:300;color:#55504C;line-height:1.7">Atelier Louise Rinceau<br>17 rue du Petit Puits, 13002 Marseille</p>
      <p style="margin:0;font-size:13px;font-weight:300;line-height:1.8;color:#55504C">Une question ? Écrivez-nous à <a href="mailto:contact@louiserinceau.com" style="color:#141312;font-weight:600">contact@louiserinceau.com</a> en rappelant votre référence.</p>
    </td></tr>
    <tr><td style="background:#FBFBFA;padding:22px 32px;border-top:1px solid #E7E5E2">
      <p style="margin:0;font-family:${serif};font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#8A847F;text-align:center;line-height:1.9">
        © 2026 Louise Rinceau · Fait main à Marseille<br>17 rue du Petit Puits, 13002 Marseille · contact@louiserinceau.com
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;

  if (email) {
    try {
      await resend.emails.send({
        from:    'Louise Rinceau <commandes@louiserinceau.com>',
        to:      email,
        subject: `✦ Votre initiation « Créez votre bague » est réservée — ${ref}`,
        html,
      });
    } catch (e) { console.error('[webhook] atelier email error:', e.message); }
  }

  // 3. Notifier l'artisane
  try {
    await resend.emails.send({
      from:    'Louise Rinceau Bot <commandes@louiserinceau.com>',
      to:      'contact@louiserinceau.com',
      replyTo: email || undefined,
      subject: `⚒ Nouvelle réservation atelier — ${qty} pers. — ${total} € — ${ref}`,
      html:    `<p><b>Initiation « Créez votre bague » réservée et payée</b></p>
                <p><b>Référence :</b> ${ref}<br><b>Client :</b> ${esc(nom)} (${esc(email)})${tel ? '<br><b>Téléphone :</b> ' + esc(tel) : ''}<br><b>Participants :</b> ${qty}<br><b>Payé :</b> ${total} €${benef ? '<br><b>Cadeau pour :</b> ' + esc(benef) : ''}</p>
                <p><b>Disponibilités indiquées :</b><br>${esc(dispo) || '(non précisées)'}</p>
                <p>👉 À faire : recontacter le client pour convenir de la date (répondre à cet email lui écrit directement).</p>
                ${saved ? '' : '<p style="color:#c00"><b>Note :</b> la réservation n\'a pas pu être inscrite dans le back-office (elle est bien payée). Conservez cet email.</p>'}
                <p><b>PaymentIntent :</b> ${pi.id}</p>`,
    });
  } catch (e) { console.error('[webhook] atelier notif error:', e.message); }
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

    // ── CARTE CADEAU achetée : générer le code + envoyer, puis terminer ──
    if (meta.type === 'giftcard_purchase') {
      const saved = await handleGiftCardPurchase(pi, meta, resend);
      // Si la carte n'a pas pu être enregistrée, on répond en erreur : Stripe
      // renverra la notification plus tard (même code, donc aucun doublon).
      if (!saved) return res.status(500).json({ received: false });
      return res.status(200).json({ received: true });
    }

    // ── INITIATION À L'ATELIER réservée ──
    if (meta.type === 'workshop_booking') {
      await handleWorkshopBooking(pi, meta, resend);
      return res.status(200).json({ received: true });
    }

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
    if (email) {
      try {
        await resend.emails.send({
          from:    'Louise Rinceau <commandes@louiserinceau.com>',
          to:      email,
          subject: '✦ Votre commande Louise Rinceau est confirmée',
          html:    emailHtml,
        });
      } catch (mailErr) {
        console.error('[webhook] Resend error:', mailErr.message);
      }
    }

    // ── 4. Marquer les bijoux épuisés sur le serveur ──────────
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
            'X-Admin-Key':  ADMIN_KEY,
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

    // ── 4bis. Code cadeau utilisé : décrémenter le solde de la carte ──
    if (meta.gift_code && meta.gift_discount) {
      try {
        await fetch(SITE + '/gift-card.php', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
          body: JSON.stringify({
            action: 'redeem',
            code:   meta.gift_code,
            amount: parseFloat(meta.gift_discount),
            order:  pi.id,
          }),
        });
        console.log('[webhook] Carte cadeau débitée:', meta.gift_code, meta.gift_discount);
      } catch (e) { console.error('[webhook] gift redeem error:', e.message); }
    }

    // ── 5. Notifier l'artisane ────────────────────────────────
    try {
      await resend.emails.send({
        from:    'Louise Rinceau Bot <commandes@louiserinceau.com>',
        to:      'contact@louiserinceau.com',
        subject: `🛒 Nouvelle commande — ${total} € — ${nom}`,
        html:    `<p><b>Nouvelle commande !</b></p>
                  <p><b>Client :</b> ${esc(nom)} (${esc(email)})</p>
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
