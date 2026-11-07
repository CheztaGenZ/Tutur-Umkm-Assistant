/* Animasi reveal saat elemen masuk viewport. Tanpa JS, konten tetap tampil. */
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function splitWords(root) {
  const text = root.textContent.trim().replace(/\s+/g, ' ');
  if (!text) return;
  root.textContent = '';
  const parts = text.split(' ');
  parts.forEach((word, index) => {
    const span = document.createElement('span');
    span.className = 'word';
    span.textContent = word;
    span.style.animationDelay = `${index * 55}ms`;
    root.appendChild(span);
    if (index < parts.length - 1) root.appendChild(document.createTextNode(' '));
  });
}

if (!prefersReduced) {
  document.querySelectorAll('[data-split]').forEach(splitWords);

  const elements = [...document.querySelectorAll('[data-reveal]')];
  const viewport = window.innerHeight || 800;

  for (const el of elements) {
    const top = el.getBoundingClientRect().top;
    if (top > viewport * 0.92) {
      el.classList.add('will-reveal');
    } else {
      el.classList.add('is-visible');
    }
  }

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          entry.target.classList.remove('will-reveal');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    for (const el of elements) {
      if (el.classList.contains('will-reveal')) observer.observe(el);
    }
  }

  // Cadangan: sebagian browser menunda IntersectionObserver di tab latar.
  const revealInView = () => {
    const height = window.innerHeight || 800;
    for (const el of elements) {
      if (!el.classList.contains('will-reveal')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.top < height * 0.95 && rect.bottom > 0) {
        el.classList.add('is-visible');
        el.classList.remove('will-reveal');
      }
    }
  };
  const schedule = () => revealInView();
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  revealInView();
  setTimeout(revealInView, 400);

  // Parallax ringan untuk gambar latar.
  const parallax = [...document.querySelectorAll('[data-parallax]')];
  if (parallax.length) {
    const move = () => {
      const height = window.innerHeight || 800;
      for (const el of parallax) {
        const rect = el.parentElement.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > height) continue;
        const progress = (rect.top + rect.height / 2 - height / 2) / height;
        el.style.transform = `translate3d(0, ${Math.round(progress * 42)}px, 0)`;
      }
    };
    move();
    window.addEventListener('scroll', move, { passive: true });
    window.addEventListener('resize', move);
  }
} else {
  for (const el of elements) el.classList.add('is-visible');
}
