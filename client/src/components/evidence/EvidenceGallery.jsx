// FILE: client/src/components/evidence/EvidenceGallery.jsx
//
// What it does: viewing evidence that's already on the server. It exports:
//   EvidenceTiles     photo tiles with their provenance chips
//   EvidenceLightbox  a sheet with the full file, where and when it was taken,
//                     and its SHA-256 fingerprint
//   provenance()      one plain-English sentence on where a file came from
//
// Where it's used: purchase, report and change pages, the Approvals sheet and
// the document library.
//
// Depends on: react (useState), sonner (toast), lucide-react icons,
// shared/geo.js and shared/records.js (location and timing judgements, the
// same as the server's), ProjectContext, lib/api.js (fileUrl),
// lib/format.js and the UI kit (Button, Chip, Sheet).

// State hook.
import { useState } from 'react'
// Toast notifications.
import { toast } from 'sonner'
// Icon components.
import { Copy, ExternalLink, FileText, Fingerprint, MapPin } from 'lucide-react'
// "120 m" formatting and the on-site / off-site / unknown decision.
import { formatDistance, locationStatus } from '@shared/geo.js'
// Display names of evidence kinds, and the clock/offline timing check.
import { EVIDENCE_KINDS, evidenceTiming } from '@shared/records.js'
// Current project (for its site pin).
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Builds the URL of an evidence file.
import { fileUrl } from '../../lib/api.js'
// Formatting helpers.
import { cn, formatBytes, formatDateTime, formatShortDate, formatTime, shortHash } from '../../lib/format.js'
// UI kit components.
import { Button, Chip, Sheet } from '../ui/index.js'

// Short lowercase labels per evidence kind, for the tile pills.
const SHORT = { RECEIPT: 'receipt', INVOICE: 'invoice', HANDWRITTEN_SLIP: 'slip', DELIVERY_PHOTO: 'delivery', PHOTO: 'site', BANK_PROOF: 'payment proof', DOCUMENT: 'document' }

/** "delivery, live" — what the file is and how it was taken. */
// Template literal with two expressions: the kind label (fallback 'file'), then a suffix
// chosen by a nested ternary on how it was captured.
const evidenceLabel = (ev) => `${SHORT[ev.kind] ?? 'file'}${ev.captureMode === 'IN_APP_CAMERA' ? ', live' : ev.captureMode === 'GALLERY' ? ', gallery' : ''}`

/** On site / 2.4 km away / location unknown, against the project's pin. */
// A small component; `radius` is optional.
function LocationChip({ ev, project, radius }) {
  // 'NO_PIN' | 'UNKNOWN' | 'OFF_SITE' | 'ON_SITE'.
  const status = locationStatus(ev, project, radius)
  // No site pin: nothing to compare against, render nothing.
  if (status === 'NO_PIN') return null
  // The photo had no GPS.
  if (status === 'UNKNOWN') return <Chip tone="neutral">location unknown</Chip>
  // Away from the site: amber chip with the distance.
  if (status === 'OFF_SITE') return <Chip tone="waiting">{formatDistance(ev.distanceM)} from site</Chip>
  // On site.
  return <Chip tone="verified">on site</Chip>
}

/** One sentence on where a file came from, as in the design. */
// A plain function (not a component) returning a string.
export function provenance(ev, project) {
  // Kind name in lower case, e.g. "receipt".
  const kind = (EVIDENCE_KINDS[ev.kind] ?? 'File').toLowerCase()
  // How it was captured.
  const how = ev.captureMode === 'IN_APP_CAMERA' ? 'taken with the live camera' : ev.captureMode === 'GALLERY' ? 'picked from the gallery' : 'uploaded as a file'
  // " on 3 Oct at 9:05 am", or '' when unknown.
  const when = ev.capturedAt ? ` on ${formatShortDate(ev.capturedAt)} at ${formatTime(ev.capturedAt)}` : ''
  // Location judgement.
  const status = locationStatus(ev, project)
  // Distance phrase, or "location unknown" for live photos without GPS, or nothing.
  const where =
    status === 'ON_SITE' || status === 'OFF_SITE' ? `, ${formatDistance(ev.distanceM)} from the site pin` : status === 'UNKNOWN' && ev.captureMode === 'IN_APP_CAMERA' ? ', location unknown' : ''
  // Capitalise the first letter (`kind[0].toUpperCase()` + the rest via slice(1)) and join the parts.
  return `${kind[0].toUpperCase()}${kind.slice(1)} ${how}${when}${where}. File fingerprint ${shortHash(ev.sha256)}.`
}

