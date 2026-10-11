// FILE: client/src/components/evidence/EvidenceUploader.jsx
//
// What it does: evidence "slots" on a form ("Receipt or slip", "Delivery
// photo", ...). Each slot opens the camera or a file picker, compresses the
// image and uploads it at once, showing progress and thumbnails. When the
// upload fails for network reasons the blob is kept locally (`local`) and the
// outbox sends it later.
//
// Where it's used: the purchase, report, change, payment, document and
// verify forms.
//
// Depends on: react hooks, sonner (toasts), lucide-react icons, i18n,
// lib/api.js (fileUrl, uploadEvidence), lib/format.js (cn), lib/image.js
// (compressImage), lib/net.js (isRetryable) and ./CameraCapture.jsx.

// React hooks.
import { useEffect, useRef, useState } from 'react'
// Toast notifications.
import { toast } from 'sonner'
// Icon components.
import { Camera, Check, FileText, FileUp, LoaderCircle, Smartphone, X } from 'lucide-react'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Evidence file URL builder and the upload-with-progress function.
import { fileUrl, uploadEvidence } from '../../lib/api.js'
// Class-name joiner.
import { cn } from '../../lib/format.js'
// Shrinks big photos before upload.
import { compressImage } from '../../lib/image.js'
// Is an error a connection problem?
import { isRetryable } from '../../lib/net.js'
// The in-app camera dialog.
import { CameraCapture } from './CameraCapture.jsx'

/**
 * Evidence "slots": each asks for one kind of proof and shows whether it's
 * there. Files upload as soon as they're added. With `offline`, a file that
 * can't be sent stays on the phone (marked "on phone") for the outbox.
 *
 *   <EvidenceUploader projectId slots={[{ kind, label, hint, required, kinds, multiple, pick: 'file' }]} value={files} onChange={setFiles} offline />
 *
 * `value` holds uploaded evidence rows ({ id, kind, … }) and, offline,
 * local files ({ local: true, key, kind, blob, url, name, meta }).
 */
// Props: `onChange` is a state setter from the parent (it accepts an updater function);
// `showErrors` turns on "required" messages; `offline = false` default.
export function EvidenceUploader({ projectId, slots, value, onChange, showErrors, offline = false }) {
  // Preview URLs for files kept on the phone are released when the form goes away.
  // A ref that always holds the latest `value`, so the unmount cleanup sees current data.
  const latest = useRef(value)
  latest.current = value
  // Mount-only effect whose cleanup (the inner arrow) revokes every local preview URL on unmount.
  useEffect(() => () => latest.current.forEach((e) => e.local && URL.revokeObjectURL(e.url)), [])
  return (
    // Vertical stack of slots.
    <div className="flex flex-col gap-2.5">
      {/* One <Slot> per slot definition. */}
      {slots.map((slot) => (
        <Slot
          // Unique key per slot kind.
          key={slot.kind}
          projectId={projectId}
          slot={slot}
          offline={offline}
          // The files belonging to this slot: those whose kind is in slot.kinds (or just slot.kind).
          items={value.filter((e) => (slot.kinds ?? [slot.kind]).includes(e.kind))}
          // Add: call the parent's setter with an updater `(v) => [...v, ev]` (old list plus the new one).
          onAdd={(ev) => onChange((v) => [...v, ev])}
          // Remove: free a local preview URL, then filter it out (local items by key, uploaded by id).
          onRemove={(ev) => {
            if (ev.local) URL.revokeObjectURL(ev.url)
            onChange((v) => v.filter((e) => (ev.local ? e.key !== ev.key : e.id !== ev.id)))
          }}
          showErrors={showErrors}
        />
      ))}
    </div>
  )
}

/**
 * Upload one picked or captured file, or keep it on the phone when there's no
 * signal. A local entry carries the compressed blob and its capture meta, so
 * the form can hand it to the outbox (lib/outbox/store.js enqueue) later;
 * `url` is an object URL for the thumbnail. Forms that don't pass `offline`
 * (payments, documents, changes) just report the error.
 */
