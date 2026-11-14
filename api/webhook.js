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
      <p style="margin:0 0