/**
 * Large photo tiles with a black pill saying what each one is
 * ("receipt", "delivery, live"); tap for the full file and its details.
 */
// Props: projectId, the evidence array, and an optional extra className.
export function EvidenceTiles({ projectId, evidence, className }) {
  // Project (may be used for location chips).
  const { project } = useProjectContext()
  // The evidence item currently open in the lightbox, or null.
  const [open, setOpen] = useState(null)
  // No files: a short message. `?.length` handles a missing array.
  if (!evidence?.length) return <p className="text-meta text-ink-3">No files attached.</p>
  return (
    // Fragment: the grid and the lightbox side by side, no wrapper element.
    <>
      {/* Two-column grid of tiles. */}
      <ul className={cn('grid grid-cols-2 gap-3', className)}>
        {/* One <li> per evidence item, keyed by id. */}
        {evidence.map((ev) => (
          <li key={ev.id}>
            <button
              // Open this item in the lightbox.
              onClick={() => setOpen(ev)}
              // 4:3 rounded tile, grey while loading; `group` lets children react to hover on the button.
              className="group relative block aspect-[4/3] w-full overflow-hidden rounded-tile bg-sunken text-start"
              // Accessible name, e.g. "Receipt: open".
              aria-label={`${EVIDENCE_KINDS[ev.kind]}: open`}
            >
              {/* PDFs show a file icon; images show the picture. */}
              {ev.mime === 'application/pdf' ? (
                <span className="grid h-full place-items-center text-ink-3">
                  <FileText size={30} aria-hidden />
                </span>
              ) : (
                // Image cropped to fill, zooming a little on hover; loading="lazy" defers off-screen images.
                <img src={fileUrl(projectId, ev.id)} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" loading="lazy" />
              )}
              {/* Bottom-start corner: the label pill. */}
              <span className="absolute start-2.5 bottom-2.5 flex flex-wrap gap-1.5">
                <Chip tone="verified" className="shadow">
                  {evidenceLabel(ev)}
                </Chip>
              </span>
              {/* Top-end corner: location chip, only for live photos on a project with a pin. */}
              {project?.siteLat != null && ev.captureMode === 'IN_APP_CAMERA' && (
                <span className="absolute end-2.5 top-2.5">
                  <LocationChip ev={ev} project={project} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {/* The lightbox is always mounted; it opens when `open` holds an item. */}
      <EvidenceLightbox projectId={projectId} ev={open} onClose={() => setOpen(null)} />
    </>
  )
}

/** The full file, how and where it was taken, and its fingerprint. */
export function EvidenceLightbox({ projectId, ev, onClose }) {
  const { project } = useProjectContext()
  // Timing info ({ clockOk, sentLater }) when an item is open.
  const timing = ev ? evidenceTiming(ev) : null
  // Location status when an item is open.
  const status = ev ? locationStatus(ev, project) : null
  return (
    <Sheet
      // Open whenever there's an item (`!!` to boolean).
      open={!!ev}
      // When the sheet asks to close (o is false), call onClose.
      onOpenChange={(o) => !o && onClose()}
      // Large sheet.
      size="lg"
      // Title: the caption, or the kind name (`||` falls back on empty caption).
      title={ev ? ev.caption || EVIDENCE_KINDS[ev.kind] : ''}
      // Footer content passed as a prop: an "open original" button that opens a new tab.
      footer={
        ev && (
          // `href` makes the Button a link; rel="noreferrer" is safe practice with target="_blank".
          <Button icon={ExternalLink} href={fileUrl(projectId, ev.id)} target="_blank" rel="noreferrer">
            open original
          </Button>
        )
      }
    >
      {/* Body only when an item is open. */}
      {ev && (
        <div className="flex flex-col gap-5">
          {/* The file preview area. */}
          <div className="overflow-hidden rounded-tile bg-sunken">
            {/* PDFs in an <iframe> (the browser's PDF viewer); images in an <img>. */}
            {ev.mime === 'application/pdf' ? (
              <iframe title={ev.fileName} src={fileUrl(projectId, ev.id)} className="h-[56vh] w-full" />
            ) : (
              <img src={fileUrl(projectId, ev.id)} alt={EVIDENCE_KINDS[ev.kind]} className="max-h-[56vh] w-full object-contain" />
            )}
          </div>
          {/* A card list of details, with dividers between rows. */}
          <ul className="card divide-y divide-line">
            {/* How it was captured, and its trust level. */}
            <Detail title={ev.captureMode === 'IN_APP_CAMERA' ? 'Taken with the live camera' : ev.captureMode === 'GALLERY' ? 'Picked from the gallery' : 'Uploaded as a file'}>
              {ev.captureMode === 'IN_APP_CAMERA' ? 'Stronger evidence than a saved photo' : 'Lower trust than a live photo'}
              {/* Who uploaded it, if known. */}
              {ev.uploadedByName ? ` · by ${ev.uploadedByName}` : ''}
            </Detail>
            {/* Location row, unless the project has no pin. */}
            {status !== 'NO_PIN' && (
              <Detail
                // Title from a nested ternary across several lines.
                title={
                  status === 'UNKNOWN'
                    ? 'Location unknown'
                    : status === 'ON_SITE'
                      ? `Within ${formatDistance(ev.distanceM)} of the site pin`
                      : `${formatDistance(ev.distanceM)} from the site pin`
                }
              >
                {/* With coordinates: a link to OpenStreetMap at that point; otherwise a plain sentence. */}
                {ev.lat != null ? (
                  <a className="inline-flex items-center gap-1 text-accent-700 hover:underline" href={`https://www.openstreetmap.org/?mlat=${ev.lat}&mlon=${ev.lng}#map=18/${ev.lat}/${ev.lng}`} target="_blank" rel="noreferrer">
                    <MapPin size={13} aria-hidden /> GPS accurate to {Math.round(ev.accuracyM ?? 0)} m
                  </a>
                ) : (
                  // A string is valid JSX content too.
                  'The phone did not share a location'
                )}
              </Detail>
            )}
            {/* When it was taken, and whether the phone's clock could be trusted. */}
            <Detail title={ev.capturedAt ? `Taken ${formatDateTime(ev.capturedAt)}` : 'Time taken not recorded'}>
              {/* `timing?.clockOk === false` is true only when explicitly false (not unknown). */}
              {timing?.clockOk === false
                ? 'The phone’s clock was off when it sent this'
                : timing?.sentLater
                  ? `Saved offline, sent ${formatDateTime(ev.receivedAt)}`
                  : timing?.clockOk
                    ? 'Phone time matches server time'
                    : `Received ${formatDateTime(ev.receivedAt)}`}
            </Detail>
            {/* File name and size. */}
            <Detail title="File">{`${ev.fileName} · ${formatBytes(ev.sizeBytes)}`}</Detail>
          </ul>
          {/* Fingerprint box. */}
          <div className="rounded-tile bg-sunken px-4 py-3.5">
            <p className="flex items-center gap-1.5 text-meta font-bold text-ink-2">
              <Fingerprint size={15} aria-hidden /> SHA-256 fingerprint
            </p>
            <div className="mt-1 flex items-center gap-2">
              {/* The full hash in monospace, truncated visually; `title` shows it all on hover. */}
              <code className="min-w-0 flex-1 truncate font-mono text-meta text-ink" title={ev.sha256}>
                {ev.sha256}
              </code>
              {/* Copy button: navigator.clipboard.writeText returns a Promise; `.then` shows a toast after it succeeds. */}
              <button className="grid h-9 w-9 place-items-center rounded-full hover:bg-ink/5" aria-label="Copy fingerprint" onClick={() => navigator.clipboard.writeText(ev.sha256).then(() => toast.success('Fingerprint copied'))}>
                <Copy size={15} />
              </button>
            </div>
            {/* Explanation. */}
            <p className="mt-1 text-2xs text-ink-3">Recorded when the file arrived. If anyone changed the file later, it would no longer match.</p>
          </div>
        </div>
      )}
    </Sheet>
  )
}

// One row in the details list: bold title and a grey line under it.
function Detail({ title, children }) {
  return (
    <li className="px-4 py-3">
      <p className="text-body font-semibold">{title}</p>
      <p className="mt-0.5 text-meta text-ink-3">{children}</p>
    </li>
  )
}
