/*
 * Original code-drawn vectors for the Grey Crow notebook art lab.
 * No external artwork, icon set, font glyphs, or drawing libraries are used.
 * Shared 48-unit canvas; deliberately few, weighty marks remain legible at 24px.
 */
(function exposeNotebookLabIcons(global) {
  'use strict';

  const strokeWidth = 2.6;
  const gearOutline = Array.from({ length: 8 }, (_, tooth) =>
    [[-18, 14], [-10, 18.5], [10, 18.5], [18, 14]].map(([offset, radius]) => {
      const angle = (-90 + tooth * 45 + offset) * Math.PI / 180;
      return `${(24 + Math.cos(angle) * radius).toFixed(2)},${(24 + Math.sin(angle) * radius).toFixed(2)}`;
    }).join(' ')
  ).join(' ');

  const drawings = Object.freeze({
    // A standing body, with relaxed arms; no life meter or combat symbol.
    state: `
      <path d="M19 10c0-3.3 2-5 5-5s5 1.7 5 5v2c0 3.2-2.1 5.5-5 5.5s-5-2.3-5-5.5Z"/>
      <path d="m18 20-4 3-4 10c-.7 2 1.6 3.5 3 1.8l4.5-7.2L18 33l-1 9h5l2-9 2 9h5l-1-9 .5-5.4 4.5 7.2c1.4 1.7 3.7.2 3-1.8l-4-10-4-3"/>
      <path d="M21 23h6" stroke-width="2.2"/>
    `,

    // Two outward-facing profiles: their noses and staggered shoulders survive reduction.
    characters: `
      <path d="M23 9c-1.6-1.8-3.8-2.8-6.1-2.8-5.1 0-8 3.9-8 8.6L5 21l4 1v4c0 2 1.1 3 3.7 3H15v4c-5.2 1.4-7.5 4.6-8 8h9"/>
      <path d="M24 35v-3c-3-2-4.5-5.5-4.5-9.5 0-5.5 3.7-9.5 9.2-9.5 5.2 0 8.7 3.6 8.7 9l4.1 6-4 1v3c0 2.2-1.3 3.5-4 3.5H32v2c4.7.7 7.3 2.1 9 4.5H20c.3-3 1.4-5.6 4-7Z"/>
      <path d="M33 23h.2M12.5 16h.2" stroke-width="3.4"/>
    `,

    // A metal clip grips the sheet; the folded corner distinguishes it from a book.
    modules: `
      <path d="M18 11h-7v31h27V19l-8-8h-3"/>
      <path d="M30 11v8h8"/>
      <path d="M18 7h9v9h-9Z" fill="currentColor" stroke="none"/>
      <path d="M20 7V5h5v2" stroke-width="2.2"/>
      <path d="M17 24h9M17 30h14M17 36h10"/>
    `,

    // An offset second page and a solid ribbon, without miniature text decoration.
    chapters: `
      <path d="M30 6H8v31"/>
      <path d="M14 11h24v31H14Z"/>
      <path d="M26 11h7v15l-3.5-3-3.5 3Z" fill="currentColor" stroke="none"/>
      <path d="M20 32h12M20 37h8"/>
    `,

    // A broad eyelid and dark pupil read as observation even without the small accents.
    observe: `
      <path d="M5 25c4.8-7.2 11.1-11 19-11s14.2 3.8 19 11c-5.1 6.9-11.5 10.4-19 10.4S10.1 31.9 5 25Z"/>
      <path d="M5 25c4.8-7.2 11.1-11 19-11s14.2 3.8 19 11" stroke-width="3.2"/>
      <circle cx="24" cy="24.5" r="7"/>
      <circle cx="24" cy="24.5" r="3" fill="currentColor" stroke="none"/>
      <path d="m10 12 2 2M36 14l2-2" stroke-width="2.2"/>
    `,

    // Three broad folded planes; one destination mark instead of tiny roads or lettering.
    map: `
      <path d="m6 12 12-5 12 5 12-5v30l-12 5-12-5-12 5Z"/>
      <path d="M18 7v30M30 12v30"/>
      <circle cx="36" cy="19" r="2.5" fill="currentColor" stroke="none"/>
      <path d="m35 25-2 4M11 28l3-4" stroke-width="2.2"/>
    `,

    // A soft bag, wide flap and single clasp keep the silhouette distinct from the papers.
    backpack: `
      <path d="M19 11V9c0-3 2-4 5-4s5 1 5 4v2"/>
      <path d="M15 12h18c2.5 0 4 5 4 9v17c0 2.6-1.4 4-4 4H15c-2.6 0-4-1.4-4-4V21c0-4 1.5-9 4-9Z"/>
      <path d="M11 21c7.8 4.7 18.2 4.7 26 0M11 24H7v11h4M37 24h4v11h-4"/>
      <path d="M17 32h14v6H17Z" stroke-width="2.2"/>
      <path d="M22 22h4v7h-4Z" fill="currentColor" stroke="none"/>
    `,

    // Eight broad cut teeth, a generous opening, and no fine spokes.
    settings: `
      <polygon points="${gearOutline}"/>
      <circle cx="24" cy="24" r="6.5" stroke-width="3"/>
    `,

    // A single index card with three short projecting tabs, rather than stacked chapter pages.
    index: `
      <path d="M10 6h24v4h6v8h-6v3h9v8h-9v3h5v8h-5v2H10Z"/>
      <path d="M16 14h11M16 25h11M16 36h8"/>
    `,
  });

  function escapeAttribute(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  /** Returns decorative SVG markup, or an empty string for an unknown icon name. */
  function markup(name, opts = {}) {
    if (!Object.prototype.hasOwnProperty.call(drawings, name)) return '';
    const options = opts && typeof opts === 'object' ? opts : {};
    const size = typeof options.size === 'number' && Number.isFinite(options.size) && options.size > 0
      ? options.size : 48;
    const classAttribute = options.className ? ` class="${escapeAttribute(options.className)}"` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${classAttribute}>${drawings[name]}</svg>`;
  }

  // Individual paper objects for the live reading study. The original ink SVG
  // API above remains unchanged for the earlier comparison and Blender prints.
  // Every object below is original code artwork: no new image/font dependency.
  let objectSequence = 0;

  /** A separate, resolution-independent wrapper around each physical object. */
  function objectMarkup(name, opts = {}) {
    if (!Object.prototype.hasOwnProperty.call(drawings, name)) return '';
    const size = Number.isFinite(opts.size) && opts.size > 0 ? opts.size : 48;
    const classAttribute = opts.className ? ` class="${escapeAttribute(opts.className)}"` : '';
    const common = `width="${size}" height="${size}" aria-hidden="true" focusable="false" data-object-icon="${name}"${classAttribute}`;
    const id = `notebook-object-${name}-${++objectSequence}`;
    const defs = `<defs>
      <linearGradient id="${id}-metal" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="var(--object-metal-light,#b1a28a)"/><stop offset=".5" stop-color="var(--object-metal,#85725b)"/><stop offset="1" stop-color="var(--object-metal-edge,#605342)"/></linearGradient>
      <linearGradient id="${id}-paper" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="var(--object-paper-light,#e8deca)"/><stop offset="1" stop-color="var(--object-paper,#bcae94)"/></linearGradient>
      <linearGradient id="${id}-leather" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="var(--object-leather-light,#54493b)"/><stop offset="1" stop-color="var(--object-leather,#302b25)"/></linearGradient>
      <pattern id="${id}-grain" width="3.1" height="2.7" patternUnits="userSpaceOnUse"><circle cx=".7" cy=".6" r=".23" fill="#151b15" opacity=".22"/><path d="m1.7 1.7.65-.12" stroke="#faf5dc" stroke-width=".25" opacity=".4"/></pattern>
    </defs>`;
    const edge = 'var(--object-paper-edge,#8c7a5e)';
    const ink = 'var(--object-print,#443a2d)';
    const faint = 'var(--object-print-soft,#806c51)';
    const white = 'var(--object-paper-light,#e8deca)';
    const paper = (outline, content = '', extra = '') => `
      <path d="${outline}" fill="var(--object-thickness,#76634c)" transform="translate(.2 1.25)"/>
      <path d="${outline}" fill="url(#${id}-paper)" stroke="${edge}" stroke-width=".7" stroke-linejoin="round"/>
      <path d="${outline}" fill="url(#${id}-grain)" opacity=".46"/>
      ${extra}${content}`;
    const print = (content, width = 1.5) => `<g fill="none" stroke="${ink}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${content}</g>`;
    const fibre = `<path d="m12 37 5 .3m13-22 4-.3M15 9l3 .3" fill="none" stroke="${faint}" stroke-width=".4" opacity=".28"/>`;
    const bodies = {
      // Full-body condition drawing on a punched record tag; no health meter.
      state: paper('M15 5h18l6 6-1 30-3 2H11L9 39V11Z', `
        <path d="M13 12h23M13 38h7m10 0h5" stroke="${faint}" stroke-width=".65" opacity=".6"/>
        <circle cx="24" cy="17" r="3.8" fill="${ink}"/>
        <path d="m20 23-4.5 6 2 1.4 3-3.7-.2 5.7-2 7.2h3.5l2.2-6.7 2.2 6.7h3.5l-2-7.2-.2-5.7 3 3.7 2-1.4-4.5-6Z" fill="${ink}"/>
        <path d="M20 24h7.5" stroke="${white}" stroke-width=".5" opacity=".55"/>
        <circle cx="24" cy="8.5" r="1.5" fill="var(--object-thickness,#76634c)" stroke="${white}" stroke-width=".65"/>
        <path d="M23.5 8C18 5 19 2.5 23 3s5.7 3 1.7 5" fill="none" stroke="url(#${id}-metal)" stroke-width="1.2"/>
        ${fibre}`),
      // A portrait, ruled caption and small clip distinguish it from the body tag.
      characters: paper('M8 8 38 6 40 41 10 43Z', `
        <path d="m12 13 22-1 1 23-22 1Z" fill="var(--object-photo-paper,#d0c0a4)" stroke="${faint}" stroke-width=".65"/>
        <path d="M22.6 15c-3.3.3-5.5 2.8-5.2 6.1.2 2.5 1.5 4.3 3.6 5.2-4.8 1-6.6 3.7-6.7 6.4l17-1c-.7-2.8-2.9-5.1-7.1-5.4 2.1-1.2 3-3.3 2.8-5.9-.2-3.2-1.8-5.6-4.4-5.4Z" fill="${ink}"/>
        <path d="m15 36 17-1M15 39l10-.5" stroke="${faint}" stroke-width=".75"/>
        <path d="m28 5 .6 10c.2 3.2 4.4 2.9 4.2-.2l-.5-9c-.2-2-3-1.9-2.9.2l.4 7" fill="none" stroke="var(--object-thickness,#76634c)" stroke-width="1.5" transform="translate(.4 .5)"/>
        <path d="m28 5 .6 10c.2 3.2 4.4 2.9 4.2-.2l-.5-9c-.2-2-3-1.9-2.9.2l.4 7" fill="none" stroke="url(#${id}-metal)" stroke-width="1"/>
        ${fibre}`),
      // The envelope remains recognisable before the smaller inserted notes.
      modules: `<path d="m12 6 22 2-2 29-22-2Z" fill="var(--object-paper,#bcae94)" stroke="${edge}" stroke-width=".7"/>
        <path d="m17 6 20 5-6 23-20-5Z" fill="${white}" stroke="${edge}" stroke-width=".7"/>
        <path d="m19 12 11 3m-12 1 8 2" stroke="${faint}" stroke-width=".75"/>
        ${paper('M5 17 42 18 41 41 5 40Z', `
          <path d="m5.5 18 18 13 18-12.5" fill="none" stroke="${ink}" stroke-width="1.15"/>
          <path d="m5.5 39 12-13m24 14L29 27" fill="none" stroke="${faint}" stroke-width=".9"/>
          <path d="m6.5 18.7 17 13 17-12" fill="none" stroke="${white}" stroke-width=".5" opacity=".65"/>
          <path d="m8 35 3 .2m23 1 4 .1" stroke="${faint}" stroke-width=".45" opacity=".35"/>`)}`,
      // Visible leaves, a crease and ribbon make this a book, not a dark case.
      chapters: `<path d="M3 12c6-3 14-2 21 1 8-4 14-4 21-2l-.5 29c-8-1-13.5-.5-20.5 3-7-3-13.5-3-21-.5Z" fill="var(--object-thickness,#76634c)"/>
        ${paper('M4 10c6-2 13-1 20 3 8-4 14-4 20-2l-.5 27c-8-1-13.5-.5-19.5 3-6.5-3-12.5-3.5-20-1.5Z', `
          <path d="M24 13v27" stroke="${edge}" stroke-width="2"/>
          <path d="M25.2 14v24" stroke="${white}" stroke-width=".7"/>
          <path d="m8 17 11 2m-11 3 11 2m-11 3 11 2m-11 3 9 1m12-15 11-2m-11 7 11-2m-11 7 11-2m-11 7 7-1" fill="none" stroke="${faint}" stroke-width="1.05"/>
          <path d="m29 11 4-1v25l-2-2-2 3Z" fill="var(--object-ribbon,#98735a)"/>
          <path d="M5 37c6-1 12 0 18 2m3 0c6-2.5 11-3 17-2" fill="none" stroke="${white}" stroke-width=".55"/>
        `)}`,
      // A large printed eye on a worn observation ticket; the iris is not glass.
      observe: paper('M5 12 42 11 44 34 39 37 6 36 4 32Z', `
        ${print('<path d="M8 25c4.5-6 10-8.8 16-8.8S35.5 19 40 25c-5 5.8-10.3 8-16 8S12.8 30.8 8 25Z"/>', 1.7)}
        <circle cx="24" cy="24.5" r="6.1" fill="${ink}"/>
        <circle cx="24" cy="24.5" r="2.4" fill="${white}"/>
        <path d="m11 15 2 .2m21 19 3-.2" stroke="${faint}" stroke-width=".6"/>
        <path d="m39 33 4 1-4 3Z" fill="var(--object-paper,#bcae94)" stroke="${edge}" stroke-width=".5"/>
        `),
      // Alternating folded planes carry one route and an ink destination stamp.
      map: paper('M5 12 17 7 30 12 42 7 43 37 30 42 18 37 6 42Z', `
        <path d="m17 7 13 5v30l-12-5Z" fill="var(--object-fold,#ac9b80)" opacity=".58"/>
        <path d="M17 8v28m13-23v28" stroke="${edge}" stroke-width=".85"/>
        <path d="M18 9v26m13-21v25" stroke="${white}" stroke-width=".55" opacity=".7"/>
        <path d="m10 32 7-10 10 7 10-10" fill="none" stroke="${ink}" stroke-width="1.9" stroke-dasharray="2.4 2" stroke-linecap="round"/>
        <path d="M36 12c-3.3 0-5.5 2.4-5.5 5.2 0 3.9 5.5 9 5.5 9s5.5-5.1 5.5-9c0-2.8-2.2-5.2-5.5-5.2Z" fill="${ink}"/>
        <circle cx="36" cy="17" r="1.8" fill="${white}"/>
        <path d="m9 15 4-1m21 20 4-1" stroke="${faint}" stroke-width=".55"/>
        `),
      // A broad luggage label with a dark printed rucksack and a twine eyelet.
      backpack: paper('M13 6h22l6 7-2 29H9L8 13Z', `
        <circle cx="24" cy="9.5" r="1.5" fill="var(--object-thickness,#76634c)" stroke="${white}" stroke-width=".6"/>
        <path d="M24 9c-5-5-4-7-.5-7.2 4-.2 6 2 1 7" fill="none" stroke="url(#${id}-metal)" stroke-width="1.1"/>
        <path d="M20 19v-2c0-5 9-5 9 0v2" fill="none" stroke="${ink}" stroke-width="2.5"/>
        <path d="M16 18h17l3 7-1 14H14l-1-14Z" fill="${ink}"/>
        <path d="M13 27h-3v9h4m22-9h3v9h-4" fill="${ink}"/>
        <path d="m15 22 9 5 10-5M18 32h13v5H18Z" fill="none" stroke="${white}" stroke-width="1.15"/>
        <path d="M22 25h4v5h-4Z" fill="${white}"/>
        <path d="m12 39 3 .2m17 0h3" stroke="${faint}" stroke-width=".5"/>
        `),
      // A printed gear on a small paper washer; no polished chrome counterpart.
      settings: paper('M24 4 31 6 36 5 42 12 41 18 44 24 41 31 41 37 35 41 29 41 23 44 17 41 11 41 6 35 7 29 4 23 7 17 7 11 13 7 18 7Z', `
        <g transform="translate(24 24) scale(.77) translate(-24 -24)"><polygon points="${gearOutline}" fill="${ink}"/>
        <circle cx="24" cy="24" r="9" fill="${white}"/><circle cx="24" cy="24" r="5.5" fill="url(#${id}-metal)"/>
        <path d="m21 27 6-6" stroke="${ink}" stroke-width="1.5"/></g>
        <path d="m13 10 3-.5m18 26 3-1" stroke="${faint}" stroke-width=".5" opacity=".5"/>
        `),
      // This accepted three-tab index object is intentionally retained verbatim.
      index: `
      <path d="m11 9 23-2 5 34-25 3Z" fill="#242b25" opacity=".5"/>
      <g transform="rotate(-5 24 25)"><path d="M11 8h24v4h6v7h-6v22H11Z" fill="#8d8c7a" stroke="#5d5a4c" stroke-width=".7"/><path d="M13 7h21v34H13Z" fill="var(--object-paper,#bcae94)"/></g>
      <g transform="rotate(3 24 25)"><path d="M11 10h24v10h6v7h-6v15H11Z" fill="#b9a581" stroke="#746f5c" stroke-width=".7"/><path d="M12 10h21v31H12Z" fill="var(--object-paper-light,#e8deca)"/></g>
      <path d="M10 11h24v20h6v7h-6v5H10Z" fill="url(#${id}-paper)" stroke="#747767" stroke-width=".7"/>
      <path d="M10.7 12h22.6v30H10.7Z" fill="url(#${id}-grain)"/>
      <path d="M11 12h22M11 12v29" fill="none" stroke="var(--object-paper-light,#e8deca)" stroke-width=".55" opacity=".55"/>
      <path d="M15 20h13M15 26h13M15 32h9" stroke="var(--object-lettering,#695a46)" stroke-width=".7" opacity=".8"/>
      <path d="M17 12V7c0-3 6-3 6 0v10c0 2.5-4 2.5-4 0V8" fill="none" stroke="#252c25" stroke-width="1.7" transform="translate(.6 .6)"/>
      <path d="M17 12V7c0-3 6-3 6 0v10c0 2.5-4 2.5-4 0V8" fill="none" stroke="url(#${id}-metal)" stroke-width="1.15"/>
      <path d="m29 39 4 3v-4" fill="#b9ae94" stroke="#b3aa92" stroke-width=".4"/>`
    };
    const body = bodies[name];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" ${common}>${defs}${body}</svg>`;
  }

  global.NotebookLabIcons = Object.freeze({
    markup,
    objectMarkup,
    metadata: Object.freeze({
      names: Object.freeze(Object.keys(drawings)),
      original: true,
      objectProvenance: 'Original layered SVG paper-object family. The approved index object is retained; eight companion objects share paper, print and restrained metal response. No external artwork, font or raster dependency.',
      provenance: 'Original SVG code authored for the Grey Crow notebook art lab; no external assets or libraries.',
      viewBox: '0 0 48 48',
      strokeWidth,
      recommendedSizes: Object.freeze([24, 32, 38]),
      color: 'currentColor',
    }),
  });
})(window);
