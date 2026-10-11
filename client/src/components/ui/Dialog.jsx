// FILE: components/ui/Dialog.jsx — sheets and confirmation dialogs.
//
// What it does: `Sheet` is an accessible overlay panel built on Radix Dialog
// (which handles focus trapping, Esc to close, and returning focus on close),
// animated with GSAP: a bottom sheet on phones, a side panel or centred dialog
// on desktop. `ConfirmDialog` is a small centred Sheet for "are you sure?"
// questions, optionally asking for a written reason.
// Where it's used: wherever a page needs a form or a review without leaving
// (record payment, review approval, ask a question, every "are you sure").
// Re-exported from ui/index.js.
// Depends on: React hooks, radix-ui Dialog, a lucide-react close icon, `cn`,
// GSAP helpers from lib/motion.js, and the Button component.

// Named imports of four React hooks.
import { useEffect, useId, useRef, useState } from 'react'
// Radix's Dialog namespace, renamed to `D` (D.Root, D.Portal, D.Content...).
import { Dialog as D } from 'radix-ui'
// "X" close icon.
import { X } from 'lucide-react'
// Class-name joiner.
import { cn } from '../../lib/format.js'
// dirSign: +1 for left-to-right, -1 for right-to-left text direction.
// gsap: the animation library. reduced(): true if the user asked the OS for
// reduced motion. useGSAP: React hook that runs GSAP code and cleans it up.
import { dirSign, gsap, reduced, useGSAP } from '../../lib/motion.js'
// The design-system button (used in ConfirmDialog's footer).
import { Button } from './Button.jsx'

// Arrow function returning true when the screen is at least 768px wide.
// window.matchMedia evaluates a CSS media query from JavaScript.
const desktop = () => window.matchMedia('(min-width: 768px)').matches

/**
 * Accessible sheet: focus is trapped, Esc closes, focus returns on close.
 * Phones get a bottom sheet with a grab handle; on desktop it slides in from
 * the side (`side`, the default) or appears in the middle (`center`).
 *   <Sheet open={open} onOpenChange={setOpen} title="Record payment" footer={<Button/>}>…</Sheet>
 */
