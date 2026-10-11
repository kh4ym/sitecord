// /p/:id/today (field home: contractor, supervisor, self-managing owner).
// Two big actions (daily report, add purchase), "take a photo" straight to the
// outbox, the outbox itself, today's steps and what needs this person.
//
// FILE OVERVIEW
// What it does: the "home screen" for people working on site. From top to bottom:
//   - a heading with today's date, the project name and the current stage;
//   - two big tiles: "daily report" (or a link to the report already sent today)
//     and "add purchase";
//   - QuickPhoto: a button that opens the camera; the photo is compressed and put
//     in the offline "outbox" (a queue on the phone that uploads when there is
//     signal), so it works without internet;
//   - OutboxList: what is still waiting to be sent;
//   - the work steps for the current stage, with a progress editor (only online);
//   - "needs you": items waiting for this person (approvals etc.).
// Route: /p/:id/today.
// Who can see it: field roles (contractor, supervisor) and an owner who manages
//   the site themselves. Individual tiles are hidden when the person lacks the
//   permission (can('submitReport'), can('createExpense'), can('updateProgress')).
// Data it loads: useToday (today's report, photos, waiting items) and usePlan
//   (the stage/step plan, for inspections) from lib/queries.js; the outbox items
//   from useOutbox; network status from useOnline.
// Depends on: React hooks, React Router <Link>, sonner toasts, lucide icons,
//   shared stage config, the camera, outbox, waiting list and work-items
//   components, the UI kit, i18n, the project context, image compression and
//   the offline outbox store.

// Named imports of two React hooks.
import { useRef, useState } from 'react'
// <Link> is React Router's version of <a>: it changes page without a full browser reload.
import { Link } from 'react-router'
// Toast pop-up notifications.
import { toast } from 'sonner'
// Icon components.
import { Camera, ChevronRight, ClipboardPen, Receipt } from 'lucide-react'
// stagesFor(project) returns the list of building stages for that project.
import { stagesFor } from '@shared/features.js'
// Full-screen in-app camera component.
import { CameraCapture } from '../../components/evidence/CameraCapture.jsx'
// Shows items waiting in the offline outbox.
import { OutboxList } from '../../components/OutboxList.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// Rows of "things waiting for you".
import { WaitingRows } from '../../components/WaitingList.jsx'
// The checklist of work steps for a stage.
import { WorkItems } from '../../components/WorkItems.jsx'
// UI kit pieces: error screen, icon in a coloured tile, loading placeholder, section heading.
import { ErrorState, IconTile, PageSkeleton, SectionHead } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// The bell menu with notifications.
import { NotificationsMenu } from '../../components/Notifications.jsx'
// Page heading component.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project, permissions and feature flags.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// cn(...) joins CSS class names together (skipping empty ones).
import { cn } from '../../lib/format.js'
// Makes a photo file smaller before it is stored/uploaded.
import { compressImage } from '../../lib/image.js'
// Hook that returns true/false for "the device has internet".
import { useOnline } from '../../lib/net.js'
// enqueue(item) saves an item into the offline outbox (stored on the device) so it is sent later.
import { enqueue } from '../../lib/outbox/store.js'
// Hook that lists the outbox items for a project.
import { useOutbox } from '../../lib/outbox/useOutbox.js'
// Query hooks: the project plan and today's summary.
import { usePlan, useToday } from '../../lib/queries.js'
// Hook that holds the progress percentage and saves changes to it.
import { useProgressEditor } from '../../lib/useProgressEditor.js'

