// /p/:id/materials (viewBoq). Planned vs bought vs used per material as a
// three-part bar, item detail sheet, add/edit, CSV import and export.
//
// FILE OVERVIEW
// - Route: /p/:projectId/materials, inside the project's Money section
//   (MoneyLayout in App.jsx). "BOQ" = Bill of Quantities: the planned list of
//   materials with quantities and expected prices.
// - Who sees it: project members who can view the BOQ. Only people with the
//   manageBoq permission (checked with can('manageBoq')) can add, edit or
//   import materials; everyone who sees the page can export a CSV.
// - Data loaded: useBoq(projectId) returns the raw BOQ items; materialRows()
//   from lib/derive.js turns them into display rows with bought/used/on-site
//   quantities, overQty and priceDiff flags.
// - Data changed: useSaveBoqItem (add or edit one item) and useImportBoq
//   (upload CSV text; existing codes are updated, new codes added).
// - Components in this file: MaterialsPage (stats, legend, grouped list),
//   MaterialBar (the used / bought / to-buy bar), ItemDetails (read-only
//   sheet), ItemSheet (add/edit form) and ImportSheet (CSV import).

// React hooks: useMemo caches a computed value, useRef holds a DOM reference, useState holds state.
import { useMemo, useRef, useState } from 'react'
// Toast notifications.
import { toast } from 'sonner'
// Icon components.
import { Download, FileUp, MoreHorizontal, Package, Plus } from 'lucide-react'
// Standard page container.
import { Page } from '../../components/Page.jsx'
// Multi-line named import of UI kit components.
import {
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  ListCard,
  ListRow,
  Menu,
  MenuItem,
  MoneyInput,
  Notice,
  PageSkeleton,
  SectionHead,
  Segmented,
  Sheet,
  StatRow,
  Textarea,
} from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project and the permission checker can().
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Turns raw BOQ items into rows with bought/used totals.
import { materialRows } from '../../lib/derive.js'
// cn joins classes, csvCell escapes one CSV value, formatNumber/formatPKR format numbers/rupees, plural makes "3 items".
import { cn, csvCell, formatNumber, formatPKR, plural } from '../../lib/format.js'
// Data hooks: load BOQ, import CSV, save one item.
import { useBoq, useImportBoq, useSaveBoqItem } from '../../lib/queries.js'

// Array of [key, label] pairs: the two phases materials are grouped into.
const GROUPS = [
  ['STRUCTURE', 'Grey structure'],
  ['FINISHING', 'Finishing'],
]

