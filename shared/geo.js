// FILE: shared/geo.js
// Distances from the site pin, for "where was this photo taken".
// Owns the site-location rules: how far a photo may be from the pin, when a
// GPS fix is good enough to judge, and how pasted coordinates are read.
// Imported by both sides: the server classifies uploads (services/evidence,
// expenses, decisions, projects); the client shows the same verdict before
// upload (CameraCapture, EvidenceGallery, SitePinField, VerifyPage).
// Coordinates are decimal degrees; distances and accuracies are metres.
// Depends only on built-in Math, Number, RegExp and decodeURIComponent.

// Mean radius of the Earth in metres.
const EARTH_M = 6371000
// Arrow function converting degrees to radians (Math.PI is 3.14159...).
const rad = (d) => (d * Math.PI) / 180

/**
 * Great-circle distance in metres between two { lat, lng } points.
 * Haversine formula on a spherical Earth: fine to within 0.5% at these
 * ranges, and far better than the GPS error it is compared with. The
 * Math.min(1, ...) guards asin against rounding past 1 for antipodal points.
 */
// `a` and `b` are objects with `lat` and `lng` properties.
export function distanceMeters(a, b) {
  const dLat = rad(b.lat - a.lat) // difference in latitude, in radians
  const dLng = rad(b.lng - a.lng) // difference in longitude, in radians
  // The haversine term; `**` is the exponent operator (x ** 2 = x squared).
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  // Central angle (asin of the square root) times the Earth's diameter.
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Metres from the project's site pin, or null when either location is missing. */
export function distanceFromSite(project, point) {
  // `?.` optional chaining avoids crashing on a missing object; `== null`
  // catches both null and undefined; `||` means "or".
  if (project?.siteLat == null || project?.siteLng == null || point?.lat == null || point?.lng == null) return null
  // Build a { lat, lng } object for the pin and measure to the point.
  return distanceMeters({ lat: project.siteLat, lng: project.siteLng }, point)
}

// Radius rules. Verification photos are held to the tighter radius because
// they are the owner's proof that work exists; delivery photos get more room
// and are only ever flagged. In both cases the GPS accuracy is subtracted
// first (see locationStatus), so a photo is only off-site when even the best
// case for its reading falls outside the circle.
/** A verification photo counts as off-site when even its error margin can't put it near the pin. */
export const VERIFY_RADIUS_M = 300
/** Delivery photos further than this are flagged for the owner (never blocked). */
export const DELIVERY_RADIUS_M = 500
/** Readings rougher than this say nothing useful about where a photo was taken. */
const MAX_USEFUL_ACCURACY_M = 1000
/** A pin set from a phone must be at least this precise. */
export const PIN_MAX_ACCURACY_M = 150

/** How far from the pin a photo of this kind may be before it counts as off-site. */
// Ternary inside an arrow: delivery photos get the wider radius.
const radiusFor = (kind) => (kind === 'DELIVERY_PHOTO' ? DELIVERY_RADIUS_M : VERIFY_RADIUS_M)

/** A GPS fix precise enough to say where a photo was taken. */
// True when lat and lng exist and the accuracy (0 if unknown, via `??`) is good enough.
export const usableFix = (ev) => ev?.lat != null && ev?.lng != null && (ev.accuracyM ?? 0) <= MAX_USEFUL_ACCURACY_M

/**
 * Where a photo was taken relative to the pin: NO_PIN, UNKNOWN (no or useless
 * GPS), ON_SITE or OFF_SITE. Off-site only when distance minus the GPS error
 * margin is still beyond the radius (by default the one for the photo's kind),
 * so a weak signal never counts against anyone.
 */
// Default parameter `radiusM = radiusFor(ev?.kind)`: computed from `ev` when
// the caller does not pass a radius.
export function locationStatus(ev, project, radiusM = radiusFor(ev?.kind)) {
  if (project?.siteLat == null) return 'NO_PIN' // no pin set on the project
  if (!usableFix(ev)) return 'UNKNOWN' // no GPS, or too rough to judge
  // The server stores distanceM on the evidence row; the client computes it.
  const d = ev.distanceM ?? distanceFromSite(project, ev)
  // Subtract the error margin, then compare with the allowed radius.
  return d - (ev.accuracyM ?? 0) > radiusM ? 'OFF_SITE' : 'ON_SITE'
}

/** Null Island (0, 0) is the usual sign of a missing fix, never a real site. */
// Number.isFinite rejects NaN and Infinity; latitude must be within ±90 and
// longitude within ±180; `!(...)` rejects exactly (0, 0).
export const isRealLocation = (p) => p != null && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0)

/**
 * Read a location from what people paste: "31.47, 74.45", or a Google Maps
 * link (…/@31.47,74.45,17z, …?q=31.47,74.45, …!3d31.47!4d74.45).
 */
export function parseLocation(text) {
  // Turn the input into a string ('' when null/undefined) and strip spaces.
  let s = String(text ?? '').trim()
  // try/catch: run the risky call; if it throws, run the catch block instead.
  try {
    s = decodeURIComponent(s) // turn %2C etc. back into characters
  } catch {
    /* keep as typed */
  }
  // Tried in order: a bare "lat, lng" pair, then the three ways Google Maps
  // URLs carry a point. The first match that is a real location wins, so a
  // "@0,0" placeholder in a link never beats the q= parameter after it.
  // A regex fragment (as a string) matching one signed decimal number, in a
  // capture group so its text can be read back.
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)'
  // `new RegExp(text)` builds a regular expression from a template literal.
  const patterns = [
    // Whole input is "lat, lng" (comma and/or spaces between).
    new RegExp(`^${num}\\s*[,\\s]\\s*${num}$`),
    // Maps link with "@lat,lng".
    new RegExp(`@${num},\\s*${num}`),
    // Maps link with a query parameter like ?q=lat,lng.
    new RegExp(`[?&](?:q|query|ll|destination|center)=${num},\\s*${num}`),
    // Maps link with "!3dlat!4dlng" data segments.
    new RegExp(`!3d${num}!4d${num}`),
  ]
  for (const re of patterns) {
    // `.match` returns an array of captured groups, or null on no match.
    const m = s.match(re)
    if (!m) continue // `continue` skips to the next pattern
    // m[1] and m[2] are the two captured numbers; Number() parses them.
    const point = { lat: Number(m[1]), lng: Number(m[2]) }
    if (isRealLocation(point)) return point // first real location wins
  }
  return null // nothing recognisable
}

/** "0 m", "850 m", "2.4 km". */
export function formatDistance(m) {
  if (m == null || Number.isNaN(m)) return '' // nothing to show
  if (m < 1000) return `${Math.round(m)} m` // template literal with metres
  // Kilometres: one decimal under 10 km, none above.
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}
