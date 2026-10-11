// Illustrated stand-ins for evidence in the demo project: receipts, slips,
// delivery and site photos, bank transfer screenshots and documents. Every
// image carries a "SAMPLE" watermark; suppliers and people are fictional.
//
// What this file does: each exported function returns the text of an SVG
// image (SVG = an XML-based vector picture format browsers can display). The
// pictures are built by gluing strings together with template literals.
// Why it exists: the demo seed (seed/demo.js) needs realistic-looking
// receipts and photos to attach to records without shipping real images.
// Depends on: nothing; pure string building. A seeded random generator keeps
// each picture identical between runs.
// Note: SVG markup lives inside backtick strings, so it is explained by the
// comments above each expression rather than inside the markup.

// Escape text for safe use inside SVG/XML: replace &, < and > with entities.
// `String(s)` converts any value to text; `.replace(/&/g, ...)` uses a regex
// with the `g` (global) flag to replace every occurrence, chained three times.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// Format rupees, e.g. 120000 → "Rs 120,000"; toLocaleString adds separators.
const money = (r) => `Rs ${Math.round(r).toLocaleString('en-PK')}`
// An SVG attribute string reused for fonts. Inside the double-quoted JS string,
// `\"` is an escaped double quote character.
const FONT = "font-family=\"'Segoe UI', Arial, sans-serif\""

