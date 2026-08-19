// ─── NAV SCROLL EFFECT ────────────────────────────────────────────
const nav = document.getElementById('main-nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 40);
}, { passive: true });

// ─── HAMBURGER MENU ───────────────────────────────────────────────
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobile-menu');
hamburger.addEventListener('click', () => {
  const open = mobileMenu.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', open);
  mobileMenu.setAttribute('aria-hidden', !open);
});
// Close mobile menu on link click
mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    mobileMenu.setAttribute('aria-hidden', 'true');
  });
});

// ─── FAQ ACCORDION ────────────────────────────────────────────────
document.querySelectorAll('.faq-q').forEach(btn => {
  btn.addEventListener('click', () => {
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    // Close all
    document.querySelectorAll('.faq-q').forEach(b => {
      b.setAttribute('aria-expanded', 'false');
      const answerId = b.getAttribute('aria-controls');
      document.getElementById(answerId).hidden = true;
    });
    // Open clicked (if it was closed)
    if (!expanded) {
      btn.setAttribute('aria-expanded', 'true');
      const answerId = btn.getAttribute('aria-controls');
      document.getElementById(answerId).hidden = false;
    }
  });
});

// ─── FOOTER YEAR ──────────────────────────────────────────────────
document.getElementById('year').textContent = new Date().getFullYear();

// ─── CTA FORM HANDLER ─────────────────────────────────────────────
async function handleCtaSubmit() {
  const schoolInput = document.getElementById('cta-school');
  const emailInput = document.getElementById('cta-email');
  const phoneInput = document.getElementById('cta-phone');
  const btn = document.getElementById('cta-submit-btn');
  const countdownDisplay = document.getElementById('cta-countdown');

  const school = (schoolInput.value || '').trim();
  const email = (emailInput.value || '').trim();
  const phone = (phoneInput.value || '').trim().replace(/\s+/g, '');

  // Validate all fields
  let valid = true;

  if (!school) {
    schoolInput.style.borderColor = '#EF4444';
    valid = false;
  } else {
    schoolInput.style.borderColor = '';
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    emailInput.style.borderColor = '#EF4444';
    valid = false;
  } else {
    emailInput.style.borderColor = '';
  }

  if (!phone || phone.length < 9) {
    phoneInput.style.borderColor = '#EF4444';
    valid = false;
  } else {
    phoneInput.style.borderColor = '';
  }

  if (!valid) {
    if (!school) schoolInput.focus();
    else if (!email) emailInput.focus();
    else phoneInput.focus();
    return;
  }

  btn.textContent = 'Sending…';
  btn.disabled = true;

  // Show countdown display
  countdownDisplay.style.display = 'block';
  let secondsRemaining = 60;
  countdownDisplay.textContent = `Wait: ${secondsRemaining}s Render is booting...`;

  // Set timeout to reset button after 60 seconds
  const MAX_WAIT = 60000;
  const waitTimeout = setTimeout(() => {
    btn.textContent = '❌ Try Again';
    btn.disabled = false;
    countdownDisplay.style.display = 'none';
  }, MAX_WAIT);

  try {
    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school, email, phone })
    });

    if (!res.ok) throw new Error('Request failed');

    // CRITICAL: Clear the timeout if request succeeded before 60s
    clearTimeout(waitTimeout);
    countdownDisplay.style.display = 'none';

    btn.textContent = '✅ Request Sent!';
    schoolInput.value = '';
    emailInput.value = '';
    phoneInput.value = '';
  } catch {
    // Also clear timeout on error
    clearTimeout(waitTimeout);
    countdownDisplay.style.display = 'none';
    btn.textContent = '❌ Try Again';
  } finally {
    // If timeout already fired (request took > 60s), the button state
    // is already "❌ Try Again" / hidden, so nothing needs to happen here.
    // If the request succeeded before 60s, the clearTimeout above already
    // fired, so the button stays "✅ Request Sent!" and countdown is hidden.
  }
}

// ─── INTERSECTION OBSERVER: ANIMATE ON SCROLL ─────────────────────
const observerOptions = { threshold: 0.1, rootMargin: '0px 0px -40px 0px' };
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

// Add initial hidden state via JS so non-JS users see content
const animatables = document.querySelectorAll(
  '.feature-card, .portal-card, .step, .price-card, .faq-item'
);
animatables.forEach((el, i) => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(28px)';
  el.style.transition = `opacity 0.55s ease ${i * 0.07}s, transform 0.55s ease ${i * 0.07}s`;
  observer.observe(el);
});

document.addEventListener('animationend', () => {}, { once: true });

// Visible class handler
document.head.insertAdjacentHTML('beforeend', `<style>
  .visible { opacity: 1 !important; transform: translateY(0) !important; }
</style>`);

// ─── TRUST BAR DUPLICATE FOR INFINITE SCROLL ──────────────────────
const trustLogos = document.querySelector('.trust-logos');
if (trustLogos) {
  trustLogos.innerHTML += trustLogos.innerHTML;
}