// A custom hook; second parameter destructures `offline` and `onAdd`.
function useEvidenceUpload(projectId, { offline, onAdd }) {
  const { t } = useI18n()
  const [pending, setPending] = useState([]) // { key, progress }
  // Async arrow function: process one file.
  const add = async (file, meta) => {
    // A unique-enough key: timestamp plus random base-36 characters (`slice(2)` drops "0.").
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    // Add a pending entry; the updater form `(p) => …` uses the latest state.
    setPending((p) => [...p, { key, progress: 0 }])
    // Shrink the image (or get the original back).
    const prepared = await compressImage(file)
    // Default capture mode, overridden by whatever `meta` provides.
    const full = { captureMode: 'IN_APP_CAMERA', ...meta }
    try {
      // Known offline: skip the attempt by throwing a status-0 error. Object.assign copies
      // `{ status: 0 }` onto the new Error object and returns it.
      if (navigator.onLine === false && offline) throw Object.assign(new Error('offline'), { status: 0 })
      // Upload, updating this entry's progress as it goes (map replaces only the matching key).
      const ev = await uploadEvidence(projectId, prepared, full, (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))))
      // Hand the server's evidence row to the form.
      onAdd(ev)
    } catch (err) {
      // Network trouble on an offline-capable form: keep the file on the phone.
      if (offline && isRetryable(err)) {
        // A local entry with the blob and a blob: URL for the thumbnail.
        onAdd({ local: true, key, kind: full.kind, captureMode: full.captureMode, blob: prepared, name: prepared.name, url: URL.createObjectURL(prepared), meta: full })
        // Tell the person it was saved.
        toast(t('outbox.savedToast'))
      // Any other error: show it.
      } else toast.error(err.message)
    } finally {
      // Always remove the pending entry, success or failure.
      setPending((p) => p.filter((x) => x.key !== key))
    }
  }
  // Expose the add function and the pending list.
  return { add, pending }
}

/**
 * One slot: empty, it's a dashed target; filled, a card with thumbnails. A
 * slot with `kinds` accepts several evidence kinds (receipt / invoice / slip)
 * but captures as `kind`. Camera photos get IN_APP_CAMERA; picked files are
 * GALLERY (or FILE for PDFs), which the owner sees as lower trust.
 */
function Slot({ projectId, slot, items, onAdd, onRemove, showErrors, offline }) {
  const { t } = useI18n()
  // Ref to the hidden <input type="file">, so a button can "click" it.
  const input = useRef(null)
  // Is the camera dialog open?
  const [camera, setCamera] = useState(false)
  // Upload helper for this slot.
  const { add, pending } = useEvidenceUpload(projectId, { offline, onAdd })
  // Has at least one file.
  const satisfied = items.length > 0
  // Show the "required" error?
  const missing = slot.required && !satisfied && showErrors
  // The first file, used for the main thumbnail.
  const first = items[0]
  // Screenshots and PDFs (payment proof, documents) start from the file picker; site proof starts from the camera.
  const fileFirst = slot.pick === 'file'
  // Main action: open the file picker (`?.click()` if the input exists) or the camera.
  const openMain = () => (fileFirst ? input.current?.click() : setCamera(true))

  // Change handler for the file input; `e` is the change event.
  const pick = (e) => {
    // e.target.files is a FileList (iterable); `?? []` guards against null.
    for (const file of e.target.files ?? []) {
      // Start uploading each file with its metadata.
      add(file, {
        kind: slot.kind,
        // PDFs count as FILE, images as GALLERY.
        captureMode: file.type === 'application/pdf' ? 'FILE' : 'GALLERY',
        // The file's own modified time, as an ISO string, if known.
        capturedAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined,
      })
    }
    // Reset the input so picking the same file again still fires onChange.
    e.target.value = ''
  }

  // Nothing yet and nothing uploading.
  if (!satisfied && !pending.length) {
    // Empty slot: one big dashed target that opens the camera.
    return (
      <div>
        <button
          // type="button" so it doesn't submit the surrounding form.
          type="button"
          onClick={openMain}
          // Full-width dashed rounded target; red tint when missing, blue border otherwise.
          className={cn(
            'flex w-full items-center gap-3.5 rounded-tile border-[1.5px] border-dashed p-4 text-start transition hover:bg-accent-50/50',
            missing ? 'border-danger-500 bg-danger-50/40' : 'border-accent-500 bg-white',
          )}
        >
          {/* Round icon badge: file icon or camera icon. */}
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-50 text-accent-700">
            {fileFirst ? <FileUp size={20} aria-hidden /> : <Camera size={20} aria-hidden />}
          </span>
          {/* Label and optional hint. */}
          <span className="min-w-0 flex-1">
            <span className="block text-body font-bold">{slot.label}</span>
            {slot.hint && <span className="block text-meta text-ink-3">{slot.hint}</span>}
          </span>
          {/* "optional" tag for non-required slots. */}
          {!slot.required && <span className="text-2xs font-semibold text-ink-3">{t('common.optional')}</span>}
        </button>
        {/* The secondary action, right-aligned: the other way of adding a file. */}
        <div className="mt-1.5 flex justify-end">
          <button type="button" onClick={() => (fileFirst ? setCamera(true) : input.current?.click())} className="px-1 text-meta font-semibold text-accent-700 hover:text-accent-800">
            {fileFirst ? 'take a photo instead' : t('today.uploadInstead')}
          </button>
        </div>
        {/* Required-field message; `??` gives a default text. */}
        {missing && <p className="mt-1 px-1 text-meta font-semibold text-danger-700">{slot.missingText ?? 'This is required before you can submit.'}</p>}
        {/* Hidden file input; `ref={input}` lets us click it from code. */}
        <FileInput ref={input} slot={slot} onChange={pick} />
        {/* Camera dialog. onUpload uses the comma operator: close the camera, then open the picker. */}
        <CameraCapture open={camera} onOpenChange={setCamera} modes={[slot.kind]} onCapture={(file, meta) => add(file, meta)} onUpload={() => (setCamera(false), input.current?.click())} />
      </div>
    )
  }

  // Filled (or uploading) slot.
  return (
    <div className="card p-3">
      {/* Header row: main thumbnail, label/status, tick. */}
      <div className="flex items-center gap-3">
        <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-sunken">
          {/* First file's thumbnail, or a spinning loader while the first upload runs. */}
          {first ? <Thumb projectId={projectId} ev={first} /> : <LoaderCircle size={18} className="absolute inset-0 m-auto animate-spin text-ink-3" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-body font-bold">{slot.label}</span>
          <span className="block text-meta text-ink-3">
            {/* Status via chained ternaries: upload % / saved on phone / live photo / attached. */}
            {pending.length
              ? `Uploading ${Math.round((pending[0].progress ?? 0) * 100)}%`
              : first?.local
                ? 'Saved on this phone'
                : first?.captureMode === 'IN_APP_CAMERA'
                  ? 'Attached, live photo'
                  : 'Attached'}
            {/* File count when more than one. */}
            {items.length > 1 ? ` · ${items.length} files` : ''}
          </span>
        </span>
        {/* Blue tick once something is attached. */}
        {satisfied && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-600 text-white" aria-label="Added">
            <Check size={15} strokeWidth={3} />
          </span>
        )}
      </div>
      {/* Thumbnail strip when there are several files or the slot allows more. */}
      {(items.length > 1 || slot.multiple !== false) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {/* One thumbnail per file; local files are keyed by `key`, uploaded ones by `id`. */}
          {items.map((ev) => (
            <li key={ev.local ? ev.key : ev.id} className="relative">
              <span className="relative block h-16 w-16 overflow-hidden rounded-xl bg-sunken">
                <Thumb projectId={projectId} ev={ev} />
              </span>
              {/* Small round "×" in the corner to remove the file. */}
              <button
                type="button"
                onClick={() => onRemove(ev)}
                className="absolute -end-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-ink text-white ring-2 ring-white"
                aria-label="Remove"
              >
                <X size={13} />
              </button>
            </li>
          ))}
          {/* Dashed "add another" square, unless the slot is single-file. */}
          {slot.multiple !== false && (
            <li>
              <button
                type="button"
                onClick={openMain}
                className="grid h-16 w-16 place-items-center rounded-xl border-[1.5px] border-dashed border-accent-500 text-accent-700"
                aria-label={`Add another: ${slot.label}`}
              >
                {fileFirst ? <FileUp size={18} aria-hidden /> : <Camera size={18} aria-hidden />}
              </button>
            </li>
          )}
        </ul>
      )}
      {/* Same hidden input and camera dialog as the empty state. */}
      <FileInput ref={input} slot={slot} onChange={pick} />
      <CameraCapture open={camera} onOpenChange={setCamera} modes={[slot.kind]} onCapture={(file, meta) => add(file, meta)} onUpload={() => (setCamera(false), input.current?.click())} />
    </div>
  )
}

