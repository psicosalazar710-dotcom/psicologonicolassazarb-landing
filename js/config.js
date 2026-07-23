/* ═══════════════════════════════════════════════════════════
   CONFIG.JS — Archivo único de datos editables del sitio
   ═══════════════════════════════════════════════════════════
   Edita AQUÍ para actualizar el sitio. No es necesario tocar
   index.html ni agendar.html para cambios de datos de contacto,
   precios, horarios, redes o textos reutilizables.

   Nota: los <meta> de SEO y el Schema.org en el <head> de
   index.html se mantienen escritos directamente en el HTML
   (no se generan por JavaScript) porque algunos rastreadores
   de buscadores no ejecutan JS de forma confiable — es la
   práctica recomendada para no arriesgar el SEO. Si cambias
   el teléfono, dirección o precios aquí, actualiza también el
   bloque <script type="application/ld+json"> en el <head>.
   ═══════════════════════════════════════════════════════════ */

const SITE_CONFIG = {

  // ── Identidad ──
  name: "Nicolás Salazar Barbosa",
  title: "Psicólogo Nicolás Salazar Barbosa",
  role: "Psicólogo Clínico",
  city: "Bogotá",

  // ── Contacto ──
  whatsappNumber: "573115725459",
  whatsappDisplay: "+57 311 572 5459",
  email: "psicosalazar710@gmail.com",
  address: "Cl. 52 #20-15",
  addressCity: "Bogotá, Colombia",
  mapsUrl: "https://www.google.com/maps/place/Psic%C3%B3logo+Nicolas+Salazar+B/@4.640207,-74.074296,17z/data=!3m1!4b1!4m6!3m5!1s0x8e3f9b9f64a057d3:0x3b05745d61814d75!8m2!3d4.6402017!4d-74.0717211!16s%2Fg%2F11z4xqnkln",

  // ── Redes ──
  instagramHandle: "@terapeuta_nicolassalazarb",
  instagramUrl: "https://www.instagram.com/terapeuta_nicolassalazarb",

  // ── Mensajes pre-armados de WhatsApp (reutilizados en Hero, CTA final y botón flotante) ──
  whatsappMessage: "Hola Nicolás, quisiera agendar una cita.",

  // ── Horario de atención (debe coincidir con calendar.php y el Schema.org del <head>) ──
  schedule: [
    { days: "Lunes a viernes", hours: "9:00 a.m. – 9:00 p.m." },
    { days: "Sábados", hours: "9:00 a.m. – 12:00 p.m." }
  ],

  // ── Modalidades y precios (deben coincidir con agendar.html) ──
  pricing: {
    presencial: 120000,
    online: 100000,
    exterior: 120000,
    currency: "COP"
  },

  // ── Cifras de autoridad — solo hechos reales, nunca inventar ──
  stats: {
    patients: "+300",
    yearsExperience: "+5",
  },

  // ── Enlace de agendamiento ──
  bookingUrl: "/agendar.html",

  // ── Google Calendar API (consumido por agendar.html) ──
  calendarApiUrl: "https://psicologonicolassalazarb.com/portal/calendar.php?action=slots",
};

/* Helper: arma el link de WhatsApp con número + mensaje codificado */
SITE_CONFIG.whatsappUrl = (msg = SITE_CONFIG.whatsappMessage) =>
  `https://wa.me/${SITE_CONFIG.whatsappNumber}?text=${encodeURIComponent(msg)}`;

/* Helper: formatea precios en pesos colombianos con separador de miles */
SITE_CONFIG.formatPrice = (n) => `$${n.toLocaleString("es-CO")} ${SITE_CONFIG.pricing.currency}`;
