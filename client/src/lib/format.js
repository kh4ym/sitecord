// FILE: client/src/lib/format.js
//
// What it does: display formatting used by nearly every component: dates,
// times, "3 hours ago", rupee amounts, numbers, file sizes, names/initials,
// plurals, CSV cells, plus `cn` for joining CSS class names.
//
// Why it exists: one place decides how things look, and it follows the app's
// language (English or Urdu). Money formatting itself lives in
// shared/money.js and is re-exported here so pages have one import.
//
// Where it's used: almost every page and component. The I18nProvider calls
// setFormatLocale when the language changes.
//
// Depends on: shared/houseConfig.js (todayPK) and shared/money.js (formatPKR),
// plus the browser's built-in Intl formatters.

// Named import: the function that returns today's date in Pakistan time.
import { todayPK } from '@shared/houseConfig.js'
// Named import: the rupee formatter.
import { formatPKR } from '@shared/money.js'

// Re-export: make formatPKR importable from this file too.
export { formatPKR }
// `(...parts)` is a rest parameter: all arguments gathered into an array.
// `.filter(Boolean)` drops falsy entries (false, null, '', undefined), then
// `.join(' ')` glues the rest with spaces: cn('a', cond && 'b') -> 'a b' or 'a'.
export const cn = (...parts) => parts.filter(Boolean).join(' ')

// Date and number formatters follow the app's language. The I18nProvider
// sets the locale; pages re-render when it changes, so reads stay current.
// Module-level mutable state (`let`): the current BCP-47 language tag.
let locale = 'en-GB'
// The current set of formatters. `build` is called before its line because
// function declarations are "hoisted" (usable anywhere in the module).
let fmt = build('en-GB')

// Creates one Intl formatter of each kind for a language tag. Creating them is
// slow-ish, so we build them once and reuse them.
function build(tag) {
  // Return an object literal whose values are formatter objects.
  return {
    // e.g. "3 Oct 2026". Intl.DateTimeFormat(locale, options) formats Date objects.
    date: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric' }),
    // e.g. "3 Oct".
    shortDate: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }),
    // e.g. "9:05 am" (12-hour clock).
    time: new Intl.DateTimeFormat(tag, { hour: 'numeric', minute: '2-digit', hour12: true }),
    // e.g. "October 2026".
    month: new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' }),
    // e.g. "Sat".
    weekday: new Intl.DateTimeFormat(tag, { weekday: 'short' }),
    // Formats "in 3 days" / "yesterday"; numeric: 'auto' allows words like "yesterday".
    relative: new Intl.RelativeTimeFormat(tag, { numeric: 'auto' }),
    // Numbers with at most 2 decimals; Urdu uses en-PK digits (ternary picks the tag).
    number: new Intl.NumberFormat(tag === 'ur-PK' ? 'en-PK' : tag, { maximumFractionDigits: 2 }),
  }
}

/** 'en' | 'ur' from the language switch. */
// Called by the I18nProvider when the user changes language.
export function setFormatLocale(code) {
  // Map the short app code to a full locale tag.
  const tag = code === 'ur' ? 'ur-PK' : 'en-GB'
  // Nothing changed: skip rebuilding.
  if (tag === locale) return
  // Remember the new locale (reassigning the module-level `let`).
  locale = tag
  // Rebuild every formatter for the new language.
  fmt = build(tag)
}

/** Calendar dates ('YYYY-MM-DD') are local days; parse them at noon so no time zone shifts them. */
// `typeof v === 'string'` checks the value's type. A 10-character string is a
// plain date; anything else (timestamp string, number, Date) goes to new Date as-is.
const asDate = (v) => (typeof v === 'string' && v.length === 10 ? new Date(`${v}T12:00:00`) : new Date(v))

// Each of these is an exported one-line arrow function.
// Full date, or an em dash when the value is missing.
export const formatDate = (v) => (v ? fmt.date.format(asDate(v)) : '—')
// Short date without year, or a dash.
export const formatShortDate = (v) => (v ? fmt.shortDate.format(asDate(v)) : '—')
// Month name; a 7-char 'YYYY-MM' key gets '-01' appended to make a full date.
export const formatMonth = (v) => fmt.month.format(asDate(v.length === 7 ? `${v}-01` : v))
// Short weekday name.
export const formatWeekday = (v) => fmt.weekday.format(asDate(v))
// Clock time from a timestamp.
export const formatTime = (v) => fmt.time.format(new Date(v))
// "3 Oct 2026, 9:05 am" by combining the two above in a template literal.
export const formatDateTime = (v) => `${formatDate(v)}, ${formatTime(v)}`

