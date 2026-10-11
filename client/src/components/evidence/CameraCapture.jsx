// FILE: client/src/components/evidence/CameraCapture.jsx
//
// What it does: a full-screen in-app camera. It opens the device camera,
// watches GPS while open, stamps each shot with capture mode, time and
// location (the server later checks the distance to the site pin), lets the
// person review/retake, and hands the file to the caller.
//
// Where it's used: EvidenceUploader (receipts, delivery and site photos) and
// the Today page's "take a photo" tile.
//
// Depends on: react hooks, radix-ui Dialog (accessible modal), lucide-react
// icons, shared/geo.js (distance to the site pin), i18n, ProjectContext (the
// project's site pin), lib/format.js (cn) and lib/motion.js (GSAP).
// Browser APIs: getUserMedia (camera), geolocation.watchPosition, <canvas>,
// URL.createObjectURL / revokeObjectURL.

// React hooks.
import { useEffect, useRef, useState } from 'react'
// Radix UI's Dialog primitives, imported under the short alias `D` (`as` renames).
import { Dialog as D } from 'radix-ui'
// Icon components.
import { ImageUp, MapPin, RefreshCw, SwitchCamera, X } from 'lucide-react'
// Distance between a GPS fix and the site pin, and "120 m" style formatting.
import { distanceFromSite, formatDistance } from '@shared/geo.js'
// Translation hook (`../../` = up two folders).
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Current project (for its site pin).
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Class-name joiner.
import { cn } from '../../lib/format.js'
// GSAP, the reduce-motion check and the GSAP React hook.
import { gsap, reduced, useGSAP } from '../../lib/motion.js'

/**
 * The live camera, full screen on phones. It records when and where each
 * photo is taken and shows how far from the site pin you are while aiming.
 * Photos taken here carry more weight than files picked from the gallery.
 *
 *   <CameraCapture open onOpenChange onCapture={(file, meta) => …} modes={['RECEIPT', 'DELIVERY_PHOTO', 'PHOTO']} />
 * `meta` is { kind, capturedAt, lat, lng, accuracyM }.
 */
