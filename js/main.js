/* ── Aplicar datos centralizados de config.js ──
   Cualquier elemento con data-cfg="clave" recibe el valor de SITE_CONFIG.
   Por defecto reemplaza el texto; con data-cfg-attr="href" (u otro atributo)
   escribe ese atributo en su lugar. Así, cambiar un número de WhatsApp,
   un enlace o un precio se hace una sola vez en config.js. */
if (typeof SITE_CONFIG !== 'undefined') {
  document.querySelectorAll('[data-cfg]').forEach(el => {
    const key = el.dataset.cfg;
    const attr = el.dataset.cfgAttr;
    let value;
    if (key === 'whatsappUrl') value = SITE_CONFIG.whatsappUrl();
    else value = key.split('.').reduce((o, k) => (o ? o[k] : undefined), SITE_CONFIG);
    if (value === undefined) return;
    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  });
}

const nav = document.getElementById('main-nav');
const progress = document.getElementById('scrollProgress');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
  const h = document.documentElement;
  const pct = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100;
  progress.style.width = pct + '%';
}, { passive: true });

const ham = document.getElementById('hamburger'), mob = document.getElementById('mobile-menu');
ham.addEventListener('click', () => {
  const isOpen = ham.classList.toggle('open');
  mob.classList.toggle('open');
  ham.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
});
mob.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
  ham.classList.remove('open'); mob.classList.remove('open');
  ham.setAttribute('aria-expanded', 'false');
}));

const navLinks = document.querySelectorAll('#navLinks a[data-target]');
const sections = document.querySelectorAll('section[id]');
const spy = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinks.forEach(a => a.classList.toggle('active', a.dataset.target === entry.target.id));
    }
  });
}, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
sections.forEach(s => spy.observe(s));

const revealer = new IntersectionObserver((entries) => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal:not(.visible)').forEach(el => revealer.observe(el));

document.querySelectorAll('.video-frame').forEach(frame => {
  const video = frame.querySelector('video');
  const btn = frame.querySelector('.play-btn');
  btn.addEventListener('click', () => {
    frame.classList.add('playing');
    video.setAttribute('controls', '');
    video.play();
  });
  video.addEventListener('pause', () => { if (video.currentTime === 0) frame.classList.remove('playing'); });
  video.addEventListener('ended', () => { frame.classList.remove('playing'); video.removeAttribute('controls'); });
});