/** "just now", "3 hours ago", "yesterday", then a date. */
export function timeAgo(v) {
  // Missing value: empty string.
  if (!v) return ''
  // Seconds between then and now (negative for the past).
  const s = (new Date(v).getTime() - Date.now()) / 1000
  // Absolute size of the gap, ignoring direction.
  const a = Math.abs(s)
  // Under a minute: "just now" (the Urdu string is used when the locale is Urdu).
  if (a < 60) return locale === 'ur-PK' ? 'ابھی' : 'just now'
  // Under an hour: "N minutes ago".
  if (a < 3600) return fmt.relative.format(Math.round(s / 60), 'minute')
  // Under a day: "N hours ago".
  if (a < 86400) return fmt.relative.format(Math.round(s / 3600), 'hour')
  // Under a week: "yesterday" / "N days ago".
  if (a < 86400 * 7) return fmt.relative.format(Math.round(s / 86400), 'day')
  // Older: show the actual date.
  return formatDate(v)
}

/** Today at the site (Pakistan time), the day site records are filed under. */
// A function (not a constant) so it is re-evaluated each call.
export const today = () => todayPK()

// `n == null` (loose equality) is true for both null and undefined.
export const formatNumber = (n) => (n == null ? '—' : fmt.number.format(n))

// Human-readable file size.
export function formatBytes(n) {
  // Less than 1 KB: bytes.
  if (n < 1024) return `${n} B`
  // Less than 1 MB: whole kilobytes.
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  // Otherwise megabytes with one decimal (`toFixed(1)` returns a string).
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** The short figure without "Rs" ("1.2 crore"), for amounts beside a label that already says it's money. */
// `{ compact: true, ...opts }` sets a default that the caller's opts can override
// (later keys win). `.replace('Rs ', '')` removes the first "Rs ".
export const amount = (paisa, opts) => formatPKR(paisa, { compact: true, ...opts }).replace('Rs ', '')

// "Ayesha Khan" -> "AK". `name = ''` is a default parameter. Method chaining:
// each line calls a method on the result of the previous line.
export const initials = (name = '') =>
  name
    // Regex: `^` start, `Engr\.` literal "Engr.", `\s*` any spaces, `i` = ignore case. Removes the title.
    .replace(/^Engr\.\s*/i, '')
    // Split on runs of whitespace into an array of words.
    .split(/\s+/)
    // Drop empty strings.
    .filter(Boolean)
    // Keep at most the first two words.
    .slice(0, 2)
    // First letter of each word, upper-cased (`w[0]` is the first character).
    .map((w) => w[0].toUpperCase())
    // Join the letters into one string.
    .join('')

/** "Ayesha" from "Ayesha Khan"; skips titles like "Engr." */
// `name?.split` is safe if name is null. `.find` returns the first word for which
// the callback is true; the regex test matches "engr" or "engr." (case-insensitive).
// `?? name ?? ''` falls back to the original name, then to ''.
export const firstName = (name) => name?.split(/\s+/).find((w) => !/^engr\.?$/i.test(w)) ?? name ?? ''

// "1 photo" / "3 photos". `many = `${word}s`` is a default parameter computed
// from an earlier parameter. toLocaleString adds thousands separators.
export const plural = (n, word, many = `${word}s`) => `${n.toLocaleString('en-PK')} ${n === 1 ? word : many}`

/**
 * A big rupee figure split into number and unit, for stats and heroes:
 * moneyParts(114000000 * 100) → { n: 1.14, unit: 'crore', digits: 2 }.
 */
export function moneyParts(paisa) {
  // Paisa to rupees (100 paisa = 1 rupee); `?? 0` treats null as 0; sign is dropped.
  const r = Math.abs(paisa ?? 0) / 100
  // 1e7 = 10,000,000 = one crore.
  if (r >= 1e7) return { n: r / 1e7, unit: 'crore', digits: 2 }
  // 1e5 = 100,000 = one lakh.
  if (r >= 1e5) return { n: r / 1e5, unit: 'lakh', digits: 1 }
  // Smaller amounts stay in plain rupees.
  return { n: r, unit: 'rupees', digits: 0 }
}

/** Formatter for a number shown with a fixed number of decimals (trailing zeros dropped); whole numbers get separators. */
// A function that returns a function (currying): fixed(2) gives a formatter for 2 decimals.
// Nested ternaries: missing/NaN -> dash; 0 digits -> rounded with separators;
// otherwise toFixed then `+` (unary plus) converts back to a number to drop trailing zeros.
export const fixed = (digits) => (n) =>
  n == null || Number.isNaN(n) ? '—' : digits === 0 ? Math.round(n).toLocaleString('en-PK') : String(+Number(n).toFixed(digits))

/** Short hash for display: first 8 and last 4 characters. */
// `slice(-4)` takes the last 4 characters.
export const shortHash = (h) => (h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '')

/** One CSV cell: quoted when it holds a comma, quote or line break. */
// Arrow function with a block body `{ ... }`, so it needs an explicit `return`.
export const csvCell = (v) => {
  // Turn anything (number, null...) into a string; null/undefined become ''.
  const s = String(v ?? '')
  // Regex character class `[",\n\r]` matches any of those characters. If found,
  // wrap in quotes and double any inner quotes (`/"/g` = every quote, globally).
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
