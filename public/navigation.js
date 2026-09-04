// Explore and taxonomy share the collection section. Remember the user's
// selected view there, while keeping the separate sources section in sync.
export function createSectionNavigation(onNavigate) {
  const links = [...document.querySelectorAll('[data-nav]')];
  const targets = { explore: 'catalog', taxonomy: 'taxonomy', sources: 'sources' };
  let collectionView = 'explore';
  let destination = null;
  let frame = 0;

  function activate(view) {
    for (const link of links) {
      const selected = link.dataset.nav === view;
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }

  function targetOffset(view) {
    const target = document.getElementById(targets[view]);
    const header = document.querySelector('.site-header').offsetHeight;
    const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    return Math.min(maximum, Math.max(0, target.getBoundingClientRect().top + scrollY - header - 24));
  }

  function syncScroll() {
    frame = 0;
    if (document.querySelector('dialog[open]')) return;
    // Do not overwrite a click while smooth scrolling through another section.
    if (destination) {
      if (Math.abs(scrollY - targetOffset(destination)) > 3) return;
      destination = null;
    }
    const header = document.querySelector('.site-header').offsetHeight;
    const sources = document.getElementById('sources').getBoundingClientRect();
    const collection = document.getElementById('catalog').getBoundingClientRect();
    const atBottom = scrollY + innerHeight >= document.documentElement.scrollHeight - 3;
    if (sources.top <= header + 48 || (atBottom && sources.top < innerHeight - 80)) {
      activate('sources');
    } else {
      activate(collection.top > innerHeight / 2 ? 'explore' : collectionView);
    }
  }

  function scheduleSync() {
    if (!frame) frame = requestAnimationFrame(syncScroll);
  }

  function go(view, { updateHash = true } = {}) {
    if (view === 'taxonomy') {
      document.getElementById('filters').classList.add('open');
      document.querySelector('[data-action="filters"]').setAttribute('aria-expanded', 'true');
    }
    if (view !== 'sources') collectionView = view;
    destination = view;
    activate(view);
    const hash = '#' + targets[view];
    if (updateHash && location.hash !== hash) history.pushState(null, '', hash);
    onNavigate(hash);
    window.scrollTo({
      top: targetOffset(view),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
    scheduleSync();
  }

  function syncFromHash() {
    const view = Object.keys(targets).find(key => location.hash === '#' + targets[key]);
    if (view) go(view, { updateHash: false });
    else scheduleSync();
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const view = Object.keys(targets).find(key => link.getAttribute('href') === '#' + targets[key]);
    if (!view) return;
    event.preventDefault();
    go(view);
  });

  window.addEventListener('scroll', scheduleSync, { passive: true });
  window.addEventListener('resize', scheduleSync);
  window.addEventListener('scrollend', scheduleSync);
  const userScroll = () => { destination = null; scheduleSync(); };
  window.addEventListener('wheel', userScroll, { passive: true });
  window.addEventListener('touchstart', userScroll, { passive: true });
  window.addEventListener('keydown', event => {
    if (!/input|textarea|select/i.test(event.target.tagName) &&
        ['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) userScroll();
  });
  return { go, syncFromHash };
}
