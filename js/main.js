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

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── Parallax sutil — colage de "Sobre mí" ──
   Cada marco se mueve a una velocidad ligeramente distinta al hacer scroll,
   dando sensación de profundidad por capas. Se anima el contenedor, nunca
   la imagen, para no chocar con el zoom de :hover que ya tiene la imagen. */
if (!reduceMotion) {
  const parallaxFrames = document.querySelectorAll('.about-collage .img-frame');
  if (parallaxFrames.length) {
    let ticking = false;
    const updateParallax = () => {
      const vh = window.innerHeight;
      parallaxFrames.forEach((frame, i) => {
        const rect = frame.getBoundingClientRect();
        const progress = (rect.top + rect.height / 2 - vh / 2) / vh;
        const rate = i % 2 === 0 ? 18 : -18;
        frame.style.transform = `translateY(${(progress * rate).toFixed(2)}px)`;
      });
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { requestAnimationFrame(updateParallax); ticking = true; }
    }, { passive: true });
    updateParallax();
  }
}

/* ── Cifras que crecen desde cero al entrar en pantalla ──
   Lee el valor ya aplicado por config.js (ej. "+300"), separa el
   prefijo/sufijo no numérico del número, y anima 0 → número. */
function animateCounter(el) {
  const raw = el.textContent.trim();
  const match = raw.match(/^(\D*)(\d[\d.,]*)(\D*)$/);
  if (!match) return;
  const [, prefix, numStr, suffix] = match;
  const target = parseInt(numStr.replace(/[.,]/g, ''), 10);
  if (isNaN(target)) return;
  const duration = 1300;
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = prefix + Math.round(target * eased) + suffix;
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const counterEls = document.querySelectorAll('[data-cfg="stats.patients"], [data-cfg="stats.yearsExperience"]');
if (counterEls.length && !reduceMotion) {
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCounter(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.6 });
  counterEls.forEach(el => counterObserver.observe(el));
}

/* ── Tilt 3D sutil con el cursor — solo desktop con mouse real, nunca en táctil ──
   Sigue la posición del puntero dentro del elemento y aplica una rotación
   discreta (máx. ~2.5°) con perspectiva. Al salir, vuelve a su posición
   neutra mediante la transición ya definida en CSS para [data-tilt]. */
const hasFinePointer = window.matchMedia('(pointer: fine)').matches;
if (hasFinePointer && !reduceMotion) {
  document.querySelectorAll('[data-tilt]').forEach(el => {
    const maxTilt = parseFloat(el.dataset.tilt) || 2.5;
    const keepLift = el.dataset.tiltLift !== 'false';
    const lift = keepLift ? ' translateY(-6px)' : '';
    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      const rotY = (px * maxTilt * 2).toFixed(2);
      const rotX = (-py * maxTilt * 2).toFixed(2);
      el.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg)${lift}`;
    });
    el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  });
}