// Props: `open` + `onOpenChange` (controlled by the parent), `title`,
// optional `description`, body `children`, `footer` buttons, `size` (default
// 'md'), `variant` ('side' default or 'center'), extra class.
export function Sheet({ open, onOpenChange, title, description, children, footer, size = 'md', variant = 'side', className }) {
  // `open` is what the parent wants; `mounted` keeps the sheet in the DOM
  // until the close animation has finished. Radix is always told open=true
  // while mounted, so it never unmounts the content under the tween.
  // useState(open): initial value copied from the prop; setMounted updates it.
  const [mounted, setMounted] = useState(open)
  // Ref to the sheet panel DOM element (animated).
  const content = useRef(null)
  // Ref to the dimmed backdrop (animated).
  const overlay = useRef(null)
  // Setting state during render (allowed by React for this "derive from props"
  // case): as soon as the parent opens it, mount it.
  if (open && !mounted) setMounted(true)

  // useGSAP(callback, config) runs the callback after render and whenever a
  // dependency changes, reverting the tweens automatically on unmount.
  useGSAP(
    () => {
      // Nothing to animate if not mounted or the element doesn't exist yet.
      if (!mounted || !content.current) return
      // Measure the screen once.
      const wide = desktop()
      // The "off-screen" pose. Desktop centred: slightly lower, smaller and
      // invisible (autoAlpha = opacity + visibility). Desktop side: pushed
      // 104% sideways (direction flipped for RTL). Phone: pushed 104% down.
      const hidden = wide ? (variant === 'center' ? { y: 18, scale: 0.98, autoAlpha: 0 } : { xPercent: 104 * dirSign() }) : { yPercent: 104 }
      // The resting on-screen pose.
      const shown = { xPercent: 0, yPercent: 0, y: 0, scale: 1, autoAlpha: 1 }
      // Opening.
      if (open) {
        // Reduced motion: skip the animation and clear any inline styles.
        if (reduced()) return gsap.set([content.current, overlay.current], { clearProps: 'all' })
        // gsap.fromTo(target, fromVars, toVars): fade the backdrop in over 0.25s.
        gsap.fromTo(overlay.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, ease: 'power1.out' })
        // Slide the panel from hidden to shown. `{ ...shown, ... }` spreads the
        // shown pose and adds timing options.
        gsap.fromTo(content.current, hidden, { ...shown, duration: 0.5, ease: 'expo.out' })
      } else {
        // Closing with reduced motion: unmount immediately.
        if (reduced()) return setMounted(false)
        // A timeline sequences tweens; onComplete unmounts once it finishes.
        gsap
          .timeline({ onComplete: () => setMounted(false) })
          // Slide the panel out to the hidden pose (quick, accelerating).
          .to(content.current, { ...hidden, duration: 0.28, ease: 'power2.in' })
          // Fade the backdrop; '<' means "start at the same time as the previous tween".
          .to(overlay.current, { autoAlpha: 0, duration: 0.22 }, '<')
      }
    },
    // Rerun when `open` or `mounted` changes.
    { dependencies: [open, mounted] },
  )

  // Not mounted: render nothing.
  if (!mounted) return null
  // Boolean: true for the side variant.
  const side = variant !== 'center'
  return (
    // Radix Root, always open while mounted. `open` alone means open={true}.
    // When Radix wants to close (Esc, outside click, close button) `o` is
    // false; `!o && open && onOpenChange(false)` tells the parent, but only once
    // (not again while it is already closing).
    <D.Root open onOpenChange={(o) => !o && open && onOpenChange(false)}>
      {/* Portal: render at the end of <body>, above the rest of the page. */}
      <D.Portal>
        {/* Dimmed, slightly blurred full-screen backdrop; ignores clicks while closing. */}
        <D.Overlay ref={overlay} className={cn('fixed inset-0 z-50 bg-ink/35 backdrop-blur-[2px]', !open && 'pointer-events-none')} />
        {/* The panel itself. */}
        <D.Content
          // Attach the ref for GSAP.
          ref={content}
          // Spread an object of props: when there's no description, pass
          // aria-describedby={undefined} to tell Radix there's intentionally none
          // (silences its warning); otherwise spread an empty object (nothing).
          {...(description ? {} : { 'aria-describedby': undefined })}
          // Panel classes, one line per concern.
          className={cn(
            // Fixed, on top, column layout, page-coloured background, shadow, no focus outline.
            'fixed z-50 flex flex-col bg-canvas shadow-pop outline-none',
            // Phone: bottom sheet.
            'inset-x-0 bottom-0 max-h-[94dvh] rounded-t-sheet',
            // Desktop (md:) placement: pinned to the end edge as a side panel,
            // or centred in the screen with translate -50%.
            side
              ? 'md:inset-y-3 md:end-3 md:start-auto md:bottom-3 md:max-h-none md:rounded-sheet'
              : 'md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[86dvh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-sheet',
            // Desktop width by variant and size (nested ternaries).
            side ? (size === 'lg' ? 'md:w-[min(640px,calc(100vw-1.5rem))]' : 'md:w-[min(480px,calc(100vw-1.5rem))]') : size === 'sm' ? 'md:w-[440px]' : size === 'lg' ? 'md:w-[680px]' : 'md:w-[540px]',
            // Caller's classes.
            className,
          )}
        >
          {/* Grab handle bar, phones only (md:hidden), decorative. */}
          <div className="flex justify-center pt-2.5 md:hidden" aria-hidden>
            <span className="h-1.5 w-11 rounded-full bg-ink/15" />
          </div>
          {/* Header: title/description on the left, close button on the right. */}
          <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 md:px-6 md:pt-6">
            <div className="min-w-0">
              {/* D.Title is linked by Radix as the dialog's accessible name. */}
              <D.Title className="title text-title">{title}</D.Title>
              {/* D.Description is linked as its accessible description; null when absent. */}
              {description ? <D.Description className="mt-1.5 text-meta text-ink-3">{description}</D.Description> : null}
            </div>
            {/* D.Close with asChild: our own <button> becomes the close control. */}
            <D.Close asChild>
              {/* Round 40px icon button; aria-label gives it a spoken name. */}
              <button type="button" aria-label="Close" className="-me-1.5 -mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-ink/5">
                <X size={20} />
              </button>
            </D.Close>
          </div>
          {/* Scrollable body; min-h-0 + flex-1 lets it shrink and scroll inside the flex column. */}
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-5 pb-5 md:px-6">{children}</div>
          {/* Optional footer bar: buttons stacked (reversed, so the main one is on top) on
              phones, in a right-aligned row on desktop; safe-bottom pads above the phone's home bar. */}
          {footer && <div className="safe-bottom flex flex-col-reverse gap-2 border-t border-line bg-canvas px-5 py-4 md:flex-row md:justify-end md:px-6">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

/**
 * Confirmation for consequential actions, optionally asking for a reason.
 *   <ConfirmDialog title="Reject P-12?" requireNote onConfirm={(note) => …} />
 */
// Many props, with defaults for button labels and tone. `noteLabel` turns on
// the reason box; `requireNote` makes it mandatory; `onConfirm(note)` is called
// on confirm; `loading` and `error` reflect the parent's request state.
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'confirm', cancelLabel = 'cancel', tone = 'primary', noteLabel, notePlaceholder, requireNote, onConfirm, loading, error, children }) {
  // useId() generates a unique, stable id string to link the <label> to the <textarea>.
  const noteId = useId()
  // The note text the user types.
  const [note, setNote] = useState('')
  // Whether the user has tried to confirm (only then show the "missing" error).
  const [touched, setTouched] = useState(false)
  // A required note is missing if, after trimming spaces, it's empty.
  const missing = requireNote && !note.trim()
  // Effect: whenever `open` changes and the dialog is closed, reset the form.
  useEffect(() => {
    if (!open) {
      setNote('')
      setTouched(false)
    }
  }, [open])
  return (
    // Reuse Sheet as a small centred dialog.
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      variant="center"
      size="sm"
      title={title}
      description={description}
      // A prop can hold JSX: the footer is a Fragment with two buttons.
      footer={
        <>
          {/* Cancel just closes the dialog. */}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            // Map tone to a Button variant (danger, accent, or primary).
            variant={tone === 'danger' ? 'danger' : tone === 'accent' ? 'accent' : 'primary'}
            // Show the spinner while the parent's request runs.
            loading={loading}
            // Multi-statement arrow function: mark touched, then confirm only if
            // nothing required is missing, passing the trimmed note.
            onClick={() => {
              setTouched(true)
              if (!missing) onConfirm(note.trim())
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {/* Any extra content the caller nests inside. */}
      {children}
      {/* Reason box, only when a noteLabel was given. */}
      {noteLabel && (
        <div className="flex flex-col gap-1.5">
          {/* htmlFor is JSX's name for the label's `for` attribute: clicking the
              label focuses the textarea with that id. */}
          <label htmlFor={noteId} className="text-meta font-semibold text-ink-2">
            {noteLabel}
            {/* Red asterisk marking a required field. */}
            {requireNote && <span className="ms-0.5 text-danger-700">*</span>}
          </label>
          <textarea
            // Matches the label's htmlFor.
            id={noteId}
            // Three lines tall.
            rows={3}
            // Shared input styling from the global CSS.
            className="field-input"
            // Controlled input: value comes from state...
            value={note}
            placeholder={notePlaceholder}
            // Mark invalid for assistive tech only after a failed attempt.
            aria-invalid={touched && missing ? true : undefined}
            // ...and every keystroke updates state. `e.target.value` is the new text.
            onChange={(e) => setNote(e.target.value)}
            // Focus this box as soon as it appears.
            autoFocus
          />
          {/* Error message after a failed attempt. */}
          {touched && missing && <p className="text-meta font-semibold text-danger-700">Please add a short note.</p>}
        </div>
      )}
      {/* Server error from the parent, shown in a red box. */}
      {error && <p className="mt-3 rounded-tile bg-danger-50 px-3.5 py-2.5 text-meta font-semibold text-danger-700">{error}</p>}
    </Sheet>
  )
}