// In React 19, `ref` can be received as a normal prop by function components.
function FileInput({ ref, slot, onChange }) {
  // A visually hidden file input: accepts the slot's types (default images and PDFs), multiple
  // unless the slot says otherwise, and tabIndex={-1} keeps it out of the keyboard Tab order.
  return <input ref={ref} type="file" accept={slot.accept ?? 'image/*,application/pdf'} multiple={slot.multiple !== false} className="sr-only" onChange={onChange} tabIndex={-1} />
}

/** Small preview: the uploaded file, or the copy still on the phone. */
function Thumb({ projectId, ev }) {
  // Taken with the in-app camera?
  const live = ev.captureMode === 'IN_APP_CAMERA'
  return (
    <>
      {/* PDF icon, or the image (local blob URL, or the server URL). */}
      {ev.mime === 'application/pdf' ? (
        <span className="grid h-full w-full place-items-center text-ink-3">
          <FileText size={20} aria-hidden />
        </span>
      ) : (
        <img src={ev.local ? ev.url : fileUrl(projectId, ev.id)} alt="" className="h-full w-full object-cover" loading="lazy" />
      )}
      {/* Tiny label strip along the bottom: amber "on phone", dark "live", lighter "gallery". */}
      <span className={cn('absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 py-0.5 text-[9px] font-bold text-white', ev.local ? 'bg-warn-600/90' : live ? 'bg-ink/80' : 'bg-ink/55')}>
        {ev.local ? (
          <>
            <Smartphone size={9} aria-hidden /> on phone
          </>
        ) : live ? (
          'live'
        ) : (
          'gallery'
        )}
      </span>
    </>
  )
}