/** Field home: two big tiles, a camera, what's waiting to send, and today's steps. */
// The page component, exported as the default export of this file.
export default function TodayPage() {
  // Destructure the project, the permission checker `can(action)` and the feature flags from context.
  const { project, can, features } = useProjectContext()
  // t = translate, term = translate a construction term, locale = current language code ('en' or 'ur').
  const { t, term, locale } = useI18n()
  // Query hook result: `data` once loaded, `isLoading` while fetching, `error` if it failed, `refetch()` to try again.
  const { data, isLoading, error, refetch } = useToday(project.id)
  // Another query, kept as one object (plan.data, plan.isLoading...).
  const plan = usePlan(project.id)
  // progress.value is the current percentage; progress.set(v, ...) changes it.
  const progress = useProgressEditor(project)
  // true when online, false when offline.
  const online = useOnline()
  // Destructuring with a rename: take `items` from the hook's result and call it `outbox` here.
  const { items: outbox } = useOutbox(project.id)
  // Template literal: the base URL for this project's pages, e.g. "/p/42".
  const base = `/p/${project.id}`

  // While loading, show a grey skeleton instead of the page. Note: hooks above must always run before any early return.
  if (isLoading) return <PageSkeleton />
  // If loading failed, show an error with a "retry" button that calls refetch.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Array indexing: pick the current stage out of the list of stages.
  const stage = stagesFor(project)[project.stageIndex]
  // Optional chaining through the plan (it may still be loading). flatMap maps each step to its inspections array and flattens the result into one list. `?? []` = empty list if anything was missing.
  const inspections = plan.data?.stages[project.stageIndex]?.steps.flatMap((s) => s.inspections) ?? []
  // .some(): true if any outbox item is a report, i.e. a report is saved on the phone but not sent yet.
  const reportQueued = outbox.some((i) => i.kind === 'REPORT')
  // Today's date as words, e.g. "Saturday 3 October". The ternary picks the Urdu (Pakistan) or British English format.
  const dateLine = new Date().toLocaleDateString(locale === 'ur' ? 'ur-PK' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  // The JSX that is drawn on screen.
  return (
    // Narrow page wrapper.
    <Page width="narrow">
      {/* Page heading with props on separate lines. */}
      <PageTitle
        // Translated title.
        title={t('today.title')}
        // e.g. "Saturday 3 October. My House, foundation."
        kicker={`${dateLine}. ${project.name}, ${term(stage.label).toLowerCase()}.`}
        // A JSX element as a prop: the notifications bell, hidden on large screens (lg:hidden) where the sidebar has its own.
        actions={
          <span className="lg:hidden">
            <NotificationsMenu />
          </span>
        }
      />

      {/* Vertical stack of sections. */}
      <div className="flex flex-col gap-6">
        {/* Two-column grid for the two big tiles. */}
        <div data-reveal className="grid grid-cols-2 gap-3">
          {/* Only people allowed to submit reports get the report tile (`&&` conditional rendering). */}
          {can('submitReport') && (
            <Tile
              // If a report was already sent today, link to it; otherwise link to the new-report form.
              to={data.reportToday ? `${base}/reports/${data.reportToday.id}` : `${base}/reports/new`}
              // Passing the icon component itself (not <ClipboardPen />) so Tile can draw it.
              icon={ClipboardPen}
              title={t('today.reportTile')}
              // Nested ternaries: "sent" / "saved on phone" / "due". In the last case, a nested template literal appends " · N photos today"
              // when there are photos (t(key, { n }) fills the number in; the key picks singular or plural).
              hint={data.reportToday ? t('today.reportSent') : reportQueued ? t('today.reportSaved') : `${t('today.reportDue')}${data.photos.length ? ` · ${t(data.photos.length === 1 ? 'today.photoToday' : 'today.photosToday', { n: data.photos.length })}` : ''}`}
              // Dark tile.
              tone="ink"
            />
          )}
          {/* Purchase tile, only for people allowed to record expenses; orange "accent" colour. */}
          {can('createExpense') && <Tile to={`${base}/purchases/new`} icon={Receipt} title={t('today.purchaseTile')} hint={t('today.purchaseHint')} tone="accent" />}
        </div>

        {/* The "take a photo" button (component defined below). */}
        <QuickPhoto />

        {/* Items still waiting to upload. */}
        <OutboxList projectId={project.id} />

        {/* Today's work steps. */}
        <section data-reveal className="flex flex-col gap-3">
          {/* Heading with "Stage · 40%". */}
          <SectionHead title={t('today.work')} meta={`${term(stage.label)} · ${progress.value}%`} />
          <WorkItems
            // The current stage.
            stage={stage}
            // Current progress percentage.
            progress={progress.value}
            // Can only be edited with permission AND while online (both must be true for `&&` to give true).
            editable={can('updateProgress') && online}
            // When the user changes progress, save the new value `v` (the second argument 0 is passed through to the editor).
            onChange={(v) => progress.set(v, 0)}
            // Inspections planned for this stage.
            inspections={inspections}
            // Only show inspection info if that feature is on.
            showInspection={features.inspections}
          />
          {/* Warn people who could edit progress that they need signal to do so. */}
          {can('updateProgress') && !online && <p className="px-1 text-meta text-warn-800">{t('progress.needsSignal')}</p>}
        </section>

        {/* "Needs you" section, only when something is waiting. */}
        {data.waiting.length > 0 && (
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title={t('today.needs')} />
            {/* Show at most 5 waiting rows. Numbers in JSX props go inside {}. */}
            <WaitingRows items={data.waiting} limit={5} />
          </section>
        )}
      </div>
    </Page>
  )
}

// One big tappable tile. Parameter destructuring: the props object is unpacked into variables.
// `icon: Icon` renames the prop to a capitalised name, because JSX treats capitalised names as components (<Icon />).
function Tile({ to, icon: Icon, title, hint, tone }) {
  return (
    // Router link to the target page.
    <Link
      // Where to go.
      to={to}
      // cn() combines the shared classes with tone-specific ones chosen by a ternary (dark ink tile or orange accent tile).
      // Shared styling: tall rounded card, content at top and bottom, slight shrink when pressed.
      className={cn(
        'flex min-h-36 flex-col justify-between rounded-card p-4 transition active:scale-[0.98] sm:min-h-40 sm:p-5',
        tone === 'ink' ? 'bg-ink text-white hover:bg-[#222]' : 'bg-accent-600 text-white shadow-accent hover:bg-accent-700',
      )}
    >
      {/* Draw the icon component passed in. aria-hidden: decorative, skipped by screen readers. */}
      <Icon size={22} aria-hidden />
      {/* Title and hint stacked at the bottom of the tile. */}
      <span>
        <span className="block text-title font-bold leading-tight">{title}</span>
        {/* text-white/75 = white at 75% opacity. */}
        <span className="mt-0.5 block text-meta text-white/75">{hint}</span>
      </span>
    </Link>
  )
}

/** "Take a photo": straight from the camera into the outbox, which sends it. */
function QuickPhoto() {
  // Project and signed-in user.
  const { project, me } = useProjectContext()
  // Translation function.
  const { t } = useI18n()
  // Boolean state: is the camera open?
  const [camera, setCamera] = useState(false)
  // Ref to the hidden file <input> so we can click it from code.
  const input = useRef(null)
  // `async` arrow function: inside it `await` pauses until a Promise finishes. Receives the photo file and info about it.
  const save = async (file, meta) => {
    // try/catch: if anything inside `try` throws an error, jump to `catch` instead of crashing.
    try {
      // Wait for the compressed image (a Blob = raw file data).
      const blob = await compressImage(file)
      // Put a new item into the offline outbox; it is uploaded automatically when there is signal.
      await enqueue({
        // A random unique id generated by the browser.
        id: crypto.randomUUID(),
        // Who took it.
        userId: me.id,
        // Which project it belongs to.
        projectId: project.id,
        // What kind of outbox item this is.
        kind: 'PHOTO',
        // Translated title for the outbox list; the nested template literal builds the key like "camera.RECEIPT". `meta.kind ?? 'PHOTO'` is the default.
        title: t('outbox.PHOTO', { name: t(`camera.${meta.kind ?? 'PHOTO'}`) }),
        // No extra form fields.
        body: {},
        // One file. `blob.name || 'photo.jpg'` gives a fallback name; `...meta` spreads the capture info in after captureMode (so meta can override it).
        files: [{ key: 'f0', blob, name: blob.name || 'photo.jpg', meta: { captureMode: 'IN_APP_CAMERA', ...meta } }],
      })
      // Green success toast.
      toast.success(t('today.photoSaved'))
      // `catch` without a variable: we do not need the error object itself.
    } catch {
      // Storage on the phone is full or blocked (private mode).
      // Red error toast.
      toast.error(t('outbox.saveFailed'))
    }
  }
  return (
    // <>...</> is a Fragment: groups several elements without adding an extra element to the page.
    <>
      {/* The big "take a photo" button; clicking opens the camera. Card styling, slight shrink when pressed. */}
      <button data-reveal onClick={() => setCamera(true)} className="card flex w-full items-center gap-3.5 px-4 py-4 text-start transition hover:border-line-strong active:scale-[0.99]">
        {/* Camera icon in an orange tile. */}
        <IconTile icon={Camera} tone="accent" />
        {/* Text column that takes the remaining width (flex-1); min-w-0 lets long text shrink. */}
        <span className="min-w-0 flex-1">
          <span className="block text-body font-bold">{t('today.photo')}</span>
          <span className="block text-meta text-ink-3">{t('today.photoHint')}</span>
        </span>
        {/* Arrow on the right; rtl:-scale-x-100 flips it for right-to-left languages like Urdu. */}
        <ChevronRight size={18} className="text-ink-4 rtl:-scale-x-100" aria-hidden />
      </button>
      {/* Hidden file picker, used when the user chooses "upload from gallery" in the camera. */}
      <input
        // Connect the ref.
        ref={input}
        // A file chooser.
        type="file"
        // Only allow images.
        accept="image/*"
        // Visually hidden but still in the page.
        className="sr-only"
        // -1 = not reachable with the Tab key.
        tabIndex={-1}
        // Runs when a file has been picked.
        onChange={(e) => {
          // `?.[0]`: optional chaining with an index, takes the first chosen file if there is a list.
          const file = e.target.files?.[0]
          // If a file was picked, save it. capturedAt uses the file's last-modified time as an ISO date string, or undefined if unknown.
          if (file) save(file, { kind: 'PHOTO', captureMode: 'GALLERY', capturedAt: file.lastModified ? new Date(file.lastModified).toISOString() : undefined })
          // Reset the input so picking the same file again still triggers onChange.
          e.target.value = ''
        }}
      />
      {/* The in-app camera overlay. */}
      <CameraCapture
        // Shown while `camera` is true.
        open={camera}
        // The camera calls setCamera(false) to close itself.
        onOpenChange={setCamera}
        // Which capture types the user can switch between.
        modes={['PHOTO', 'DELIVERY_PHOTO', 'RECEIPT']}
        // Each captured photo is handed to `save(file, meta)`.
        onCapture={save}
        // "Upload instead": close the camera, then click the hidden file input (comma operator runs both; `?.` in case the ref is empty).
        onUpload={() => (setCamera(false), input.current?.click())}
      />
    </>
  )
}
