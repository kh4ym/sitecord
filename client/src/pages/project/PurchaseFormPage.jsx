// /p/:id/purchases/new and /:expenseId/edit (createExpense). Type, supplier,
// items from the materials list, evidence slots, submit or save as draft; falls
// back to the outbox when offline.
//
// FILE OVERVIEW
// What it does: the form for recording a purchase (an "expense"): what kind it
//   is (material, labour, equipment, transport...), who was paid, invoice number,
//   date, whether it came out of the contractor's cash advance, one or more item
//   lines (chosen from the project's bill of quantities, "BOQ", or typed by hand)
//   with quantity, unit and rate, proof photos (receipt, and for materials a
//   delivery photo), and notes. It can be submitted (sent for approval, or
//   recorded straight away for the owner) or saved as a draft.
//   Offline: a new purchase that is submitted while offline, or that has photos
//   still stored on the phone, is put into the offline "outbox" queue instead
//   of being sent, and uploaded later automatically.
// Routes: /p/:id/purchases/new (new) and /p/:id/purchases/:expenseId/edit (edit).
// Who can see it: anyone with the createExpense permission (owner, contractor,
//   supervisor...). After saving, people without viewMoney go back to Today.
// Data it loads: the expense being edited (useExpense), the BOQ items (useBoq),
//   past expenses for supplier-name suggestions (useExpenses, only if the person
//   may see money), and the create/update mutations, all from lib/queries.js.
// Depends on: React hooks, React Router, sonner toasts, lucide icons, shared
//   expense rules (EXPENSE_TYPES, expenseEvidenceGaps), the EvidenceUploader,
//   the UI kit, i18n, project context, money/date formatting, network helpers
//   and the offline outbox store.

// React hooks: useMemo caches a computed value, useState stores changing values.
import { useMemo, useState } from 'react'
// useNavigate changes page from code; useParams reads the :placeholders from the URL.
import { useNavigate, useParams } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icons.
import { Plus, Trash2 } from 'lucide-react'
// Expense type labels, and a function that lists which proof photos are still missing.
import { EXPENSE_TYPES, expenseEvidenceGaps } from '@shared/records.js'
// Component for attaching photos/receipts as evidence.
import { EvidenceUploader } from '../../components/evidence/EvidenceUploader.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components used by the form.
import { Button, ErrorState, Field, FilterChips, Input, MoneyInput, Notice, PageSkeleton, SectionHead, Select, Textarea, Toggle } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Project context hook.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// formatPKR turns paisa into "Rs 1,234"; today() returns today's date as 'YYYY-MM-DD'.
import { formatPKR, today } from '../../lib/format.js'
// isRetryable(err) is true for errors caused by a bad connection (worth retrying later).
import { isRetryable } from '../../lib/net.js'
// Put an item in the offline outbox.
import { enqueue } from '../../lib/outbox/store.js'
// Query and mutation hooks for BOQ items and expenses.
import { useBoq, useCreateExpense, useExpense, useExpenses, useUpdateExpense } from '../../lib/queries.js'

// Arrow function returning a new empty item line. The object is wrapped in ( ) so the { } is read as an object, not a function body.
// Math.random() gives a throw-away unique `key` for React's list rendering.
const blankLine = () => ({ key: Math.random(), boqItemId: '', custom: false, description: '', qty: '', unit: '', unitPaisa: null })

// The page component: decides between "new" and "edit" and waits for the existing purchase to load.
export default function PurchaseFormPage() {
  // Destructure :expenseId from the URL (undefined on the "new" route).
  const { expenseId } = useParams()
  // The current project.
  const { project } = useProjectContext()
  // Load the purchase being edited (the hook does nothing when expenseId is undefined).
  const existing = useExpense(project.id, expenseId)
  // When editing and still loading, show a skeleton.
  if (expenseId && existing.isLoading) return <PageSkeleton variant="detail" />
  // When editing and the load failed, show the error.
  if (expenseId && existing.error) return <ErrorState error={existing.error} />
  // Render the real form. Changing `key` makes React throw away and recreate the form, so its state starts fresh for a different purchase.
  return <PurchaseForm key={expenseId ?? 'new'} expense={existing.data} />
}