// A small seeded pseudo-random number generator: the same seed always gives
// the same sequence, so demo images never change between runs. It returns a
// function; each call gives a number from 0 (inclusive) to 1 (exclusive).
function rng(seed) {
  // Hash the seed text into a 32-bit number (FNV-1a style): spread the string
  // into characters (`[...String(seed)]`), then `.reduce` folds them into one
  // number starting from 2166136261. `^` is bitwise XOR, `Math.imul` is 32-bit
  // integer multiply, and `>>> 0` forces an unsigned 32-bit result.
  let a = [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261)
  // Return a closure: an inner function that remembers and updates `a`.
  // The body is the "mulberry32" mixing algorithm.
  return () => {
    // Advance the state by a constant (0x... is a hexadecimal number).
    a = (a + 0x6d2b79f5) >>> 0
    // Scramble the bits: `>>>` shifts right, `|` is bitwise OR.
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    // `^=` means t = t ^ (...).
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    // Final mix, then divide by 2^32 to get a fraction between 0 and 1.
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Big faint diagonal "SAMPLE" text across the middle of a W × H image.
// An arrow function whose body (on the next line) is a single template literal.
const watermark = (w, h) =>
  `<text x="${w / 2}" y="${h / 2}" ${FONT} font-size="${Math.round(w / 7)}" font-weight="700" fill="#000" fill-opacity="0.06" text-anchor="middle" transform="rotate(-24 ${w / 2} ${h / 2})">SAMPLE</text>`

// Camera-style date and GPS stamp in the bottom-right corner. `where` has a
// default value (a fictional Lahore coordinate). Two literals joined by `+`.
const stamp = (w, h, when, where = '31.4697°N 74.4089°E') =>
  `<g ${FONT} font-size="15" font-weight="600"><rect x="${w - 330}" y="${h - 44}" width="318" height="30" rx="6" fill="#000" fill-opacity="0.45"/>` +
  `<text x="${w - 171}" y="${h - 24}" fill="#ffd36b" text-anchor="middle">${esc(when)} · ${where}</text></g>`

// Wrap body markup in the outer <svg> element with the given size.
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

/** Printed shop receipt photographed on a counter. */
// Exported; takes one object, destructured, with a default address.
export function receipt({ supplier, address = 'Main Road, Lahore', invoice, date, lines, seed }) {
  // Random generator seeded by `seed`, or the invoice number when no seed (`??`).
  const r = rng(seed ?? invoice)
  const W = 720 // image width
  const H = 900 // image height
  // One table row per line item: description, quantity, rate, amount, each
  // placed 42px lower than the previous (y = 330 + i * 42). `.join('')`
  // concatenates the rows with nothing between them.
  const rows = lines
    .map((l, i) => {
      const y = 330 + i * 42
      return `<text x="80" y="${y}">${esc(l.description)}</text><text x="400" y="${y}" text-anchor="end">${l.qty.toLocaleString('en-PK')}</text>` +
        `<text x="500" y="${y}" text-anchor="end">${l.rate.toLocaleString('en-PK')}</text><text x="620" y="${y}" text-anchor="end">${Math.round(l.qty * l.rate).toLocaleString('en-PK')}</text>`
    })
    .join('')
  // Sum of qty × rate over all lines.
  const total = lines.reduce((n, l) => n + l.qty * l.rate, 0)
  // Random tilt between -2 and +2 degrees; `.toFixed(2)` gives 2 decimals as text.
  const tilt = (r() * 4 - 2).toFixed(2)
  // The paper, built from many concatenated pieces, in order: tilted group and
  // white paper with shadow; shop name and address; dashed line; invoice
  // number and date; column headings; rule line plus the item rows; total
  // line and TOTAL amount (positions depend on the number of lines); footer
  // text; and a blue round "RECEIVED" rubber stamp.
  const paper =
    `<g transform="rotate(${tilt} ${W / 2} ${H / 2})"><rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="#fffdf6" filter="url(#s)"/>` +
    `<g ${FONT} fill="#2b2b2b" font-size="22">` +
    `<text x="${W / 2}" y="120" text-anchor="middle" font-size="34" font-weight="700">${esc(supplier)}</text>` +
    `<text x="${W / 2}" y="156" text-anchor="middle" font-size="19" fill="#666">${esc(address)} · 0300-0000000</text>` +
    `<line x1="80" y1="190" x2="${W - 80}" y2="190" stroke="#999" stroke-dasharray="6 6"/>` +
    `<text x="80" y="232">Invoice: <tspan font-weight="700">${esc(invoice ?? '—')}</tspan></text><text x="${W - 80}" y="232" text-anchor="end">Date: ${esc(date)}</text>` +
    `<g font-size="18" fill="#777" font-weight="600"><text x="80" y="285">ITEM</text><text x="400" y="285" text-anchor="end">QTY</text><text x="500" y="285" text-anchor="end">RATE</text><text x="620" y="285" text-anchor="end">AMOUNT</text></g>` +
    `<line x1="80" y1="300" x2="${W - 80}" y2="300" stroke="#bbb"/>${rows}` +
    `<line x1="80" y1="${340 + lines.length * 42}" x2="${W - 80}" y2="${340 + lines.length * 42}" stroke="#333" stroke-width="2"/>` +
    `<text x="80" y="${384 + lines.length * 42}" font-weight="700" font-size="26">TOTAL</text><text x="620" y="${384 + lines.length * 42}" text-anchor="end" font-weight="700" font-size="26">${money(total)}</text>` +
    `<text x="${W / 2}" y="${H - 120}" text-anchor="middle" fill="#888" font-size="18">Goods once sold will not be taken back</text></g>` +
    `<g transform="rotate(-14 520 ${560 + lines.length * 20})"><circle cx="520" cy="${560 + lines.length * 20}" r="70" fill="none" stroke="#2f5fb3" stroke-width="5" stroke-opacity="0.55"/>` +
    `<text x="520" y="${570 + lines.length * 20}" ${FONT} font-size="30" font-weight="800" fill="#2f5fb3" fill-opacity="0.55" text-anchor="middle">RECEIVED</text></g></g>`
  // Final image: a drop-shadow filter definition, a brown "counter" background,
  // the paper and the watermark.
  return svg(W, H, `<defs><filter id="s"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity="0.35"/></filter></defs>` +
    `<rect width="${W}" height="${H}" fill="#8a6d4d"/>${paper}${watermark(W, H)}`)
}

/** Handwritten slip from a small vendor (common for sand, crush and labour). */
// `note` defaults to the Urdu word for "receipt".
export function handwrittenSlip({ supplier, date, lines, note = 'رسید', seed }) {
  // Seed from supplier + date when no seed is given (`+` joins strings).
  const r = rng(seed ?? supplier + date)
  const W = 640
  const H = 760
  // Small random offset from -1.5 to +1.5 (as text), for a hand-drawn look.
  const wobble = () => (r() * 3 - 1.5).toFixed(1)
  // Total of qty × rate.
  const total = lines.reduce((n, l) => n + l.qty * l.rate, 0)
  // 16 blue ruled notebook lines. `Array.from({ length: 16 }, fn)` creates an
  // array of 16 items by calling fn(_, i); `_` marks an unused parameter.
  const ruled = Array.from({ length: 16 }, (_, i) => `<line x1="60" x2="${W - 60}" y1="${150 + i * 36}" y2="${150 + i * 36}" stroke="#9cc3e6" stroke-width="1.2"/>`).join('')
  // Handwriting-style font attribute.
  const hand = "font-family=\"'Segoe Print', 'Comic Sans MS', cursive\""
  // One wobbly text line per item: "description — qty × rate".
  // `Number(wobble())` converts the text offset back to a number for adding.
  const rows = lines
    .map((l, i) => `<text x="${80 + Number(wobble())}" y="${290 + i * 72}" transform="rotate(${wobble()} 300 ${290 + i * 72})">${esc(l.description)} — ${l.qty.toLocaleString('en-PK')} × ${l.rate.toLocaleString('en-PK')}</text>`)
    .join('')
  // The image, in order: green-grey background; tilted cream paper with ruled
  // lines; red margin line; blue handwriting group with the note, supplier,
  // date and rows; the total; and a squiggly signature path; then the watermark.
  return svg(W, H, `<rect width="${W}" height="${H}" fill="#6f7b6a"/>` +
    `<g transform="rotate(${(r() * 6 - 3).toFixed(1)} ${W / 2} ${H / 2})"><rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="#fbf8ee"/>${ruled}` +
    `<line x1="110" x2="110" y1="40" y2="${H - 40}" stroke="#e28b8b" stroke-width="1.5"/>` +
    `<g ${hand} fill="#1f2a7a" font-size="26">` +
    `<text x="${W - 90}" y="110" text-anchor="end" font-family="'Segoe UI', Arial" font-size="30">${esc(note)}</text>` +
    `<text x="80" y="130">${esc(supplier)}</text><text x="${W - 90}" y="180" text-anchor="end" font-size="22">${esc(date)}</text>${rows}` +
    `<text x="80" y="${330 + lines.length * 72}" font-size="30" font-weight="700">Total ${money(total)}</text>` +
    `<path d="M380 ${430 + lines.length * 72} q30 -40 60 0 t60 0 t50 -10" fill="none" stroke="#1f2a7a" stroke-width="3"/></g></g>${watermark(W, H)}`)
}

// Shared outdoor background: sky gradient, dirt ground and neighbouring
// houses. Private helper (not exported); `r` is the caller's random generator.
function sky(W, H, r) {
  // A blue hue between 205 and 220 (HSL colour wheel degrees).
  const hue = 205 + Math.round(r() * 15)
  // Gradient definitions for sky and dirt, then the sky rectangle and the
  // ground covering the lower 45% of the picture.
  return `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 60% 72%)"/><stop offset="1" stop-color="hsl(${hue} 40% 90%)"/></linearGradient>` +
    `<linearGradient id="dirt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b59a76"/><stop offset="1" stop-color="#8d7254"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#sky)"/><rect y="${H * 0.55}" width="${W}" height="${H * 0.45}" fill="url(#dirt)"/>` +
    // neighbouring houses on the horizon
    // Five houses at random-ish x positions and heights, each with two windows.
    Array.from({ length: 5 }, (_, i) => {
      const x = i * 190 - 40 + r() * 40 // left edge
      const h = 110 + r() * 90 // height
      return `<rect x="${x}" y="${H * 0.55 - h}" width="170" height="${h}" fill="hsl(36 ${18 + r() * 10}% ${78 + r() * 8}%)"/>` +
        `<rect x="${x + 30}" y="${H * 0.55 - h + 30}" width="40" height="30" fill="#4a5a6a" fill-opacity="0.5"/><rect x="${x + 100}" y="${H * 0.55 - h + 30}" width="40" height="30" fill="#4a5a6a" fill-opacity="0.5"/>`
    }).join('')
}

/** A delivery of material photographed at the gate. */
export function deliveryPhoto({ material, quantity, when, seed, where }) {
  const r = rng(seed ?? material + when)
  const W = 960
  const H = 720
  // The drawing of the material pile; `let` because it is built up below.
  let pile = ''
  // Cement: a pyramid of 50 kg bags, 6 rows, each row one bag shorter and shifted.
  if (material === 'cement') {
    // Nested for loops: rows, then bags in the row (9 - row bags).
    for (let row = 0; row < 6; row++) {
      for (let i = 0; i < 9 - row; i++) {
        const x = 220 + i * 62 + row * 31
        const y = 560 - row * 34
        // `+=` appends a bag rectangle with a "50 KG" label.
        pile += `<rect x="${x}" y="${y}" width="58" height="32" rx="6" fill="hsl(40 8% ${76 + r() * 8}%)" stroke="#888"/><text x="${x + 29}" y="${y + 21}" ${FONT} font-size="11" fill="#555" text-anchor="middle">50 KG</text>`
      }
    }
  // Steel: 70 rust-coloured bars at random heights and thicknesses, plus a yellow tag.
  } else if (material === 'steel') {
    for (let i = 0; i < 70; i++) {
      const y = 520 + r() * 70
      pile += `<line x1="${150 + r() * 30}" y1="${y}" x2="${800 + r() * 30}" y2="${y - 20 + r() * 10}" stroke="hsl(15 ${20 + r() * 20}% ${28 + r() * 15}%)" stroke-width="${3 + r() * 3}" stroke-linecap="round"/>`
    }
    pile += `<rect x="420" y="510" width="40" height="90" fill="#f3d36b"/><text x="440" y="560" ${FONT} font-size="12" text-anchor="middle" fill="#333">TAG</text>`
  // Bricks: a 9 × 12 stack; `(row % 2) * 24` offsets every other row (% = remainder).
  } else if (material === 'bricks') {
    for (let row = 0; row < 9; row++) {
      for (let i = 0; i < 12; i++) {
        const x = 200 + i * 48 + (row % 2) * 24
        pile += `<rect x="${x}" y="${600 - row * 22}" width="45" height="19" fill="hsl(${10 + r() * 10} ${45 + r() * 15}% ${38 + r() * 10}%)"/>`
      }
    }
  // Anything else (sand, crush): a curved mound plus 120 random grain dots.
  } else {
    // Sand is yellowish, otherwise grey (HSL values as text).
    const tone = material === 'sand' ? '42 55% 62%' : '30 6% 58%'
    pile = `<path d="M150 640 Q480 ${330 + r() * 40} 820 640 Z" fill="hsl(${tone})"/>` +
      Array.from({ length: 120 }, () => `<circle cx="${220 + r() * 520}" cy="${520 + r() * 110}" r="${1 + r() * 2.5}" fill="#000" fill-opacity="${0.08 + r() * 0.12}"/>`).join('')
  }
  // A simple delivery truck: green body, red cab, three wheels.
  const trolley = `<g transform="translate(${600 + r() * 40} 470)"><rect width="250" height="90" fill="#2f6b3a"/><rect x="250" y="20" width="70" height="70" fill="#c33"/><circle cx="50" cy="100" r="26" fill="#222"/><circle cx="200" cy="100" r="26" fill="#222"/><circle cx="290" cy="100" r="20" fill="#222"/></g>`
  // Background, the truck only for steel or cement (ternary inside `${}`),
  // the pile, a quantity caption, the date/GPS stamp and the watermark.
  return svg(W, H, `${sky(W, H, r)}${material === 'steel' || material === 'cement' ? trolley : ''}${pile}` +
    `<text x="40" y="60" ${FONT} font-size="26" font-weight="700" fill="#fff" fill-opacity="0.9">${esc(quantity)}</text>${stamp(W, H, when, where)}${watermark(W, H)}`)
}

/** Progress photo of the site at a given stage. */
export function sitePhoto({ scene, when, seed, caption, where }) {
  const r = rng(seed ?? scene + when)
  const W = 960
  const H = 720
  const g = H * 0.55 // ground line (y coordinate)
  let body = '' // the scene drawing
  // Helper: `rows` courses of `cols` bricks starting at (x0, y0), going up,
  // with every other course offset by half a brick.
  const brickRows = (x0, y0, cols, rows) => {
    let s = ''
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < cols; i++) s += `<rect x="${x0 + i * 36 + (row % 2) * 18}" y="${y0 - row * 14}" width="34" height="12" fill="hsl(${12 + r() * 8} ${48 + r() * 12}% ${40 + r() * 8}%)"/>`
    }
    return s
  }
  // Helper: one vertical rust-coloured steel bar from y0 to y1.
  const rebar = (x, y0, y1) => `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="#7a3f22" stroke-width="5"/>`
  // Pick the scene with an if / else-if chain.
  // Excavation: a dug pit and a yellow excavator.
  if (scene === 'excavation') {
    body = `<path d="M90 ${g + 30} L870 ${g + 30} L820 ${H - 40} L140 ${H - 40} Z" fill="#6e5236"/><path d="M90 ${g + 30} L870 ${g + 30} L850 ${g + 60} L110 ${g + 60} Z" fill="#83654a"/>` +
      `<g transform="translate(620 ${g - 120})"><rect width="160" height="80" fill="#f2b705"/><rect x="20" y="-50" width="80" height="50" fill="#f2b705"/><rect x="30" y="-42" width="60" height="34" fill="#9fc3d9"/><rect x="-10" y="80" width="190" height="34" rx="16" fill="#333"/><path d="M160 20 L260 -40 L300 60" fill="none" stroke="#e0a800" stroke-width="14"/></g>`
  // Footings: four concrete pads, each with five rebars (map inside map, joined).
  } else if (scene === 'footings') {
    body = `<rect x="80" y="${g + 40}" width="800" height="250" fill="#6e5236"/>` +
      [0, 1, 2, 3].map((i) => `<rect x="${150 + i * 180}" y="${g + 140}" width="120" height="70" fill="#9aa0a6"/>` +
        Array.from({ length: 5 }, (_, k) => rebar(165 + i * 180 + k * 22, g + 60, g + 150)).join('')).join('')
  // Plinth: a grey concrete beam outline on the ground.
  } else if (scene === 'plinth') {
    body = `<rect x="80" y="${g + 80}" width="800" height="200" fill="#8a6c4c"/><rect x="100" y="${g + 60}" width="760" height="40" fill="#a9adb1"/>` +
      `<rect x="100" y="${g + 60}" width="40" height="200" fill="#a9adb1"/><rect x="820" y="${g + 60}" width="40" height="200" fill="#a9adb1"/><rect x="460" y="${g + 60}" width="40" height="200" fill="#a9adb1"/>`
  // Columns (ground floor or upper floor): five columns with rebar sticking out.
  } else if (scene === 'columns' || scene === 'columns-upper') {
    // Upper-floor columns stand higher, on top of a finished lower floor.
    const base = scene === 'columns-upper' ? g - 120 : g + 40
    // For upper floors, first draw the lower floor (slab + brick wall).
    if (scene === 'columns-upper') body = `<rect x="80" y="${g - 120}" width="800" height="${H - g + 120}" fill="#a9adb1"/>` + brickRows(90, g + 200, 22, 14)
    // Floor beam plus five columns; each is concrete grey or wooden shuttering
    // brown at random (`r() > 0.4`), with two rebars on top.
    body += `<rect x="80" y="${base}" width="800" height="22" fill="#b9bcc0"/>` +
      [0, 1, 2, 3, 4].map((i) => {
        const x = 120 + i * 175
        const tall = 150 + r() * 40
        return `<rect x="${x}" y="${base - tall}" width="42" height="${tall}" fill="${r() > 0.4 ? '#a9adb1' : '#8a6a43'}"/>` + rebar(x + 8, base - tall - 50, base - tall) + rebar(x + 34, base - tall - 50, base - tall)
      }).join('')
  // Brickwork (ground or upper): a partly built wall, a column and a worker.
  } else if (scene === 'brickwork' || scene === 'brickwork-upper') {
    const upper = scene === 'brickwork-upper'
    const y0 = upper ? g - 60 : g + 160 // wall base height
    // Upper floor: draw the finished floor below first.
    if (upper) body = `<rect x="80" y="${g - 60}" width="800" height="${H - g + 60}" fill="#a9adb1"/>` + brickRows(90, g + 220, 22, 12)
    // Wall of 6–11 courses (`Math.floor` rounds down), a column, and a worker
    // with a yellow helmet and orange vest.
    body += brickRows(100, y0, 21, 6 + Math.floor(r() * 6)) + `<rect x="${100 + 7 * 36}" y="${y0 - 140}" width="40" height="160" fill="#a9adb1"/>` +
      `<g transform="translate(700 ${y0 - 120})"><circle cx="20" cy="0" r="14" fill="#c68a5e"/><path d="M6 -6 a14 14 0 0 1 28 0 z" fill="#ffc928"/><rect x="5" y="14" width="30" height="50" fill="#ff7a1a"/><rect x="5" y="64" width="12" height="44" fill="#2b2f36"/><rect x="23" y="64" width="12" height="44" fill="#2b2f36"/></g>`
  // Slab / curing: walls, a roof slab on nine wooden props, then either water
  // puddles (curing) or steel bar ends (fresh slab), chosen by a ternary.
  } else if (scene === 'slab' || scene === 'curing') {
    body = brickRows(90, g + 220, 22, 12) + `<rect x="70" y="${g + 30}" width="820" height="36" fill="${scene === 'curing' ? '#7d8a95' : '#a9adb1'}"/>` +
      Array.from({ length: 9 }, (_, i) => `<line x1="${90 + i * 100}" y1="${g + 66}" x2="${90 + i * 100}" y2="${H - 30}" stroke="#8a6a43" stroke-width="8"/>`).join('') +
      (scene === 'curing'
        ? Array.from({ length: 14 }, () => `<ellipse cx="${100 + r() * 760}" cy="${g + 40 + r() * 20}" rx="${30 + r() * 60}" ry="5" fill="#cfe6f7" fill-opacity="0.7"/>`).join('')
        : Array.from({ length: 30 }, (_, i) => `<line x1="${80 + i * 27}" y1="${g + 30}" x2="${80 + i * 27}" y2="${g + 34}" stroke="#7a3f22" stroke-width="3"/>`).join(''))
  // Any other scene: just a brick wall.
  } else {
    body = brickRows(90, g + 220, 22, 14)
  }
  // Background, scene, optional caption (only when given, via a ternary inside
  // `${}`), stamp and watermark.
  return svg(W, H, `${sky(W, H, r)}${body}${caption ? `<text x="40" y="60" ${FONT} font-size="24" font-weight="600" fill="#fff" fill-opacity="0.9">${esc(caption)}</text>` : ''}${stamp(W, H, when, where)}${watermark(W, H)}`)
}