/** Materials: how much was planned, bought and used, one bar per item. */
// Default export: the materials page.
export default function MaterialsPage() {
  // Project and permission checker.
  const { project, can } = useProjectContext()
  // Translation function.
  const { t } = useI18n()
  // Load the BOQ; destructure the query result.
  const { data, isLoading, error, refetch } = useBoq(project.id)
  // The row whose detail sheet is open (null = closed).
  const [open, setOpen] = useState(null)
  // The item being edited: null = closed, {} = adding a new one.
  const [editing, setEditing] = useState(null) // item, or {} for a new one
  // Whether the CSV import sheet is open.
  const [importing, setImporting] = useState(false)

  // useMemo: recompute rows only when data changes. data ?? [] uses an empty list while loading. (Hooks must run before any early return.)
  const rows = useMemo(() => materialRows(data ?? []), [data])
  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error card with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Build a CSV file in the browser and download it.
  const exportCsv = () => {
    // First line: the header row, made by joining column names with commas.
    const lines = [['code', 'description', 'category', 'unit', 'quantity', 'rate', 'bought', 'used'].join(',')]
    // for…of loops over each row; push adds one CSV line (each value escaped by csvCell). Rate converts paisa to rupees (/ 100), with ?? 0 for missing.
    for (const r of rows) lines.push([r.code, r.description, r.category, r.unit, r.estQty, (r.estUnitPaisa ?? 0) / 100, r.boughtQty, r.usedQty].map(csvCell).join(','))
    // Make a Blob (in-memory file) from an invisible byte-order mark (so Excel reads UTF-8) plus the lines joined by Windows line breaks, and get a temporary URL for it.
    const url = URL.createObjectURL(new Blob(['﻿', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    // Object.assign(target, props) copies props onto a new <a> element: href = the file URL, download = suggested file name (template literal).
    const a = Object.assign(document.createElement('a'), { href: url, download: `${project.name} materials.csv` })
    // Programmatically click the link to start the download.
    a.click()
    // Free the temporary URL's memory.
    URL.revokeObjectURL(url)
  }
  // How many materials need attention: bought more than planned, or price more than 10% (0.1) above expected.
  const look = rows.filter((r) => r.overQty || r.priceDiff > 0.1).length

  return (
    <Page>
      <PageTitle
        // Translated "Materials".
        title={t('nav.materials')}
        // actions: a "…" menu; the trigger prop is the button that opens it.
        actions={
          <Menu trigger={<IconButton icon={MoreHorizontal} label="Materials actions" />}>
            {/* Add item: only for people allowed to manage the BOQ; opens the edit sheet with {} (new). */}
            {can('manageBoq') && (
              <MenuItem icon={Plus} onSelect={() => setEditing({})}>
                add a material
              </MenuItem>
            )}
            {/* Import: same permission. */}
            {can('manageBoq') && (
              <MenuItem icon={FileUp} onSelect={() => setImporting(true)}>
                import from CSV
              </MenuItem>
            )}
            {/* Export: available to everyone who can see the page. */}
            <MenuItem icon={Download} onSelect={exportCsv}>
              export as CSV
            </MenuItem>
          </Menu>
        }
      />

      {/* Empty state when there are no materials, otherwise stats + legend + list. */}
      {rows.length === 0 ? (
        <div data-reveal className="card">
          <EmptyState icon={Package} title="No materials listed" description="Add the materials you plan to buy to compare them with what's bought and used." />
        </div>
      ) : (
        // Fragment wrapping several siblings.
        <>
          {/* Row of three numbers. */}
          <StatRow
            data-reveal
            className="mb-6"
            // Array of stat objects.
            items={[
              // Total materials.
              { value: rows.length, label: 'materials' },
              // Items where purchases reached the plan.
              { value: rows.filter((r) => r.estQty > 0 && r.boughtQty >= r.estQty).length, label: 'fully bought' },
              // Items needing a look; singular/plural label; red only if there are any.
              { value: look, label: look === 1 ? 'needs a look' : 'need a look', tone: look ? 'danger' : undefined },
            ]}
          />
          {/* Colour legend for the bars. */}
          <ul data-reveal className="mb-5 flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-meta text-ink-3" aria-label="Legend">
            {/* Dark dot = used. */}
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-accent-700" aria-hidden /> used
            </li>
            {/* Light dot = bought but not used. */}
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-accent-300" aria-hidden /> bought, not used yet
            </li>
            {/* Grey outlined dot = still to buy. */}
            <li className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sunken ring-1 ring-line-strong" aria-hidden /> still to buy
            </li>
          </ul>
          <div className="flex flex-col gap-8">
            {/* One section per phase; ([phase, label]) destructures each pair from GROUPS. */}
            {GROUPS.map(([phase, label]) => {
              // Items in this phase.
              const items = rows.filter((r) => r.phase === phase)
              // Returning null from map renders nothing for an empty phase.
              if (!items.length) return null
              return (
                <section key={phase} data-reveal className="flex flex-col gap-3">
                  {/* Heading with an item count like "5 items". */}
                  <SectionHead title={label} meta={plural(items.length, 'item')} />
                  <ListCard>
                    {/* One clickable row per material. */}
                    {items.map((r) => (
                      <ListRow
                        key={r.id}
                        // Open the detail sheet for this row.
                        onClick={() => setOpen(r)}
                        title={r.description}
                        // "est. 500 bag · bought 320, used 280" (used part only if non-zero).
                        subtitle={`est. ${formatNumber(r.estQty)} ${r.unit} · bought ${formatNumber(r.boughtQty)}${r.usedQty ? `, used ${formatNumber(r.usedQty)}` : ''}`}
                        // Warning text on the right: over plan, or price high, or nothing.
                        trailing={r.overQty ? <span className="text-2xs font-bold text-warn-800">more than planned</span> : r.priceDiff > 0.1 ? <span className="text-2xs font-bold text-warn-800">price high</span> : null}
                        // Show a ">" arrow.
                        chevron
                      >
                        {/* children of ListRow: the bar under the text. */}
                        <MaterialBar item={r} />
                      </ListRow>
                    ))}
                  </ListCard>
                </section>
              )
            })}
          </div>
        </>
      )}

      {/* Detail sheet; onEdit uses the comma operator to close details and then open the editor with that row. */}
      <ItemDetails item={open} onClose={() => setOpen(null)} onEdit={(r) => (setOpen(null), setEditing(r))} />
      {/* Add/edit sheet. */}
      <ItemSheet item={editing} onClose={() => setEditing(null)} />
      {/* CSV import sheet. */}
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
    </Page>
  )
}

/** Used · bought but not used · still to buy, on one track scaled to the larger of plan and purchases. */
// ({ item: r }) destructures the item prop and renames it r.
function MaterialBar({ item: r }) {
  // 100% of the bar = the larger of planned and bought; || 1 avoids dividing by zero.
  const scale = Math.max(r.estQty, r.boughtQty) || 1
  // Used can't exceed bought for drawing purposes.
  const used = Math.min(r.usedQty, r.boughtQty)
  return (
    <span
      // Grey track (the "still to buy" part is whatever's left over).
      className="mt-2.5 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-sunken"
      // Treat the bar as one image for screen readers…
      role="img"
      // …described by this text.
      aria-label={`${formatNumber(r.usedQty)} used, ${formatNumber(r.onSite)} bought but not used, of ${formatNumber(r.estQty)} ${r.unit} planned`}
    >
      {/* Dark "used" segment; inline style width is a percentage computed in a template literal. */}
      {used > 0 && <span className="h-full rounded-s-full bg-accent-700" style={{ width: `${(used / scale) * 100}%` }} />}
      {/* Light "bought not used" segment; cn adds rounded ends only when it's the first or reaches the end (false entries are skipped). */}
      {r.boughtQty - used > 0 && <span className={cn('h-full bg-accent-300', !used && 'rounded-s-full', r.boughtQty >= scale && 'rounded-e-full')} style={{ width: `${((r.boughtQty - used) / scale) * 100}%` }} />}
    </span>
  )
}

// Read-only detail sheet for one material.
function ItemDetails({ item, onClose, onEdit }) {
  // Project and permission checker.
  const { project, can } = useProjectContext()
  // Keep the last item so the content stays while the sheet animates closed.
  const [last, setLast] = useState(item)
  // Derived-state update during render.
  if (item && item !== last) setLast(item)
  // Show the current item, or the last one while closing.
  const r = item ?? last
  return (
    <Sheet
      // Open whenever an item is set.
      open={!!item}
      // Close request → onClose.
      onOpenChange={(o) => !o && onClose()}
      // ?. and ?? guard the very first render when r is null.
      title={r?.description ?? ''}
      description={r ? `${r.code} · ${r.category}` : undefined}
      // Footer buttons (only once r exists).
      footer={
        r && (
          <>
            {/* Link to purchases filtered by this material (?q= search, URL-encoded). */}
            {r.boughtQty > 0 && (
              <Button variant="secondary" to={`/p/${project.id}/purchases?q=${encodeURIComponent(r.description)}`}>
                see purchases
              </Button>
            )}
            {/* Edit button for managers. */}
            {can('manageBoq') && (
              <Button variant="primary" onClick={() => onEdit(r)}>
                edit
              </Button>
            )}
          </>
        )
      }
    >
      {/* Sheet body. */}
      {r && (
        <div className="flex flex-col gap-6">
          {/* Bought / used / on site numbers. */}
          <StatRow
            items={[
              { value: r.boughtQty, label: `${r.unit} bought` },
              { value: r.usedQty, label: `${r.unit} used` },
              { value: r.onSite, label: 'on site now' },
            ]}
          />
          {/* The same bar as in the list. */}
          <MaterialBar item={r} />
          {/* Key/value list. */}
          <ul className="card divide-y divide-line">
            {/* Planned quantity. */}
            <li className="flex items-baseline justify-between gap-3 px-4 py-3">
              <span className="text-body text-ink-2">Planned</span>
              <span className="num text-body font-semibold">
                {formatNumber(r.estQty)} {r.unit}
              </span>
            </li>
            {/* Money spent, if known (!= null excludes null and undefined). */}
            {r.spentPaisa != null && (
              <li className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="text-body text-ink-2">Spent so far</span>
                <span className="num text-body font-semibold">{formatPKR(r.spentPaisa)}</span>
              </li>
            )}
            {/* Average unit price, if known. */}
            {r.avgUnitPaisa != null && (
              <li className="flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="text-body text-ink-2">Average price paid</span>
                <span className="text-end">
                  <span className="num block text-body font-semibold">
                    {formatPKR(r.avgUnitPaisa)} per {r.unit}
                  </span>
                  {/* Price difference vs expected, shown when at least 1% (Math.abs ignores the sign); highlighted when over 10%. */}
                  {r.priceDiff != null && Math.abs(r.priceDiff) >= 0.01 && (
                    <span className={cn('num block text-meta', r.priceDiff > 0.1 ? 'font-semibold text-warn-800' : 'text-ink-3')}>
                      {r.priceDiff > 0 ? '+' : ''}
                      {Math.round(r.priceDiff * 100)}% against the expected price
                    </span>
                  )}
                </span>
              </li>
            )}
          </ul>
          {/* Warning when more was bought than planned. */}
          {r.overQty && <Notice tone="warn">More has been bought than planned. Check whether the plan or the purchases are off.</Notice>}
        </div>
      )}
    </Sheet>
  )
}

// Add/edit form for one material. item: null = closed, {} = new, otherwise the existing item.
function ItemSheet({ item, onClose }) {
  // Current project.
  const { project } = useProjectContext()
  // Mutation that saves an item.
  const save = useSaveBoqItem(project.id)
  // New when an item object exists but has no id.
  const isNew = item && !item.id
  // Form values (null until an item is opened).
  const [form, setForm] = useState(null)
  // Which item the form was filled from.
  const [last, setLast] = useState(null)
  // A different item was passed in → refill the form (derived-state pattern).
  if (item !== last) {
    setLast(item)
    // Fill each field from the item, with ?? defaults for a new one.
    if (item) setForm({ code: item.code ?? '', description: item.description ?? '', category: item.category ?? '', unit: item.unit ?? '', estQty: item.estQty ?? '', estUnitPaisa: item.estUnitPaisa ?? null, phase: item.phase ?? 'STRUCTURE' })
  }
  // Server field errors, or {}.
  const errors = save.error?.fieldErrors ?? {}
  return (
    <Sheet
      open={!!item}
      onOpenChange={(o) => !o && onClose()}
      // "Add a material" or "Edit M-03".
      title={isNew ? 'Add a material' : `Edit ${item?.code ?? ''}`}
      footer={
        <Button
          variant="primary"
          block
          loading={save.isPending}
          onClick={() => {
            // Rest destructuring: pull code out, and collect all other fields into rest.
            const { code, ...rest } = form
            save.mutate(
              // New items send their code; existing ones send their id instead. estQty becomes a number; missing price → 0.
              { ...(isNew ? { code } : { id: item.id }), ...rest, estQty: Number(form.estQty), estUnitPaisa: form.estUnitPaisa ?? 0 },
              // Comma operator: toast, then close.
              { onSuccess: () => (toast.success('Saved'), onClose()) },
            )
          }}
        >
          save
        </Button>
      }
    >
      {/* Form fields, once the form has been filled. */}
      {form && (
        <div className="flex flex-col gap-4">
          {/* Code can only be set when adding. */}
          {isNew && (
            <Field label="Code" hint="Short and unique, e.g. M-06" error={errors.code}>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
          )}
          {/* Controlled inputs: each onChange copies form and replaces one field. */}
          <Field label="Description" error={errors.description}>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          {/* Two columns: category and unit. */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" error={errors.category}>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Cement, Steel…" />
            </Field>
            <Field label="Unit" error={errors.unit}>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="bag, kg, cft" />
            </Field>
          </div>
          {/* inputMode="decimal" shows a number keypad; .replace with a regex removes every character that isn't a digit or a dot (g = all matches). */}
          <Field label="Planned quantity" error={errors.estQty}>
            <Input inputMode="decimal" value={form.estQty} onChange={(e) => setForm({ ...form, estQty: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
          {/* Expected unit price; words={false} hides the amount-in-words line. */}
          <Field label="Expected price per unit" hint="Purchases well above this get a price check." error={errors.estUnitPaisa}>
            <MoneyInput value={form.estUnitPaisa} onChange={(v) => setForm({ ...form, estUnitPaisa: v })} words={false} />
          </Field>
          {/* Phase picker. */}
          <Field label="Phase" group>
            <Segmented
              label="Phase"
              value={form.phase}
              // Shorthand { ...form, phase } = phase: phase.
              onChange={(phase) => setForm({ ...form, phase })}
              // Options built from GROUPS.
              options={GROUPS.map(([value, label]) => ({ value, label: label.toLowerCase() }))}
            />
          </Field>
          {/* General server error (not tied to a field). */}
          {save.error && !Object.keys(errors).length && <Notice tone="error">{save.error.message}</Notice>}
        </div>
      )}
    </Sheet>
  )
}

// CSV import sheet: pick a file or paste rows.
function ImportSheet({ open, onClose }) {
  // Current project.
  const { project } = useProjectContext()
  // Import mutation.
  const importBoq = useImportBoq(project.id)
  // The CSV text.
  const [csv, setCsv] = useState('')
  // Ref to the hidden file input.
  const file = useRef(null)
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Import from CSV"
      description="Rows with an existing code update that item; new codes are added."
      size="lg"
      footer={
        <Button
          variant="primary"
          block
          loading={importBoq.isPending}
          // Disabled when the text is empty or only spaces.
          disabled={!csv.trim()}
          onClick={() =>
            // Send the CSV text; r is the server's { added, updated } summary.
            importBoq.mutate(csv, {
              onSuccess: (r) => {
                toast.success(`${r.added} added, ${r.updated} updated`)
                // Clear the text and close.
                setCsv('')
                onClose()
              },
            })
          }
        >
          import
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Expected columns, shown in a <code> element. */}
        <p className="text-meta text-ink-2">
          Columns: <code className="rounded bg-sunken px-1.5 py-0.5">code, description, category, unit, quantity, rate</code>. Rate is in rupees.
        </p>
        {/* Visible button that clicks the hidden file input (?. in case the ref is empty). */}
        <Button icon={FileUp} onClick={() => file.current?.click()} className="self-start">
          choose a CSV file
        </Button>
        <input
          // Connect the ref.
          ref={file}
          type="file"
          // Only offer CSV files in the picker.
          accept=".csv,text/csv"
          // Visually hidden but still usable.
          className="sr-only"
          // Skip it when tabbing with the keyboard.
          tabIndex={-1}
          // async handler so we can await reading the file.
          onChange={async (e) => {
            // files?.[0]: optional chaining with bracket access → the first chosen file or undefined.
            const f = e.target.files?.[0]
            // f.text() returns a Promise of the file's contents; await waits for it.
            if (f) setCsv(await f.text())
            // Reset the input so choosing the same file again still fires onChange.
            e.target.value = ''
          }}
        />
        {/* Textarea for pasting; placeholder shows an example (the \n inside the string is a line break). */}
        <Field label="Or paste the rows">
          <Textarea rows={7} value={csv} onChange={(e) => setCsv(e.target.value)} className="font-mono text-meta" placeholder={'code,description,category,unit,quantity,rate\nM-06,Tiles adhesive,Tiles,bag,120,1150'} />
        </Field>
        {/* Import error, if any. */}
        {importBoq.error && <Notice tone="error">{importBoq.error.message}</Notice>}
      </div>
    </Sheet>
  )
}