// The form itself. `{ expense }` destructures the `expense` prop (undefined for a new purchase).
function PurchaseForm({ expense }) {
  // Project, the person's role, permission check, the signed-in user and feature flags.
  const { project, role, can, me, features } = useProjectContext()
  // Translation helpers.
  const { t, term } = useI18n()
  // Function to change page.
  const navigate = useNavigate()
  // Query: the bill of quantities (materials list).
  const boq = useBoq(project.id)
  // Query: all expenses (for supplier suggestions). The third argument's `enabled` option stops it running for people who cannot see money.
  const all = useExpenses(project.id, {}, { enabled: can('viewMoney') })
  // Mutation for creating a new purchase.
  const create = useCreateExpense(project.id)
  // Mutation for updating; `expense?.id` is undefined for a new purchase.
  const update = useUpdateExpense(project.id, expense?.id)
  // Ternary: use the update mutation when editing, otherwise create.
  const save = expense ? update : create
  // Lazy initial state: the function runs only on the first render, so the random id stays the same. Destructuring takes just the value (no setter needed).
  // This id lets the server spot the same purchase sent twice (e.g. once online, once from the outbox).
  const [clientId] = useState(() => crypto.randomUUID())
  // "final" = no approval step: the owner records directly, or approvals are switched off.
  const final = role === 'OWNER' || !features.approvals

  // Form state, also with a lazy initialiser. Each field uses the existing value when editing, or a default (`??`).
  const [form, setForm] = useState(() => ({
    // Kind of purchase; default MATERIAL.
    type: expense?.type ?? 'MATERIAL',
    // Who was paid.
    supplierName: expense?.supplierName ?? '',
    // Optional invoice number.
    invoiceNumber: expense?.invoiceNumber ?? '',
    // Date of purchase; defaults to today.
    purchaseDate: expense?.purchaseDate ?? today(),
    // Paid from the cash advance? Default true for contractors/supervisors when the payments feature is on (the && gives true/false).
    fromAdvance: expense?.fromAdvance ?? ((role === 'CONTRACTOR' || role === 'SUPERVISOR') && features.payments),
    // Optional notes.
    description: expense?.description ?? '',
  }))
  // Item lines state. Lazy initialiser: when editing and there are lines, convert each saved line into form shape; otherwise start with one blank line.
  const [lines, setLines] = useState(() =>
    // `?.length` is undefined/0 when there are no lines, which is falsy.
    expense?.lines?.length
      // For each saved line `l`: custom = it has no BOQ item (`!` turns the id into true/false); qty becomes a string for the text input.
      ? expense.lines.map((l) => ({ key: l.id, boqItemId: l.boqItemId ?? '', custom: !l.boqItemId, description: l.description, qty: String(l.qty), unit: l.unit, unitPaisa: l.unitPaisa }))
      // Array with one new blank line.
      : [blankLine()],
  )
  // Attached evidence files (existing ones when editing).
  const [evidence, setEvidence] = useState(expense?.evidence ?? [])
  // Has the user tried to submit yet? Errors only show after the first try.
  const [tried, setTried] = useState(false)
  // True while a request is running (drives the button spinners).
  const [sending, setSending] = useState(false)
  // Curried field setter: set('supplierName') returns an onChange handler. Accepts either an input event or a plain value.
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }))

  // useMemo(fn, deps) re-computes only when deps change. Here: the BOQ list or an empty array, stable between renders.
  const items = useMemo(() => boq.data ?? [], [boq.data])
  // Only these purchase types pick items from the BOQ list. .includes checks if the array contains the value.
  const listed = ['MATERIAL', 'LABOUR', 'EQUIPMENT'].includes(form.type)
  // Lookup table { id: item }. map makes [key, value] pairs; Object.fromEntries turns pairs into an object.
  const byId = useMemo(() => Object.fromEntries(items.map((b) => [b.id, b])), [items])
  // Unique, alphabetically sorted supplier names from past purchases (Set removes duplicates, spread turns it back into an array).
  const suppliers = useMemo(() => [...new Set((all.data ?? []).map((e) => e.supplierName))].sort(), [all.data])
  // .reduce adds up all lines, starting from 0. `Number(l.qty) || 0` treats empty/invalid quantities as 0; Math.round keeps whole paisa.
  const total = lines.reduce((n, l) => n + Math.round((Number(l.qty) || 0) * (l.unitPaisa || 0)), 0)
  // Which required proofs are missing, given the type and the kinds of evidence attached (e.g. ['PROOF']).
  const gaps = expenseEvidenceGaps(form.type, evidence.map((e) => e.kind))
  // How many proofs are needed: materials need receipt + delivery photo, others just a receipt.
  const needed = form.type === 'MATERIAL' ? 2 : 1

  // Validation per line. `condition && 'message'` gives the message when the condition is true, otherwise false (= no error).
  const lineErrors = lines.map((l) => ({
    // .trim() removes spaces; an empty string is falsy so `!` makes it true.
    description: !l.description.trim() && 'What was bought?',
    // Quantity must be a number greater than 0.
    qty: !(Number(l.qty) > 0) && 'Enter a quantity',
    // Unit must not be empty.
    unit: !l.unit.trim() && 'Unit',
    // `== null` catches both null and undefined.
    unitPaisa: l.unitPaisa == null && 'Enter the price',
  }))
  // Validation for the top fields.
  const errors = { supplierName: !form.supplierName.trim() && 'Who was paid?', purchaseDate: !form.purchaseDate && 'Choose the date' }
  // Valid when no top-level error is truthy AND every line has no truthy error. `.some(Boolean)` = "is any value truthy?"; `.every` = "do all pass?".
  const valid = !Object.values(errors).some(Boolean) && lineErrors.every((e) => !Object.values(e).some(Boolean))

  // Update one line by key: copy all lines, and for the matching one merge in the changed fields (`{ ...l, ...patch }`).
  const updateLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  // When a BOQ item is chosen from the drop-down for a line.
  const chooseBoq = (key, id) => {
    // Look up the chosen item (undefined for '' or '__other').
    const b = byId[id]
    // A real item fills in its description and unit; otherwise clear them, and mark the line custom when "other" was chosen.
    updateLine(key, b ? { boqItemId: id, description: b.description, unit: b.unit, custom: false } : { boqItemId: '', custom: id === '__other', description: '', unit: '' })
  }

  // People who can't open purchase pages (a site supervisor) go back to Today.
  // After saving: go to the purchase's page if allowed and we have an id, otherwise to Today.
  const after = (id) => navigate(can('viewMoney') && id ? `/p/${project.id}/purchases/${id}` : `/p/${project.id}/today`)

  // Async submit handler. submitNow = true for "submit", false for "save draft".
  const submit = async (submitNow) => {
    // From now on, show validation errors.
    setTried(true)
    // Stop if the form is invalid, or if submitting while proofs are missing.
    if (!valid || (submitNow && gaps.length)) {
      // Pick the right error message with a ternary.
      toast.error(submitNow && gaps.length ? 'Add the required proof first' : 'Some details are missing')
      // Leave the function early.
      return
    }
    // Build the request body sent to the server.
    const body = {
      // Start with all form fields (spread).
      ...form,
      // `!!` forces a true/false value.
      fromAdvance: !!form.fromAdvance,
      // Empty strings become undefined, so the field is left out of the JSON.
      invoiceNumber: form.invoiceNumber.trim() || undefined,
      description: form.description.trim() || undefined,
      // Convert each line to the server's shape: no BOQ item becomes null, quantity becomes a number.
      lines: lines.map((l) => ({ boqItemId: l.boqItemId || null, description: l.description.trim(), qty: Number(l.qty), unit: l.unit.trim(), unitPaisa: l.unitPaisa })),
      // Ids of evidence already uploaded to the server (local ones are skipped).
      evidenceIds: evidence.filter((e) => !e.local).map((e) => e.id),
      // Submit or draft.
      submit: submitNow,
    }
    // Evidence files still only on the phone (not uploaded yet).
    const local = evidence.filter((e) => e.local)
    // Inner async function: save this purchase into the offline outbox and go back to Today.
    const saveOffline = async () => {
      // try/catch around the storage write.
      try {
        // Queue it for later upload.
        await enqueue({
          // Same clientId, so a retry is not counted twice.
          id: clientId,
          // Who made it.
          userId: me.id,
          // Which project.
          projectId: project.id,
          // Outbox item kind.
          kind: 'PURCHASE',
          // Translated title, e.g. "Purchase from Al-Noor".
          title: t('outbox.PURCHASE', { name: form.supplierName.trim() }),
          // Copy of body, always as a real submit.
          body: { ...body, submit: true },
          // The phone-only files; `i` is the index, used to build keys 'f0', 'f1'...
          files: local.map((e, i) => ({ key: `f${i}`, blob: e.blob, name: e.name, meta: e.meta })),
        })
      } catch {
        // Saving failed (storage full/blocked): show an error and stop (return ends the function).
        return toast.error(t('outbox.saveFailed'))
      }
      // Tell the user it is saved on the phone.
      toast.success(t('outbox.savedToast'))
      // Go to Today, where the outbox is shown.
      navigate(`/p/${project.id}/today`)
    }
    // A new purchase being submitted goes straight to the outbox when it has phone-only photos or the browser reports being offline.
    if (!expense && submitNow && (local.length || navigator.onLine === false)) return saveOffline()
    // Turn on the spinner.
    setSending(true)
    // Send to the server. A new purchase also includes clientId (spread + extra key).
    save.mutate(expense ? body : { ...body, clientId }, {
      // Runs when the server accepted it; `res` is the server's response.
      onSuccess: (res) => {
        // Nested ternary for the message: submitted (recorded vs sent for approval) or draft.
        toast.success(submitNow ? (final ? 'Purchase saved' : 'Sent to the owner for approval') : 'Draft saved')
        // Navigate away, using the existing id or the new one from the response.
        after(expense?.id ?? res.id)
      },
      // On failure: if it was a new submit and a network problem, fall back to the outbox; otherwise do nothing here (the error Notice shows it).
      onError: (err) => (!expense && submitNow && isRetryable(err) ? saveOffline() : undefined),
      // onSettled runs after success OR error: turn off the spinner.
      onSettled: () => setSending(false),
    })
  }

  // The form's JSX.
  return (
    <Page width="narrow">
      <PageTitle
        // "Edit P-12" when editing, "New purchase" otherwise.
        title={expense ? `${t('purchase.edit')} P-${expense.number}` : t('purchase.new')}
        // Back button target: the purchase page (editing), the purchases list (if allowed to see money), or Today. Double braces = a JS object inside a JSX expression.
        back={{ to: expense ? `/p/${project.id}/purchases/${expense.id}` : can('viewMoney') ? `/p/${project.id}/purchases` : `/p/${project.id}/today`, label: t('common.back') }}
      />
      {/* When the owner has queried this purchase, show an info box explaining what to do. */}
      {expense?.status === 'QUERIED' && (
        <Notice tone="info" className="mb-5" title="The owner asked a question">
          Answer it on the purchase page, fix anything here if needed, then resubmit.
        </Notice>
      )}

      {/* Main column of sections. */}
      <div className="flex flex-col gap-6">
        {/* Row of chips for choosing the kind of purchase. */}
        <FilterChips
          // Boolean attribute used by the reveal animation.
          data-reveal
          // Accessible label.
          label="Kind of purchase"
          // Controlled value and change handler.
          value={form.type}
          onChange={set('type')}
          // Object.entries gives [key, value] pairs; array destructuring in the parameter `([value, label])` names them.
          options={Object.entries(EXPENSE_TYPES).map(([value, label]) => ({ value, label: term(label).toLowerCase() }))}
        />

        {/* Supplier, invoice, date, advance. */}
        <section data-reveal className="flex flex-col gap-4">
          {/* Error only shown after trying to submit: `tried && message`. */}
          <Field label={t('purchase.supplier')} error={tried && errors.supplierName}>
            {/* list="suppliers" links this input to the <datalist> below for suggestions; autoComplete off hides the browser's own. */}
            <Input value={form.supplierName} onChange={set('supplierName')} list="suppliers" placeholder="e.g. Al-Noor Cement Traders" autoComplete="off" />
          </Field>
          {/* Suggestion list: one <option> per known supplier. */}
          <datalist id="suppliers">
            {suppliers.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {/* Two columns on wider screens. */}
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Optional invoice number. */}
            <Field label={t('purchase.invoice')} optional>
              <Input value={form.invoiceNumber} onChange={set('invoiceNumber')} placeholder="e.g. ANC-2231" />
            </Field>
            {/* Purchase date; `max={today()}` stops picking a future date. */}
            <Field label={t('purchase.date')} error={tried && errors.purchaseDate}>
              <Input type="date" value={form.purchaseDate} max={today()} onChange={set('purchaseDate')} />
            </Field>
          </div>
          {/* "From my advance" switch, only for contractors/supervisors when payments are enabled. */}
          {(role === 'CONTRACTOR' || role === 'SUPERVISOR') && features.payments && (
            // A <label> around the whole card makes the whole card clickable for the toggle.
            <label className="card flex items-center gap-3 px-4 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold">{t('purchase.fromAdvance')}</span>
                <span className="block text-meta text-ink-3">{t('purchase.fromAdvanceHint')}</span>
              </span>
              {/* On/off switch; set('fromAdvance') receives true/false. */}
              <Toggle checked={form.fromAdvance} onChange={set('fromAdvance')} label={t('purchase.fromAdvance')} />
            </label>
          )}
        </section>

        {/* Item lines. */}
        <section data-reveal className="flex flex-col gap-3">
          <SectionHead title={t('purchase.items')} />
          <ul className="flex flex-col gap-3">
            {/* .map with a block body `{ ... return (...) }` so we can compute values per line first. `i` is the index. */}
            {lines.map((l, i) => {
              // The BOQ item for this line, if any.
              const b = byId[l.boqItemId]
              // Line total in paisa.
              const lineTotal = Math.round((Number(l.qty) || 0) * (l.unitPaisa || 0))
              // This line's errors, but only after a submit attempt.
              const e = tried ? lineErrors[i] : {}
              return (
                // One card per line, keyed by its stable key.
                <li key={l.key} className="card flex flex-col gap-3 p-4">
                  {/* For listed types: a drop-down of BOQ items. */}
                  {listed && (
                    // Label "Item" or "Item 2" when there are several lines (nested template literal). Show the description error only if nothing was chosen.
                    <Field label={`${t('purchase.item')}${lines.length > 1 ? ` ${i + 1}` : ''}`} error={!l.boqItemId && !l.custom ? e.description : undefined}>
                      {/* Value is '__other' for custom lines. On change, `ev.target.value` is the chosen option's value. */}
                      <Select value={l.custom ? '__other' : l.boqItemId} onChange={(ev) => chooseBoq(l.key, ev.target.value)}>
                        {/* Placeholder option that cannot be chosen. */}
                        <option value="" disabled>
                          {t('purchase.chooseItem')}
                        </option>
                        {/* Method chaining: first filter, then map. */}
                        {items
                          // Keep items matching the type: material codes start with M or F, otherwise match the category (nested ternary).
                          .filter((x) => (form.type === 'MATERIAL' ? x.code.startsWith('M') || x.code.startsWith('F') : form.type === 'LABOUR' ? x.category === 'Labour' : x.category === 'Equipment'))
                          // One <option> per item.
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.description}
                            </option>
                          ))}
                        {/* "Something else" option. */}
                        <option value="__other">{t('purchase.otherItem')}</option>
                      </Select>
                    </Field>
                  )}
                  {/* Free text description when the type is not listed, or "other" was chosen. */}
                  {(!listed || l.custom) && (
                    <Field label={listed ? 'Describe it' : `${t('purchase.item')}${lines.length > 1 ? ` ${i + 1}` : ''}`} error={e.description}>
                      {/* Controlled input updating just this line; the placeholder depends on the type. */}
                      <Input value={l.description} onChange={(ev) => updateLine(l.key, { description: ev.target.value })} placeholder={form.type === 'TRANSPORT' ? 'e.g. Tractor trolley trips' : 'What was bought or paid for'} />
                    </Field>
                  )}
                  {/* Grid for quantity, unit and rate (custom column widths; 2 columns on phones, 3 on wider screens). */}
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,0.6fr)_minmax(0,1.2fr)]">
                    <Field label={t('purchase.qty')} error={e.qty}>
                      {/* inputMode="decimal" shows a number keyboard on phones. The regex /[^\d.]/g matches anything that is not a digit or dot; replace removes it. */}
                      <Input inputMode="decimal" value={l.qty} onChange={(ev) => updateLine(l.key, { qty: ev.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
                    </Field>
                    <Field label={t('purchase.unit')} error={e.unit}>
                      {/* Unit is locked (disabled) when it came from a BOQ item (`!!b` is true when b exists). */}
                      <Input value={l.unit} onChange={(ev) => updateLine(l.key, { unit: ev.target.value })} disabled={!!b} placeholder="bag, kg, trip" />
                    </Field>
                    <Field label={t('purchase.rate')} error={e.unitPaisa} className="col-span-2 sm:col-span-1">
                      {/* Price per unit; words={false} hides the amount-in-words line. */}
                      <MoneyInput value={l.unitPaisa} onChange={(v) => updateLine(l.key, { unitPaisa: v })} words={false} />
                    </Field>
                  </div>
                  {/* Bottom row: remove button (left) and line total (right). */}
                  <div className="flex items-center justify-between">
                    {/* Ternary in JSX: a remove button when there is more than one line, otherwise an empty <span /> to keep the layout. */}
                    {lines.length > 1 ? (
                      // Remove this line: keep every line whose key is different.
                      <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="flex items-center gap-1.5 text-meta font-semibold text-ink-3 hover:text-danger-700">
                        <Trash2 size={15} aria-hidden /> remove
                      </button>
                    ) : (
                      <span />
                    )}
                    {/* Line total in rupees. */}
                    <span className="num text-body font-bold">{formatPKR(lineTotal)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          {/* "Add item" button and grand total. */}
          <div className="flex items-center justify-between gap-3 px-1">
            {/* Adds a blank line: new array with all old lines plus one more. Capped at 30 lines. */}
            <Button size="sm" variant="soft" icon={Plus} onClick={() => setLines((ls) => [...ls, blankLine()])} disabled={lines.length >= 30}>
              {t('purchase.addItem')}
            </Button>
            {/* Total label and amount. */}
            <p className="flex items-baseline gap-3">
              <span className="text-meta font-semibold text-ink-3">{t('purchase.total')}</span>
              <span className="num font-display text-title font-semibold">{formatPKR(total)}</span>
            </p>
          </div>
        </section>

        {/* Proof photos. */}
        <section data-reveal className="flex flex-col gap-3">
          {/* "1 of 2" style counter: n = attached, m = needed. */}
          <SectionHead title={t('purchase.evidence')} meta={t('purchase.evidenceCount', { n: needed - gaps.length, m: needed })} />
          <EvidenceUploader
            // Project the files belong to.
            projectId={project.id}
            // Controlled list of attached evidence.
            value={evidence}
            onChange={setEvidence}
            // Highlight missing slots after a submit attempt.
            showErrors={tried}
            // New purchases may keep photos on the phone (offline); edits upload straight away.
            offline={!expense}
            // The evidence "slots". The second one is added only for materials: spreading an empty array adds nothing.
            slots={[
              { kind: 'RECEIPT', kinds: ['RECEIPT', 'INVOICE', 'HANDWRITTEN_SLIP'], label: t('purchase.receipt'), hint: t('purchase.receiptHint'), required: true },
              ...(form.type === 'MATERIAL' ? [{ kind: 'DELIVERY_PHOTO', label: t('purchase.delivery'), hint: t('purchase.deliveryHint'), required: true }] : []),
            ]}
          />
        </section>

        {/* Optional notes; rows={2} sets the textarea's height. */}
        <Field label={t('purchase.notes')} optional>
          <Textarea value={form.description} onChange={set('description')} rows={2} placeholder="Anything the owner should know" />
        </Field>

        {/* Buttons. */}
        <div className="flex flex-col gap-2">
          {/* Server error box, but not for network errors (those go to the outbox instead). */}
          {save.error && !isRetryable(save.error) && <Notice tone="error">{save.error.message}</Notice>}
          {/* Main submit button. Spinner only when the running request is a submit (save.variables holds the last sent body). */}
          <Button variant="primary" size="lg" block disabled={gaps.length > 0} loading={sending && save.variables?.submit} onClick={() => submit(true)}>
            {/* Button text: resubmit / record / submit for approval. */}
            {expense?.status === 'QUERIED' ? 'resubmit for approval' : final ? t('purchase.record') : t('purchase.submit')}
          </Button>
          {/* Explain what proof is missing. */}
          {gaps.length > 0 && <p className="text-center text-meta font-semibold text-warn-800">{gaps.includes('PROOF') ? t('purchase.missingProof') : t('purchase.missingDelivery')}</p>}
          {/* Drafts live on the server, so photos still on the phone go with a full submit only. */}
          {/* "Save draft" is hidden for queried purchases and when any evidence is phone-only. */}
          {expense?.status !== 'QUERIED' && !evidence.some((e) => e.local) && (
            <Button variant="text" className="self-center" loading={sending && !save.variables?.submit} onClick={() => submit(false)}>
              {t('purchase.draft')}
            </Button>
          )}
        </div>
      </div>
    </Page>
  )
}