/** Mobile banking "transfer successful" screen. */
export function bankProof({ amount, payee, reference, when }) {
  const W = 540 // phone-shaped image
  const H = 960
  // In order: light background and green header bar; header title; white
  // card; green circle with a check-mark path; "Transfer successful" and the
  // amount; then label/value rows for payee, masked account, reference and
  // date; and the watermark.
  return svg(W, H, `<rect width="${W}" height="${H}" fill="#eef2f5"/><rect x="0" y="0" width="${W}" height="150" fill="#0f6b58"/>` +
    `<text x="40" y="95" ${FONT} font-size="28" font-weight="700" fill="#fff">Bank transfer</text>` +
    `<rect x="30" y="190" width="${W - 60}" height="640" rx="24" fill="#fff"/>` +
    `<circle cx="${W / 2}" cy="290" r="54" fill="#1f9d55"/><path d="M${W / 2 - 26} 290 l18 18 l34 -38" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<g ${FONT} text-anchor="middle"><text x="${W / 2}" y="400" font-size="26" font-weight="700" fill="#1b1a17">Transfer successful</text>` +
    `<text x="${W / 2}" y="460" font-size="40" font-weight="800" fill="#1b1a17">${money(amount)}</text></g>` +
    `<g ${FONT} font-size="20" fill="#55524c"><text x="70" y="540">To</text><text x="${W - 70}" y="540" text-anchor="end" fill="#1b1a17" font-weight="600">${esc(payee)}</text>` +
    `<text x="70" y="590">Account</text><text x="${W - 70}" y="590" text-anchor="end" fill="#1b1a17">PK** **** **** 4821</text>` +
    `<text x="70" y="640">Reference</text><text x="${W - 70}" y="640" text-anchor="end" fill="#1b1a17">${esc(reference)}</text>` +
    `<text x="70" y="690">Date</text><text x="${W - 70}" y="690" text-anchor="end" fill="#1b1a17">${esc(when)}</text></g>${watermark(W, H)}`)
}

