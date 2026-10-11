// The server's only logger. One line per event on stdout: JSON in production
// (easy to ship to a log service) and readable text in development. Also
// exports the per-request access-log middleware app.js installs first.
// No dependencies, so it is safe to import from anywhere, including config.
//
// Usage elsewhere: `log.info('message', { some: 'field' })`, and app.js does
// `app.use(requestLog)` so every HTTP request gets one log line when it ends.

// true in production → write JSON lines; false → human-readable text.
const json = process.env.NODE_ENV === 'production'

// A plain function declaration with three parameters. Not exported, so it is
// private to this file. `fields` is an optional object of extra key/values.
function emit(level, msg, fields) {
  // new Date() = current time; toISOString() formats it like "2026-10-03T12:34:56.789Z".
  const at = new Date().toISOString()
  // Production branch: one JSON object per line.
  if (json) {
    // Template literal: text in backticks where `${expr}` inserts a value.
    // JSON.stringify turns an object into JSON text. `...fields` is the spread
    // operator: copy every property of `fields` into this new object.
    // `\n` is a newline. process.stdout.write prints without adding anything.
    process.stdout.write(`${JSON.stringify({ at, level, msg, ...fields })}\n`)
    // Stop here; the text format below is for development only.
    return
  }
  // Build " key=value key=value" text, or '' if there are no fields.
  // Object.entries(obj) gives [[key, value], ...]; `([k, v]) =>` destructures
  // each pair. `typeof v === 'string'` checks the value's type: strings are
  // printed as-is, anything else as JSON. .join(' ') glues with spaces.
  const extra = fields ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ') : ''
  // at.slice(11, 19) keeps only the "HH:MM:SS" part of the timestamp;
  // padEnd(5) pads the level with spaces to 5 characters so columns line up.
  process.stdout.write(`${at.slice(11, 19)} ${level.padEnd(5)} ${msg}${extra}\n`)
}

// The exported logger: an object whose properties are arrow functions that
// call emit with a fixed level.
export const log = {
  info: (msg, fields) => emit('info', msg, fields), // normal events
  warn: (msg, fields) => emit('warn', msg, fields), // something odd but handled
  error: (msg, fields) => emit('error', msg, fields), // failures
}

/** Express middleware: method, path, status and duration for every request. */
// Standard middleware signature (req, res, next).
export function requestLog(req, res, next) {
  // process.hrtime.bigint() = a high-resolution clock in nanoseconds, as a
  // BigInt (an integer type for very large numbers).
  const start = process.hrtime.bigint()
  // res.on('finish', fn): run fn once the response has been fully sent.
  res.on('finish', () => {
    // BigInt subtraction, converted to a normal Number, divided by 1e6
    // (1,000,000, written in exponent notation) to get milliseconds.
    const ms = Number(process.hrtime.bigint() - start) / 1e6
    // The URL without its query string: split at '?' and take element [0].
    // Math.round rounds to the nearest whole number.
    const fields = { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms), ip: req.ip }
    // Add the signed-in user's id if attachUser set req.user.
    if (req.user) fields.user = req.user.id
    // 5xx statuses are logged as errors, everything else as info.
    emit(res.statusCode >= 500 ? 'error' : 'info', 'request', fields)
  })
  // Continue to the next middleware immediately; logging happens later on 'finish'.
  next()
}
