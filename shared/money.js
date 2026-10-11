// FILE: shared/money.js
// Money is stored as integer paisa (1 rupee = 100 paisa), never as floats.
// This file owns how paisa is shown to people. It is imported by both sides:
// the server uses formatPKR in audit and notification text (services/budget,
// expenses, payments, decisions, changes, boq, projects) and the client wraps
// it in lib/format.js so every page formats rupees the same way.
// Depends on nothing but the built-in Intl API, so it runs in Node and browsers.

// `Intl.NumberFormat` is the built-in number formatter. 'en-PK' is the locale
// (English, Pakistan) that decides digit grouping; the options object asks for
// no decimal places. `new` creates the formatter once so it can be reused.
const full = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 })
// Arrow function with two parameters. `n.toFixed(digits)` rounds to a string
// with that many decimals; the unary `+` turns it back into a number (which
// drops trailing zeros, e.g. "12.50" -> 12.5); `String(...)` makes it text.
const trim = (n, digits) => String(+n.toFixed(digits))

/**
 * Format paisa as rupees.
 *   formatPKR(125000000)                    → "Rs 1,250,000"
 *   formatPKR(125000000, { compact: true }) → "Rs 12.5 lakh"
 * Compact figures are rounded before the unit is chosen, so 99.97 lakh
 * reads "1 crore", never "100 lakh".
 */
// The second parameter is destructured: `{ compact = false, sign = false }`
// pulls those two properties out of the options object with default values,
// and the trailing `= {}` makes the whole object optional.
export function formatPKR(paisa, { compact = false, sign = false } = {}) {
  // `== null` (loose equality) matches both null and undefined. NaN is "not a
  // number"; Number.isNaN checks for it. '—' is shown for missing amounts.
  if (paisa == null || Number.isNaN(paisa)) return '—'
  const rupees = paisa / 100 // convert paisa to rupees (may now have decimals)
  const abs = Math.abs(rupees) // absolute value: the size without the sign
  // Chained ternaries: negative -> minus sign; else if `sign` was asked for
  // and the value is positive -> '+'; otherwise no prefix ('').
  const prefix = rupees < 0 ? '−' : sign && rupees > 0 ? '+' : ''
  // Below Rs 1 lakh there is nothing to compact. Above it, work in lakh (1e5)
  // to one decimal; once that rounds to 100 lakh switch to crore (1e7), with
  // two decimals under Rs 10 crore and one above so figures stay short.
  // `1e5` is exponent notation for 100000; `&&` means "and".
  if (compact && abs >= 1e5) {
    // Value in lakh, rounded to one decimal and turned back into a number.
    const lakh = +(abs / 1e5).toFixed(1)
    // Template literal (backticks): `${expr}` inserts a value into the text.
    // 1e7 = one crore, 1e8 = ten crore.
    if (lakh >= 100) return `${prefix}Rs ${trim(abs / 1e7, abs >= 1e8 ? 1 : 2)} crore`
    return `${prefix}Rs ${lakh} lakh` // e.g. "Rs 12.5 lakh"
  }
  // Full form with digit grouping from the formatter, e.g. "Rs 1,250,000".
  return `${prefix}Rs ${full.format(abs)}`
}