/** Ground floor plan, blueprint style. */
export function floorPlan({ title }) {
  const W = 1200
  const H = 860
  // Helper: one room as a white outline with its name and size centred inside.
  const room = (x, y, w, h, name, size) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#fff" stroke-width="4"/>` +
    `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-size="20" fill="#fff">${esc(name)}</text>` +
    `<text x="${x + w / 2}" y="${y + h / 2 + 26}" text-anchor="middle" font-size="15" fill="#bcd6ff">${esc(size)}</text>`
  // Faint 40px blueprint grid: 30 vertical + 30 horizontal lines.
  const grid = Array.from({ length: 30 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${H}" stroke="#fff" stroke-opacity="0.07"/><line x1="0" y1="${i * 40}" x2="${W}" y2="${i * 40}" stroke="#fff" stroke-opacity="0.07"/>`).join('')
  // Blue background and grid, then the rooms row by row (bedrooms + bath;
  // drawing/dining, kitchen, stairs; car porch), then the title block with
  // scale and covered area, then the watermark. Room sizes use feet (') in
  // double-quoted strings.
  return svg(W, H, `<rect width="${W}" height="${H}" fill="#173d75"/>${grid}<g ${FONT}>` +
    room(120, 120, 300, 260, 'Bedroom 1', "14' × 16'") + room(420, 120, 220, 260, 'Bath', "8' × 10'") + room(640, 120, 340, 260, 'Bedroom 2', "15' × 16'") +
    room(120, 380, 420, 240, 'Drawing / dining', "20' × 14'") + room(540, 380, 200, 240, 'Kitchen', "10' × 14'") + room(740, 380, 240, 240, 'Stairs', "9' × 14'") +
    room(120, 620, 860, 140, 'Car porch and lawn', "35' × 12'") +
    `<text x="1010" y="160" font-size="22" fill="#fff" font-weight="700">${esc(title)}</text><text x="1010" y="190" font-size="15" fill="#bcd6ff">Scale 1:100</text>` +
    `<text x="1010" y="215" font-size="15" fill="#bcd6ff">Covered 1,476 sq ft</text></g>${watermark(W, H)}`)
}

/** Letter or report on A4-ish paper. */
// `seal = true` by default adds an "APPROVED" stamp.
export function letter({ heading, subheading, paragraphs, signedBy, seal = true }) {
  const W = 800
  const H = 1060
  // Word-wrap the paragraphs into lines of at most ~62 characters.
  // `.flatMap` maps each paragraph to an array of lines and flattens all those
  // arrays into one list.
  const body = paragraphs
    .flatMap((p) => {
      const words = p.split(' ') // split the paragraph into words
      const out = [] // finished lines
      let line = '' // line being built
      for (const w of words) {
        // Adding this word would make the line too long: finish the line first.
        if ((line + w).length > 62) {
          out.push(line)
          line = ''
        }
        line += `${w} ` // add the word and a space
      }
      // Push the last line plus an empty line as paragraph spacing.
      out.push(line, '')
      return out
    })
    // Turn each line into a <text> element, 34px apart.
    .map((l, i) => `<text x="90" y="${330 + i * 34}">${esc(l.trim())}</text>`)
    .join('')
  // Grey background and white page; heading, subheading and a rule line; the
  // body text; signature line and squiggle; the optional green seal (ternary
  // gives '' when seal is false); and the watermark.
  return svg(W, H, `<rect width="${W}" height="${H}" fill="#e9e6df"/><rect x="30" y="30" width="${W - 60}" height="${H - 60}" fill="#fff"/>` +
    `<g ${FONT} fill="#1b1a17"><text x="90" y="140" font-size="34" font-weight="700">${esc(heading)}</text>` +
    `<text x="90" y="180" font-size="20" fill="#55524c">${esc(subheading)}</text><line x1="90" y1="215" x2="${W - 90}" y2="215" stroke="#1b1a17" stroke-width="2"/>` +
    `<g font-size="21" fill="#33312d">${body}</g>` +
    `<text x="90" y="${H - 140}" font-size="20">Signed: ${esc(signedBy)}</text><path d="M90 ${H - 170} q40 -30 80 0 t70 -10 t60 5" fill="none" stroke="#1f2a7a" stroke-width="3"/></g>` +
    (seal ? `<circle cx="${W - 180}" cy="${H - 180}" r="80" fill="none" stroke="#0f6b58" stroke-width="5" stroke-opacity="0.6"/><text x="${W - 180}" y="${H - 172}" ${FONT} font-size="22" font-weight="800" fill="#0f6b58" fill-opacity="0.6" text-anchor="middle">APPROVED</text>` : '') +
    watermark(W, H))
}