// Props: open (boolean), onOpenChange(open), onCapture(file, meta), modes (array, default
// ['PHOTO']), initialMode, and optional onUpload (shows an "upload instead" link).
export function CameraCapture({ open, onOpenChange, onCapture, modes = ['PHOTO'], initialMode, onUpload }) {
  // Translation function.
  const { t } = useI18n()
  // The current project.
  const { project } = useProjectContext()
  // Ref to the <video> element showing the live camera.
  const video = useRef(null)
  // The active MediaStream (kept in a ref, not state, because changing it shouldn't re-render).
  const stream = useRef(null)
  // Ref to the dialog panel, for the open animation.
  const panel = useRef(null)
  // Which camera: 'environment' (back) or 'user' (front). useState returns [value, setter].
  const [facing, setFacing] = useState('environment')
  const [errorKey, setErrorKey] = useState(null) // translated at render, so a language switch doesn't restart the camera
  const [shot, setShot] = useState(null) // { url, file, meta }
  // Selected capture mode (receipt, delivery, photo); `??` falls back to the first mode.
  const [mode, setMode] = useState(initialMode ?? modes[0])
  const [fix, setFix] = useState(null) // { lat, lng, accuracyM } | 'off' | null while searching
  // Blob URL of the last accepted photo (thumbnail in the corner).
  const [last, setLast] = useState(null)
  // The translated error message, or null.
  const error = errorKey ? t(errorKey) : null

  // Each time the camera opens, reset the mode. The trailing eslint comment
  // (which must stay exactly on that line) silences the "missing dependencies" lint rule on purpose.
  useEffect(() => {
    if (open) setMode(initialMode ?? modes[0])
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // The last photo's preview is a blob URL; release it when replaced or when the camera goes away.
  // The effect returns a cleanup arrow; React runs it before the next `last` value and on unmount.
  // URL.revokeObjectURL frees the memory held by a URL made with createObjectURL.
  useEffect(() => () => last && URL.revokeObjectURL(last), [last])

  // Camera stream while open and not reviewing a shot. Stopping the tracks on
  // cleanup turns the phone's camera light off; `cancelled` covers a stream
  // that resolves after the dialog has already closed or the lens switched.
  useEffect(() => {
    // Closed, or showing a taken photo: no camera needed.
    if (!open || shot) return
    // Local flag captured by the closures below; set true by the cleanup.
    let cancelled = false
    // Clear any old error.
    setErrorKey(null)
    // No camera API (old browser, or not served over HTTPS).
    if (!navigator.mediaDevices) {
      setErrorKey('camera.none')
      return
    }
    // getUserMedia asks permission and returns a Promise of a MediaStream.
    navigator.mediaDevices
      // Constraints: chosen camera, preferred ("ideal") resolution, no microphone.
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      // Success: `s` is the stream.
      .then((s) => {
        // Too late (dialog closed): stop every track immediately and bail out.
        if (cancelled) return s.getTracks().forEach((tr) => tr.stop())
        // Keep it so cleanup can stop it.
        stream.current = s
        // Show it in the <video> element.
        if (video.current) video.current.srcObject = s
      })
      // Failure: permission denied vs. no camera.
      .catch((err) => setErrorKey(err?.name === 'NotAllowedError' ? 'camera.blocked' : 'camera.none'))
    // Cleanup: runs when open/facing/shot change or the component unmounts.
    return () => {
      cancelled = true
      // Stop every track (turns the camera off).
      stream.current?.getTracks().forEach((tr) => tr.stop())
      stream.current = null
    }
  }, [open, facing, shot])

  // GPS while the camera is open: a watch rather than one read, so the fix
  // tightens while the person aims and the photo gets the latest one.
  useEffect(() => {
    // Only while open.
    if (!open) return
    // No geolocation support.
    if (!navigator.geolocation) {
      setFix('off')
      return
    }
    // null = "searching".
    setFix(null)
    // watchPosition calls the success callback every time the position updates; returns a watch id.
    const id = navigator.geolocation.watchPosition(
      // Store each new fix.
      (p) => setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
      // Error (denied, unavailable).
      () => setFix('off'),
      // Use GPS, accept fixes up to 5 s old, give up a single attempt after 20 s.
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
    // Cleanup stops watching.
    return () => navigator.geolocation.clearWatch(id)
  }, [open])

  // Open animation, re-run whenever `open` changes.
  useGSAP(
    () => {
      // Skip when closed, not mounted, or reduce-motion.
      if (!open || !panel.current || reduced()) return
      // gsap.fromTo(target, fromVars, toVars): fade in and scale up slightly.
      gsap.fromTo(panel.current, { autoAlpha: 0, scale: 0.98 }, { autoAlpha: 1, scale: 1, duration: 0.35, ease: 'power2.out' })
    },
    { dependencies: [open] },
  )

  // Called by the dialog with the new open state `o`.
  const close = (o) => {
    // When closing, discard any unaccepted shot and free its URL.
    if (!o) {
      if (shot) URL.revokeObjectURL(shot.url)
      setShot(null)
    }
    // Tell the parent.
    onOpenChange(o)
  }

  // Frame grab from the video element, capped at 1800 px like compressImage,
  // stamped with the mode, the time and the current GPS fix.
  const capture = () => {
    // The <video> DOM element.
    const v = video.current
    // No frame yet (videoWidth is 0 until the stream starts).
    if (!v?.videoWidth) return
    // Off-screen canvas to draw the frame onto.
    const canvas = document.createElement('canvas')
    // Shrink factor, never above 1.
    const scale = Math.min(1, 1800 / Math.max(v.videoWidth, v.videoHeight))
    canvas.width = Math.round(v.videoWidth * scale)
    canvas.height = Math.round(v.videoHeight * scale)
    // Copy the current video frame onto the canvas.
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height)
    // GPS fields to attach, or an empty object when there's no fix.
    const gps = fix && fix !== 'off' ? fix : {}
    // Encode the canvas as JPEG; the callback receives the Blob.
    canvas.toBlob(
      (blob) => {
        // Wrap as a File with a timestamped name.
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' })
        // createObjectURL gives a temporary "blob:" URL usable in <img src>. Spread `...gps` adds lat/lng/accuracy.
        setShot({ url: URL.createObjectURL(blob), file, meta: { kind: mode, capturedAt: new Date().toISOString(), ...gps } })
      },
      // Output format and JPEG quality.
      'image/jpeg',
      0.86,
    )
  }

  // Metres from the site pin, when we have a fix.
  const distance = fix && fix !== 'off' ? distanceFromSite(project, fix) : null
  // Status text via chained ternaries: GPS off / locating / no site pin / distance from site.
  const gpsText =
    fix === 'off'
      ? t('camera.gpsOff')
      : !fix
        ? t('camera.locating')
        : project.siteLat == null
          ? `${t('camera.noPin')} · ${t('camera.accuracy', { a: fix.accuracyM })}`
          : `${t('camera.fromSite', { d: formatDistance(distance) })} · ${t('camera.accuracy', { a: fix.accuracyM })}`

  return (
    // Radix Dialog root: controlled by `open`; calls `close` when it wants to open/close.
    <D.Root open={open} onOpenChange={close}>
      {/* Portal renders the dialog at the end of <body>, outside the page's layout. */}
      <D.Portal>
        {/* Dark translucent backdrop over the page. */}
        <D.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <D.Content
          // Ref for the open animation.
          ref={panel}
          // No description element; passing undefined silences Radix's warning.
          aria-describedby={undefined}
          // Full-screen black column on phones; on md+ a centred rounded panel of bounded size.
          className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none md:inset-auto md:top-1/2 md:left-1/2 md:h-[min(760px,92dvh)] md:w-[min(560px,92vw)] md:-translate-x-1/2 md:-translate-y-1/2 md:overflow-hidden md:rounded-sheet"
        >
          {/* Dialog title for screen readers only. */}
          <D.Title className="sr-only">{t('camera.title')}</D.Title>
          {/* Viewfinder area: takes the remaining height. */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {/* Three-way choice: error message, the taken shot, or the live video. */}
            {error ? (
              <div className="grid h-full place-items-center p-8 text-center text-body text-white/85">{error}</div>
            ) : shot ? (
              // Review the photo; alt="" because it's decorative here.
              <img src={shot.url} alt="" className="h-full w-full object-contain" />
            ) : (
              <>
                {/* Live preview: autoPlay starts it, playsInline stops iOS going full screen, muted is required for autoplay. */}
                <video ref={video} autoPlay playsInline muted className="h-full w-full object-cover" />
                {/* Thirds grid, as on a phone camera. */}
                <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3" aria-hidden>
                  {/* Array.from({ length: 9 }, fn) builds 9 items; `(_, i)` ignores the value and uses the index as key. */}
                  {Array.from({ length: 9 }, (_, i) => (
                    <span key={i} className="border-[0.5px] border-white/20" />
                  ))}
                </div>
              </>
            )}
            {/* Top bar over the viewfinder, below the phone's notch (safe-area-inset-top). */}
            <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] flex items-center gap-2">
              {/* asChild: Radix gives its close behaviour to our own <button> instead of rendering another. */}
              <D.Close asChild>
                <button className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/45 backdrop-blur" aria-label="Close camera">
                  <X size={20} />
                </button>
              </D.Close>
              {/* GPS status pill; role="status" makes screen readers announce changes. */}
              <span className="flex min-w-0 items-center gap-2 rounded-full bg-black/45 px-3.5 py-2 text-meta font-semibold backdrop-blur" role="status">
                <MapPin size={15} className="shrink-0" aria-hidden />
                <span className="truncate">{gpsText}</span>
              </span>
            </div>
          </div>

          {/* Bottom controls; safe-bottom keeps them above the home indicator. */}
          <div className="safe-bottom flex flex-col items-center gap-4 bg-black px-5 pt-4 pb-5">
            {/* Mode picker: only with more than one mode and while not reviewing. */}
            {modes.length > 1 && !shot && (
              <div role="radiogroup" aria-label="What are you photographing?" className="flex gap-1 rounded-full bg-white/12 p-1">
                {/* One radio-style button per mode. */}
                {modes.map((m) => (
                  <button
                    // Unique key per mode.
                    key={m}
                    // Behaves as a radio option for assistive tech.
                    role="radio"
                    // Checked when it's the current mode.
                    aria-checked={mode === m}
                    // Arrow so setMode runs on click, not during render.
                    onClick={() => setMode(m)}
                    // White pill when selected, plain text otherwise.
                    className={cn('h-9 rounded-full px-4 text-meta font-semibold transition', mode === m ? 'bg-white text-ink' : 'text-white/85')}
                  >
                    {/* Translation key built with a template literal, e.g. camera.RECEIPT. */}
                    {t(`camera.${m}`)}
                  </button>
                ))}
              </div>
            )}
            {/* Reviewing a shot: Retake / Use buttons; otherwise the shutter row. */}
            {shot ? (
              <div className="flex w-full gap-3">
                <button
                  // Comma operator: run both expressions in order (free the URL, then clear the shot).
                  onClick={() => (URL.revokeObjectURL(shot.url), setShot(null))}
                  // Outlined full-width half button.
                  className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full border border-white/70 font-semibold"
                >
                  <RefreshCw size={17} aria-hidden /> {t('camera.retake')}
                </button>
                <button
                  // Accept the photo: block-bodied arrow with several statements.
                  onClick={() => {
                    // The shot's URL lives on as the thumbnail of the last photo.
                    setLast(shot.url)
                    // Give the file and its metadata to the parent.
                    onCapture(shot.file, shot.meta)
                    // Clear the review state and close.
                    setShot(null)
                    onOpenChange(false)
                  }}
                  // Solid white half button.
                  className="h-12 flex-1 rounded-full bg-white font-semibold text-ink"
                >
                  {t('camera.use')}
                </button>
              </div>
            ) : (
              // Three columns: last-photo thumbnail, shutter, switch camera.
              <div className="grid w-full grid-cols-3 items-center">
                <span className="flex items-center gap-3">
                  {/* Thumbnail of the last accepted photo, or an empty spacer of the same size. */}
                  {last ? <img src={last} alt="" className="h-11 w-11 rounded-xl object-cover ring-2 ring-white/60" /> : <span className="h-11 w-11" />}
                </span>
                <button
                  // Take the photo.
                  onClick={capture}
                  // Disabled when there's an error (`!!` turns the string into a boolean).
                  disabled={!!error}
                  // Accessible name (the button has no text).
                  aria-label={t('camera.capture')}
                  // Big round shutter ring that shrinks when pressed and fades when disabled.
                  className="mx-auto grid h-[74px] w-[74px] place-items-center rounded-full border-4 border-white/90 transition active:scale-95 disabled:opacity-40"
                >
                  {/* The solid inner circle of the shutter. */}
                  <span className="h-[58px] w-[58px] rounded-full bg-white" />
                </button>
                <span className="flex flex-col items-end gap-2">
                  {/* Switch lens. setFacing with a function `(f) => …` computes the new value from the previous one. */}
                  <button onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} disabled={!!error} className="grid h-11 w-11 place-items-center rounded-full bg-white/12" aria-label={t('camera.switch')}>
                    <SwitchCamera size={19} />
                  </button>
                </span>
              </div>
            )}
            {/* Footer row: "live" indicator and the optional upload link. */}
            <div className="flex w-full items-center justify-between text-2xs font-semibold text-white/70">
              <span className="flex items-center gap-1.5">
                {/* Green dot (arbitrary hex colour in Tailwind's [..] syntax) and the label. */}
                <span className="h-2 w-2 rounded-full bg-[#3ddc84]" aria-hidden /> {t('camera.live')}
              </span>
              {/* Only when the parent passed onUpload. */}
              {onUpload && (
                <button onClick={onUpload} className="flex items-center gap-1.5 text-white/85 underline-offset-4 hover:underline">
                  <ImageUp size={14} aria-hidden /> {t('today.uploadInstead')}
                </button>
              )}
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
