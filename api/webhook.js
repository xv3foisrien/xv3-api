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

const SITE      = 'https://louiserinceau.com';
const ADMIN_KEY = 'xv3_secret_2026_changez_moi';

// Génère un code cadeau lisible : LR-XXXX-XXXX (sans caractères ambigus)
function genGiftCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I,O,0,1
  const pick = n => Array.from({ length: n }, () => A[Math.floor(Math.random() * A.length)]).join('');
  return `LR-${pick(4)}-${pick(4)}`;
}

// Email de la carte cadeau envoyé à l'acheteur
function giftCardEmailHtml(code, amount, message,
