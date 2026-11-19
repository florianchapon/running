/* Mes courses — lit data/courses.json et construit la page. */
(() => {
  'use strict';

  const DATA_URL = 'data/courses.json';
  const TYPES = {
    trail: { label: 'Trail', icon: '⛰️' },
    route: { label: 'Route', icon: '🛣️' }
  };

  const $ = (id) => document.getElementById(id);
  const grid = $('grid'), emptyEl = $('empty'), countEl = $('count'), totalsEl = $('totals');
  const modal = $('modal'), lightbox = $('lightbox');

  let courses = [];
  let filter = 'all';

  /* ---------- Utilitaires ---------- */
  const esc = (s = '') => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const fmtNum = (n, d = 0) =>
    n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

  const fmtDate = (iso, long = false) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR',
      long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
           : { day: 'numeric', month: 'short', year: 'numeric' });

  // "3:42:10" / "42:10" -> secondes
  function toSeconds(t) {
    if (!t) return null;
    const p = String(t).split(':').map(Number);
    if (p.some(isNaN)) return null;
    return p.reduce((acc, v) => acc * 60 + v, 0);
  }

  function fmtDuration(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.round(sec % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}h${pad(m)}'${pad(s)}` : `${m}'${pad(s)}`;
  }

  // secondes/km -> "5'12"
  function fmtPace(secPerKm) {
    let m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
    if (s === 60) { m += 1; s = 0; }
    return `${m}'${String(s).padStart(2, '0')}`;
  }

  /* ---------- Calculs ---------- */
  function compute(c) {
    const sec = toSeconds(c.temps);
    const out = { sec, allure: null, vap: null, vitesse: null };
    if (!sec || !c.distance_km) return out;

    out.allure = sec / c.distance_km;                    // s/km
    out.vitesse = c.distance_km / (sec / 3600);          // km/h

    if (c.vap) {                                         // valeur manuelle prioritaire (ex. "4:48")
      out.vap = toSeconds(c.vap);
    } else {
      // Estimation : 100 m D+ ≈ 1 km plat supplémentaire
      const kmEq = c.distance_km + (c.denivele_m || 0) / 100;
      out.vap = sec / kmEq;
    }
    return out;
  }

  /* ---------- Rendu ---------- */
  // Format JSON accepté : "tag": "Trail" | "Course" (ou ancien "type"), "photo" (ou "photo_principale"),
  // "photos" facultatif, "classement": "242/445",
  // "photo_alignement": "haut" | "centre" | "bas" (cadrage vertical de la photo, "centre" par défaut)
  const ALIGN = { haut: 0, top: 0, centre: 50, center: 50, milieu: 50, bas: 100, bottom: 100 };

  function normalize(c) {
    const tag = String(c.tag || c.type || '').toLowerCase();
    const photos = Array.isArray(c.photos) ? c.photos : [];
    const m = String(c.classement || '').match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
    return {
      ...c,
      type: tag.includes('trail') ? 'trail' : 'route',
      main: c.photo || c.photo_principale || photos[0] || '',
      photos,
      rank: m ? { pos: +m[1], total: +m[2] } : null,
      posY: ALIGN[String(c.photo_alignement || '').trim().toLowerCase()] ?? 50
    };
  }

  // Encode proprement les chemins avec espaces ("race pictures/ma photo.jpg"), sans double encodage
  const safeSrc = (p) => String(p).split('/').map(seg => {
    try { return encodeURIComponent(decodeURIComponent(seg)); } catch { return encodeURIComponent(seg); }
  }).join('/');

  const fmtKm = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 });

  function imgOrPlaceholder(src, alt, type, posY = 50) {
    const icon = TYPES[type]?.icon || '🏃';
    if (!src) return `<div class="ph">${icon}</div>`;
    // En cas d'erreur de chargement, l'écouteur global ci-dessous remplace l'image par le placeholder
    return `<img src="${esc(safeSrc(src))}" alt="${esc(alt)}" loading="lazy" data-ph="${esc(icon)}" style="object-position:50% ${posY}%">`;
  }

  // Photo introuvable : placeholder (cartes / en-tête) ou suppression (galerie)
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.ph !== undefined) {
      const ph = document.createElement('div');
      ph.className = 'ph';
      ph.textContent = img.dataset.ph;
      img.replaceWith(ph);
    } else if (img.dataset.gallery !== undefined) {
      img.closest('button')?.remove();
    }
  }, true);

  function renderTotals() {
    const km = courses.reduce((a, c) => a + (c.distance_km || 0), 0);
    const dp = courses.reduce((a, c) => a + (c.denivele_m || 0), 0);
    const items = [
      [courses.length, 'courses'],
      [fmtNum(km, 0) + ' km', 'parcourus'],
      [fmtNum(dp, 0) + ' m', 'de D+']
    ];
    totalsEl.innerHTML = items.map(([v, l]) =>
      `<div class="total"><b>${v}</b><small>${l}</small></div>`).join('');
  }

  function render() {
    const list = courses
      .filter(c => filter === 'all' || c.type === filter)
      .sort((a, b) => b.date.localeCompare(a.date));      // plus récent en haut

    grid.innerHTML = '';
    emptyEl.hidden = list.length > 0;
    countEl.textContent = `${list.length} course${list.length > 1 ? 's' : ''}`;

    let lastYear = null;
    for (const c of list) {
      const year = c.date.slice(0, 4);
      if (year !== lastYear) {
        grid.insertAdjacentHTML('beforeend', `<h2 class="year">${year}</h2>`);
        lastYear = year;
      }
      const k = compute(c);
      const card = document.createElement('button');
      card.className = 'card';
      card.type = 'button';
      card.dataset.type = c.type;
      card.innerHTML = `
        <div class="card__img">
          ${imgOrPlaceholder(c.main, c.nom, c.type, c.posY)}
          <span class="badge">${TYPES[c.type]?.label || esc(c.type)}</span>
          <span class="card__date">${fmtDate(c.date)}</span>
        </div>
        <div class="card__body">
          <h3>${esc(c.nom)}</h3>
          <p class="card__place">📍 ${esc(c.lieu || '')}</p>
          <div class="mini">
            <div><b>${fmtKm(c.distance_km)} km</b><small>Distance</small></div>
            <div><b>${c.denivele_m != null ? fmtNum(c.denivele_m) + ' m' : '—'}</b><small>D+</small></div>
            <div><b>${k.sec ? fmtDuration(k.sec) : '—'}</b><small>Temps</small></div>
          </div>
        </div>`;
      card.addEventListener('click', () => openModal(c));
      grid.appendChild(card);
    }
  }

  /* ---------- Fiche détail ---------- */
  function stat(value, unit, label) {
    return `<div class="stat"><b>${value}${unit ? `<i>${unit}</i>` : ''}</b><small>${label}</small></div>`;
  }

  function openModal(c) {
    const k = compute(c);
    modal.dataset.type = c.type;
    const hero = $('m-hero');
    hero.innerHTML = imgOrPlaceholder(c.main, c.nom, c.type, c.posY);
    // Clic sur la photo principale = plein écran
    hero.classList.toggle('is-zoomable', !!c.main);
    hero.onclick = () => {
      const img = hero.querySelector('img');
      if (!img) return;
      $('l-img').src = img.src;
      lightbox.showModal();
    };
    $('m-type').textContent = TYPES[c.type]?.label || c.type;
    $('m-title').textContent = c.nom;
    $('m-meta').textContent = `📍 ${c.lieu || ''} · ${fmtDate(c.date, true)}`;

    $('m-stats').innerHTML = [
      stat(fmtKm(c.distance_km), 'km', 'Distance'),
      c.denivele_m != null ? stat(fmtNum(c.denivele_m), 'm', 'Dénivelé +') : '',
      k.sec ? stat(fmtDuration(k.sec), '', 'Temps') : '',
      c.rank ? stat(c.rank.pos, '/ ' + c.rank.total, 'Classement') : '',
      k.allure ? stat(fmtPace(k.allure), '/km', 'Allure moy.') : '',
      k.vap ? stat(fmtPace(k.vap), '/km', 'VAP') : '',
      k.vitesse ? stat(fmtNum(k.vitesse, 1), 'km/h', 'Vitesse moy.') : ''
    ].join('');

    $('m-notes').textContent = c.notes || '';

    const link = $('m-link');
    if (c.lien) {
      link.href = c.lien;
      link.textContent = (c.lien_label || 'Voir l’évènement') + ' ↗';
      link.hidden = false;
    } else link.hidden = true;

    const photos = c.photos || [];
    $('m-gallery').innerHTML = photos.map((p, i) =>
      `<button type="button" data-i="${i}"><img src="${esc(safeSrc(p))}" alt="${esc(c.nom)} — photo ${i + 1}" loading="lazy" data-gallery></button>`
    ).join('');
    $('m-gallery').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $('l-img').src = safeSrc(photos[+b.dataset.i]);
      lightbox.showModal();
    };

    modal.showModal();
    modal.scrollTop = 0;
  }

  /* ---------- Événements ---------- */
  document.querySelector('.filters').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    filter = b.dataset.filter;
    document.querySelectorAll('.chip').forEach(x => {
      const on = x === b;
      x.classList.toggle('is-active', on);
      x.setAttribute('aria-selected', on);
    });
    render();
  });

  $('m-close').addEventListener('click', () => modal.close());
  $('l-close').addEventListener('click', () => lightbox.close());
  // clic en dehors = fermeture
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });
  lightbox.addEventListener('click', (e) => { if (e.target !== $('l-img')) lightbox.close(); });

  /* ---------- Chargement ---------- */
  fetch(DATA_URL)
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => { courses = data.map(normalize); renderTotals(); render(); })
    .catch(err => {
      emptyEl.hidden = false;
      emptyEl.textContent = 'Impossible de charger data/courses.json (' + err.message +
        '). En local, lance un petit serveur : python3 -m http.server';
    });
})();
