const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'assets');

// Kubernetes brand blue
const K8S_BLUE = '#326CE5';
const K8S_BLUE_DARK = '#1E4DB7';

// ---------- helpers ----------
function heptagon(cx, cy, r, rotDeg = -90) {
  const pts = [];
  for (let i = 0; i < 7; i++) {
    const a = ((rotDeg + (i * 360) / 7) * Math.PI) / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
const ptsToPath = (pts) =>
  'M' + pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') + 'Z';

// ---------- Kubernetes helm wheel ----------
// Drawn in white, centred on (cx, cy) with outer radius r.
function helmWheel(cx, cy, r, color = '#ffffff', strokeRatio = 1) {
  const sw = r * 0.085 * strokeRatio; // stroke width
  const outer = heptagon(cx, cy, r, -90);
  const spokeTips = heptagon(cx, cy, r * 0.82, -90); // where spokes meet rim
  const hubR = r * 0.16;
  const hub = heptagon(cx, cy, hubR, -90);

  let s = `<g fill="none" stroke="${color}" stroke-linejoin="round" stroke-linecap="round">`;
  // outer rim
  s += `<path d="${ptsToPath(outer)}" stroke-width="${sw}"/>`;
  // spokes from hub to rim tips
  for (const [x, y] of spokeTips) {
    s += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(2)}" y2="${y.toFixed(
      2
    )}" stroke-width="${(sw * 0.78).toFixed(2)}"/>`;
  }
  s += `</g>`;
  // hub (filled)
  s += `<path d="${ptsToPath(hub)}" fill="${color}"/>`;
  // little dot in the hub centre, cut-out look using background — keep simple white hub
  return s;
}

// ---------- Captain's peaked cap ----------
// Centred horizontally on cx, baseline (bottom of visor) around by. Width = w.
function captainHat(cx, by, w) {
  const u = w / 2; // half width unit
  const x = (v) => (cx + v * u).toFixed(2);
  const y = (v) => (by + v * u).toFixed(2); // v in same unit scale

  const white = '#FFFFFF';
  const shadow = '#D7E3FB';
  const visor = '#10172A';
  const visorHi = '#27324d';
  const gold = '#F4C430';
  const goldDark = '#C8930A';

  let s = '';

  // ---- crown (rounded dome on top) ----
  s += `<path d="
    M ${x(-0.92)} ${y(-0.18)}
    C ${x(-0.95)} ${y(-0.62)}, ${x(-0.45)} ${y(-0.92)}, ${x(0)} ${y(-0.92)}
    C ${x(0.45)} ${y(-0.92)}, ${x(0.95)} ${y(-0.62)}, ${x(0.92)} ${y(-0.18)}
    Z" fill="${white}"/>`;

  // subtle shading on crown bottom edge
  s += `<path d="
    M ${x(-0.92)} ${y(-0.18)}
    C ${x(-0.6)} ${y(-0.34)}, ${x(0.6)} ${y(-0.34)}, ${x(0.92)} ${y(-0.18)}
    L ${x(0.92)} ${y(-0.05)}
    C ${x(0.6)} ${y(-0.2)}, ${x(-0.6)} ${y(-0.2)}, ${x(-0.92)} ${y(-0.05)}
    Z" fill="${shadow}" opacity="0.55"/>`;

  // ---- band (the dark/white strap above the visor) ----
  s += `<path d="
    M ${x(-0.95)} ${y(-0.18)}
    C ${x(-0.6)} ${y(-0.06)}, ${x(0.6)} ${y(-0.06)}, ${x(0.95)} ${y(-0.18)}
    L ${x(0.95)} ${y(0.16)}
    C ${x(0.6)} ${y(0.28)}, ${x(-0.6)} ${y(0.28)}, ${x(-0.95)} ${y(0.16)}
    Z" fill="${white}"/>`;
  // band lower shadow line
  s += `<path d="
    M ${x(-0.95)} ${y(0.05)}
    C ${x(-0.6)} ${y(0.17)}, ${x(0.6)} ${y(0.17)}, ${x(0.95)} ${y(0.05)}
    L ${x(0.95)} ${y(0.16)}
    C ${x(0.6)} ${y(0.28)}, ${x(-0.6)} ${y(0.28)}, ${x(-0.95)} ${y(0.16)}
    Z" fill="${shadow}" opacity="0.6"/>`;

  // ---- visor / peak (black, curved, wider than band) ----
  s += `<path d="
    M ${x(-1.04)} ${y(0.12)}
    C ${x(-0.7)} ${y(0.26)}, ${x(0.7)} ${y(0.26)}, ${x(1.04)} ${y(0.12)}
    C ${x(0.96)} ${y(0.52)}, ${x(0.55)} ${y(0.7)}, ${x(0)} ${y(0.7)}
    C ${x(-0.55)} ${y(0.7)}, ${x(-0.96)} ${y(0.52)}, ${x(-1.04)} ${y(0.12)}
    Z" fill="${visor}"/>`;
  // visor highlight
  s += `<path d="
    M ${x(-0.92)} ${y(0.18)}
    C ${x(-0.6)} ${y(0.29)}, ${x(0.6)} ${y(0.29)}, ${x(0.92)} ${y(0.18)}
    C ${x(0.86)} ${y(0.3)}, ${x(0.5)} ${y(0.4)}, ${x(0)} ${y(0.4)}
    C ${x(-0.5)} ${y(0.4)}, ${x(-0.86)} ${y(0.3)}, ${x(-0.92)} ${y(0.18)}
    Z" fill="${visorHi}" opacity="0.8"/>`;

  // ---- gold badge / anchor on the band ----
  const bcx = cx;
  const bcy = by - 0.04 * u;
  const br = 0.2 * u;
  // badge disc
  s += `<circle cx="${bcx.toFixed(2)}" cy="${bcy.toFixed(2)}" r="${br.toFixed(
    2
  )}" fill="${gold}" stroke="${goldDark}" stroke-width="${(br * 0.12).toFixed(
    2
  )}"/>`;
  // simple anchor
  const ax = (v) => (bcx + v * br).toFixed(2);
  const ay = (v) => (bcy + v * br).toFixed(2);
  s += `<g stroke="${goldDark}" stroke-width="${(br * 0.16).toFixed(
    2
  )}" stroke-linecap="round" fill="none">
    <circle cx="${ax(0)}" cy="${ay(-0.62)}" r="${(br * 0.14).toFixed(
    2
  )}" fill="${goldDark}" stroke="none"/>
    <line x1="${ax(0)}" y1="${ay(-0.45)}" x2="${ax(0)}" y2="${ay(0.55)}"/>
    <line x1="${ax(-0.34)}" y1="${ay(-0.18)}" x2="${ax(0.34)}" y2="${ay(
    -0.18
  )}"/>
    <path d="M ${ax(-0.5)} ${ay(0.2)} C ${ax(-0.5)} ${ay(0.6)}, ${ax(
    -0.1
  )} ${ay(0.62)}, ${ax(0)} ${ay(0.55)} C ${ax(0.1)} ${ay(0.62)}, ${ax(
    0.5
  )} ${ay(0.6)}, ${ax(0.5)} ${ay(0.2)}"/>
  </g>`;

  return s;
}

// ---------- Compose a full SVG ----------
// scale ~ how much of the canvas the artwork fills (1 = edge to edge logo area)
function buildSVG(size, { background, logoScale = 1, centerVertically = false }) {
  const cx = size / 2;
  // helm wheel
  const helmR = size * 0.27;
  const helmCy = size * 0.62;
  // hat
  const hatW = size * 0.62;
  const hatBy = size * 0.34; // baseline of visor

  let bg = '';
  if (background === 'gradient') {
    bg = `<rect width="${size}" height="${size}" fill="url(#bgg)"/>`;
  } else if (background) {
    bg = `<rect width="${size}" height="${size}" fill="${background}"/>`;
  }

  // Artwork roughly spans y from hatBy-0.55*hatW to helmCy+helmR; centre it for adaptive icons.
  const artTop = hatBy - 0.55 * hatW;
  const artBottom = helmCy + helmR;
  const artCy = (artTop + artBottom) / 2;
  const dy = centerVertically ? cx - artCy : 0;

  const artwork = `${helmWheel(cx, helmCy, helmR)}\n  ${captainHat(cx, hatBy, hatW)}`;
  const grouped = `<g transform="translate(${cx} ${cx + dy}) scale(${logoScale}) translate(${-cx} ${-cx})">${artwork}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bgg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${K8S_BLUE}"/>
      <stop offset="1" stop-color="${K8S_BLUE_DARK}"/>
    </linearGradient>
  </defs>
  ${bg}
  ${grouped}
</svg>`;
}

// monochrome: white silhouette on transparent (android), content inside safe zone
function buildMonoSVG(size) {
  const cx = size / 2;
  const helmR = size * 0.24 * 0.66;
  const helmCy = size * 0.5 + size * 0.12 * 0.66;
  const hatW = size * 0.56 * 0.66;
  const hatBy = size * 0.5 - size * 0.14 * 0.66;
  // flatten every colour in the hat to solid white
  const hat = captainHat(cx, hatBy, hatW).replace(
    /(fill|stroke)="#[0-9A-Fa-f]{6}"/g,
    '$1="#ffffff"'
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${helmWheel(cx, helmCy, helmR, '#ffffff')}
  ${hat}
</svg>`;
}

async function render(svg, file, size, { flatten = false } = {}) {
  let img = sharp(Buffer.from(svg)).resize(size, size);
  // iOS app icons / favicons must be fully opaque (no alpha channel).
  if (flatten) img = img.flatten({ background: K8S_BLUE });
  await img.png().toFile(path.join(OUT, file));
  console.log('wrote', file, size);
}

(async () => {
  // Main app icon: full-bleed gradient background
  await render(buildSVG(1024, { background: 'gradient', logoScale: 1 }), 'icon.png', 1024, { flatten: true });

  // Splash icon: self-contained on the gradient so it stays visible on any splash bg
  await render(
    buildSVG(1024, { background: 'gradient', logoScale: 0.82, centerVertically: true }),
    'splash-icon.png',
    1024
  );

  // Favicon
  await render(buildSVG(48, { background: 'gradient', logoScale: 1 }), 'favicon.png', 48, { flatten: true });

  // Android adaptive foreground: artwork inside the ~66% safe zone, transparent bg
  await render(
    buildSVG(512, { background: null, logoScale: 0.7, centerVertically: true }),
    'android-icon-foreground.png',
    512
  );

  // Android adaptive background: solid gradient
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K8S_BLUE}"/><stop offset="1" stop-color="${K8S_BLUE_DARK}"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/></svg>`,
    'android-icon-background.png',
    512
  );

  // Android monochrome: white silhouette inside safe zone
  await render(buildMonoSVG(432), 'android-icon-monochrome.png', 432);
})();
