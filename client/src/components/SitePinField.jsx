// FILE: components/SitePinField.jsx — the site pin picker.
//
// What it does: lets the user set the building site's map location, either
// "I'm at the site" (reads the phone's GPS and requires a precise fix) or by
// pasting coordinates / a Google Maps link (parsed by shared/geo.js
// parseLocation). Once set, it shows the pinned coordinates (linking to
// OpenStreetMap) with a remove button. The pin is what photo distances and
// "verify on site" are measured against.
// Where it's used: new-project step 4 and project settings.
// Depends on: React useState, lucide-react icons, shared/geo.js (accuracy
// limit + link parser), lib/image.js currentPosition (GPS), and ui pieces.

// Local state hook.
import { useState } from 'react'
// Icons: locate-me target, map pin, and close X.
import { LocateFixed, MapPin, X } from 'lucide-react'
// Max allowed GPS error in metres, and the text -> {lat,lng} parser.
import { PIN_MAX_ACCURACY_M, parseLocation } from '@shared/geo.js'
// Promise-based helper that asks the browser for the device location.
import { currentPosition } from '../lib/image.js'
// Design-system pieces.
import { Button, Field, Input } from './ui/index.js'

/**
 * Optional site pin: from the phone at the site, or a pasted map link /
 * coordinates. Used when adding a house and in project settings; the pin is
 * what photo distances and "verify on site" are measured against. Parsing
 * and the accuracy limit come from shared/geo.js.
 */
// Controlled component: `pin` is the current value ({ lat, lng, ... } or null)
// and `onChange` sets a new one.
export function SitePinField({ pin, onChange }) {
  // What's typed/pasted in the text box.
  const [text, setText] = useState('')
  // True while waiting for GPS.
  const [busy, setBusy] = useState(false)
  // Error message to show under the field (null = none).
  const [error, setError] = useState(null)
  // async arrow function for the "I'm at the site" button.
  const fromPhone = async () => {
    // Show the button's spinner.
    setBusy(true)
    // Clear any old error.
    setError(null)
    // Wait (up to 15000 ms) for a precise location; resolves to null on failure.
    const p = await currentPosition(15000, { precise: true })
    // Done waiting.
    setBusy(false)
    // No location: show an error. `return setError(...)` sets it and exits in one line.
    if (!p) return setError("Couldn't get your location. Allow location access, or paste a map link.")
    // Too imprecise: explain, including the accuracy in a template literal.
    if (p.accuracyM > PIN_MAX_ACCURACY_M) return setError(`Your phone's location is too rough (±${p.accuracyM} m). Step outside and try again, or paste a map link.`)
    // Good fix: report the new pin, marking it as coming from the device.
    onChange({ lat: p.lat, lng: p.lng, source: 'DEVICE', accuracyM: p.accuracyM })
  }
  // A pin is set: show it instead of the input.
  if (pin) {
    return (
      // Card row: icon, text, remove button.
      <div className="card flex items-center gap-3 px-4 py-3.5">
        {/* Accent circle with a map pin icon. */}
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-700">
          <MapPin size={18} aria-hidden />
        </span>
        {/* Text column. */}
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold">Site pinned</span>
          <a
            // OpenStreetMap URL with the marker and zoom level 17, built by a template literal.
            href={`https://www.openstreetmap.org/?mlat=${pin.lat}&mlon=${pin.lng}#map=17/${pin.lat}/${pin.lng}`}
            // Open in a new tab...
            target="_blank"
            // ...without telling the new site where the user came from.
            rel="noreferrer"
            // Small accent link text, truncated.
            className="num block truncate text-meta text-accent-700 hover:underline"
          >
            {/* Coordinates rounded to 5 decimals (about 1 m) with toFixed. */}
            {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
          </a>
        </span>
        {/* Remove: set the pin back to null. */}
        <button type="button" onClick={() => onChange(null)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-ink/5" aria-label="Remove the pin">
          <X size={18} />
        </button>
      </div>
    )
  }
  // Try to turn the typed text into a pin (runs on blur and on Enter).
  const tryText = () => {
    // Nothing typed: do nothing.
    if (!text.trim()) return
    // Parse; returns { lat, lng } or null.
    const p = parseLocation(text)
    if (p) {
      // Copy the parsed fields and add the source.
      onChange({ ...p, source: 'LINK' })
      // Clear the box and any error.
      setText('')
      setError(null)
      // Couldn't parse: show a hint (an `else` without braces covers one statement).
    } else setError("That doesn't look like a location. Copy the full link from Google Maps, or the coordinates.")
  }
  return (
    // Field wires the label, hint and error to the input for screen readers.
    <Field label="Site location" optional hint="Photos then show how far from the site they were taken." error={error}>
      {/* Stacked on phones, side by side from the sm breakpoint. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Controlled text input. onBlur parses when focus leaves; onKeyDown on
            Enter uses `(a, b)` (comma operator) to stop the surrounding form
            submitting, then parse. */}
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a Google Maps link or 31.47, 74.40" onBlur={tryText} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), tryText())} />
        {/* GPS button with a spinner while busy. */}
        <Button variant="secondary" icon={LocateFixed} loading={busy} onClick={fromPhone} className="shrink-0">
          I'm at the site
        </Button>
      </div>
    </Field>
  )
}
