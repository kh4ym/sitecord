// /p/:id/payments (projects with payments). Advance balance, milestones with
// request / approve / pay, the payment list with proof, and the "record payment"
// sheet. The payee confirms money received.
//
// FILE OVERVIEW
// - Route: /p/:projectId/payments, inside the project's Money section, wrapped
//   in <Gate feature="payments"> in App.jsx (self-managed projects have no
//   payments to a contractor, so the page is hidden for them).
// - Who sees it: project members who can see money. What each person can DO
//   depends on permissions from useProjectContext().can(...):
//     recordPayment   → owner records payments (the "+" button, "pay")
//     decide          → owner approves/rejects milestone requests ("review")
//     requestMilestone→ contractor asks for a milestone payment ("request")
//   The person who was paid can press "I received it" to confirm a payment.
// - URL state: ?show=advances|milestones|unconfirmed filters the list.
// - Data loaded: usePayments(projectId) → { summary, payments, milestones }.
// - Data changed: useCreatePayment (record a payment with proof),
//   useRequestMilestone, useConfirmPayment, plus approve/reject inside
//   <DecisionActions>.
// - Components in this file: PaymentsPage, AdvanceCard (blue advance balance),
//   MilestoneRow (one milestone with its action), PaymentRow (one payment) and
//   RecordPaymentSheet (the form).

// useState hook for local state.
import { useState } from 'react'
// Read/write the ?query string.
import { useSearchParams } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icons for payment types and buttons.
import { Banknote, Flag, HandCoins, Plus, Wallet } from 'lucide-react'
// Lookup objects: payment method key → label, payment type key → label.
import { PAYMENT_METHODS, PAYMENT_TYPES } from '@shared/records.js'
// Approve / ask / reject buttons.
import { DecisionActions } from '../../components/DecisionActions.jsx'
// Upload widget for proof files (screenshots, receipts).
import { EvidenceUploader } from '../../components/evidence/EvidenceUploader.jsx'
// Standard page container.
import { Page } from '../../components/Page.jsx'
// Multi-line named import of UI kit components.
import {
  Button,
  CountUp,
  EmptyState,
  ErrorState,
  Field,
  FilterChips,
  IconButton,
  IconTile,
  Input,
  ListCard,
  ListRow,
  Meter,
  MoneyInput,
  Notice,
  PageSkeleton,
  SectionHead,
  Segmented,
  Select,
  Sheet,
  StatusChip,
  Textarea,
} from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project, current user and the permission checker can().
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Formatting helpers: fixed(n) number formatter, rupees, short dates, split big amounts into number + unit, today's date.
import { fixed, formatPKR, formatShortDate, moneyParts, today } from '../../lib/format.js'
// Data hooks for payments.
import { useConfirmPayment, useCreatePayment, usePayments, useRequestMilestone } from '../../lib/queries.js'

// Icon per payment type.
const TYPE_ICONS = { ADVANCE: Wallet, MILESTONE: Flag, EXPENSE_SETTLEMENT: Banknote, OTHER: HandCoins }

// Default export: the payments page.
export default function PaymentsPage() {
  // project data plus can(permission) → true/false.
  const { project, can } = useProjectContext()
  // Translation function.
  const { t } = useI18n()
  // Current query params and the setter.
  const [params, setParams] = useSearchParams()
  // Active filter from ?show=, or '' (all).
  const filter = params.get('show') ?? ''
  // Load payments; destructure the query result.
  const { data, isLoading, error, refetch } = usePayments(project.id)
  // null = sheet closed; {} = open blank; { milestone } = open to pay a specific milestone.
  const [recording, setRecording] = useState(null) // {} or { milestone }

  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error card with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />
  // Destructure the three parts of the loaded data.
  const { summary, payments, milestones } = data

  // Change the filter in the URL.
  const setFilter = (v) => {
    // Editable copy of the params.
    const next = new URLSearchParams(params)
    // Set ?show=v, or delete it for '' (all).
    v ? next.set('show', v) : next.delete('show')
    // replace: filter changes don't pile up in browser history.
    setParams(next, { replace: true })
  }
  // Payments matching the filter, via a chain of ternaries: advances only / linked to a milestone / not yet confirmed / everything.
  const rows = payments.filter((p) => (filter === 'advances' ? p.type === 'ADVANCE' : filter === 'milestones' ? !!p.milestoneId : filter === 'unconfirmed' ? !p.confirmedAt : true))
  // Count of payments not yet confirmed by the payee.
  const unconfirmed = payments.filter((p) => !p.confirmedAt).length
  // Show the milestones section when there are any and the filter is "all" or "milestones".
  const showMilestones = milestones.length > 0 && (filter === '' || filter === 'milestones')

  return (
    <Page>
      <PageTitle
        // Translated "Payments".
        title={t('nav.payments')}
        // "+" button only if this person may record payments; clicking opens a blank sheet ({}).
        actions={can('recordPayment') && <IconButton icon={Plus} label="Record a payment" onClick={() => setRecording({})} variant="solid" />}
      />

      {/* The blue advance card, only if an advance was ever given. */}
      {summary.advanceGiven > 0 && <AdvanceCard summary={summary} />}

      {/* Filter chips. */}
      <FilterChips
        data-reveal
        className="mb-5"
        label="Show"
        value={filter}
        // Passing the function itself as the handler.
        onChange={setFilter}
        // Options array; `cond && {…}` yields false when the option doesn't apply, and .filter(Boolean) removes those false entries.
        options={[
          { value: '', label: 'all' },
          // .some returns true if at least one payment is an advance.
          payments.some((p) => p.type === 'ADVANCE') && { value: 'advances', label: 'advances' },
          milestones.length > 0 && { value: 'milestones', label: 'milestones' },
          { value: 'unconfirmed', label: 'unconfirmed', count: unconfirmed },
        ].filter(Boolean)}
      />

      {/* Stack of sections. */}
      <div className="flex flex-col gap-8">
        {/* Milestones section. */}
        {showMilestones && (
          <section data-reveal className="flex flex-col gap-3">
            {/* meta: "2 of 5 paid" counted with .filter(...).length. */}
            <SectionHead title="Milestones" meta={`${milestones.filter((m) => m.status === 'PAID').length} of ${milestones.length} paid`} />
            <ListCard>
              {/* One row per milestone; onPay opens the sheet preset to that milestone. */}
              {milestones.map((m) => (
                <MilestoneRow key={m.id} m={m} onPay={() => setRecording({ milestone: m })} />
              ))}
            </ListCard>
          </section>
        )}

        {/* Payments section: hidden only when filtering by milestones and no payments match (|| = either condition). */}
        {filter !== 'milestones' || rows.length > 0 ? (
          <section data-reveal className="flex flex-col gap-3">
            {/* meta: "1 payment" / "3 payments" (singular vs plural by ternary). */}
            <SectionHead title="Paid" meta={rows.length ? `${rows.length} ${rows.length === 1 ? 'payment' : 'payments'}` : undefined} />
            {/* Empty state or the list. */}
            {rows.length === 0 ? (
              <div className="card">
                <EmptyState
                  icon={Banknote}
                  // compact (boolean prop) = smaller layout.
                  compact
                  title={payments.length ? 'Nothing here' : 'No payments yet'}
                  description={payments.length ? 'Try another filter.' : 'Payments recorded with their proof appear here. The person paid confirms them.'}
                />
              </div>
            ) : (
              // animateKey re-runs the row animation when the filter changes.
              <ListCard animateKey={filter}>
                {rows.map((p) => (
                  <PaymentRow key={p.id} p={p} />
                ))}
              </ListCard>
            )}
          </section>
        ) : null}
      </div>

      {/* The record-payment sheet: open when recording isn't null (!! converts to boolean); preset carries an optional milestone. */}
      <RecordPaymentSheet open={!!recording} preset={recording} milestones={milestones} onClose={() => setRecording(null)} />
    </Page>
  )
}

/** The advance in one blue card: how much of it is still to be accounted for. */
// { summary } destructures the prop.
function AdvanceCard({ summary }) {
  // Split the balance into { n, unit, digits }, e.g. 4.5 + "lakh".
  const balance = moneyParts(summary.advanceBalance)
  // Negative balance = more was spent than advanced.
  const over = summary.advanceBalance < 0
  return (
    // Blue card ("hero-blue" defined in our CSS) with rounded corners and white text.
    <section data-reveal className="hero-blue relative mb-6 overflow-hidden rounded-card p-5 text-white sm:p-6">
      {/* Decorative fluted-light overlay. */}
      <div className="fluted pointer-events-none absolute inset-0" aria-hidden />
      {/* relative puts the content above the overlay. */}
      <div className="relative">
        <p className="head text-white/75">Advance</p>
        {/* Big number + unit on one baseline. */}
        <p className="mt-3 flex items-baseline gap-2 font-display font-semibold">
          <span className="text-display-lg">
            {/* A minus sign if over, else nothing. */}
            {over ? '−' : ''}
            {/* CountUp animates the number counting up; format controls the decimal places. */}
            <CountUp value={balance.n} format={fixed(balance.digits)} />
          </span>
          <span className="title text-title">{balance.unit}</span>
        </p>
        {/* Explanation text depending on over. */}
        <p className="mt-1 text-body text-white/85">{over ? 'more spent than advanced' : 'not yet accounted for in purchases'}</p>
        {/* Bar showing used out of given. */}
        <Meter value={summary.advanceUsed} max={summary.advanceGiven} tone="onAccent" className="mt-5" label="Advance accounted for" />
        {/* Two figures at either end below the bar. */}
        <p className="num mt-2 flex justify-between gap-3 text-meta text-white/80">
          <span>{formatPKR(summary.advanceUsed, { compact: true })} used</span>
          <span>{formatPKR(summary.advanceGiven, { compact: true })} given</span>
        </p>
      </div>
    </section>
  )
}

// One milestone row; m = milestone, onPay = open the payment sheet for it.
function MilestoneRow({ m, onPay }) {
  // Project and permission checker.
  const { project, can } = useProjectContext()
  // Mutation for "request payment".
  const request = useRequestMilestone(project.id)
  // Whether the owner's review sheet is open.
  const [reviewing, setReviewing] = useState(false)
  // Pick the right button with a chain of ternaries (status AND permission); null = no button.
  const action =
    // Requested and I can decide → "review".
    m.status === 'REQUESTED' && can('decide') ? (
      <Button size="sm" variant="primary" onClick={() => setReviewing(true)}>
        review
      </Button>
    ) : m.status === 'APPROVED' && can('recordPayment') ? (
      // Approved and I can record payments → "pay".
      <Button size="sm" variant="accent" onClick={onPay}>
        pay
      </Button>
    ) : ['PLANNED', 'REJECTED'].includes(m.status) && can('requestMilestone') ? (
      // .includes checks membership in the array: planned/rejected and I may request → "request".
      <Button
        size="sm"
        variant="secondary"
        // Spinner while the request is sent.
        loading={request.isPending}
        // mutate with both onSuccess and onError callbacks showing toasts.
        onClick={() => request.mutate(m.id, { onSuccess: () => toast.success('Payment requested from the owner'), onError: (err) => toast.error(err.message) })}
      >
        request
      </Button>
    ) : null
  return (
    // Fragment: the row and its sheet side by side.
    <>
      <ListRow
        // Flag icon; dark when paid.
        leading={<IconTile icon={Flag} tone={m.status === 'PAID' ? 'ink' : 'neutral'} />}
        title={m.name}
        // Amount, plus " · requested <date>" only while requested.
        subtitle={`${formatPKR(m.amountPaisa)}${m.requestedAt && m.status === 'REQUESTED' ? ` · requested ${formatShortDate(m.requestedAt)}` : ''}`}
        // The action button, or (?? when action is null) a status chip.
        trailing={action ?? <StatusChip kind="milestone" status={m.status} />}
      />
      {/* Owner's review sheet for a requested milestone. */}
      <Sheet
        // Controlled open state.
        open={reviewing}
        // The sheet calls this with true/false; passing the setter directly.
        onOpenChange={setReviewing}
        title={m.name}
        description={`Requested ${formatShortDate(m.requestedAt)}. Approving lets you pay it.`}
        // footer receives JSX: the decision buttons, closing the sheet when done.
        footer={
          <div className="w-full">
            <DecisionActions targetType="MILESTONE" targetId={m.id} status={m.status} label={`the milestone “${m.name}”`} amount={m.amountPaisa} layout="bar" onDone={() => setReviewing(false)} />
          </div>
        }
      >
        {/* Sheet body: the amount and an explanation. */}
        <p className="num font-display text-display font-semibold text-accent-700">{formatPKR(m.amountPaisa)}</p>
        <p className="mt-2 text-body text-ink-2">The contractor says this stage is complete. Check the progress first if you're not sure.</p>
      </Sheet>
    </>
  )
}

// One payment row.
function PaymentRow({ p }) {
  // Project and the signed-in user.
  const { project, me } = useProjectContext()
  // Mutation for "I received it".
  const confirm = useConfirmPayment(project.id)
  // Icon component for this type (capitalised variable so it can be used as a component), defaulting to Banknote.
  const Icon = TYPE_ICONS[p.type] ?? Banknote
  // Was this payment made to me? (me?.id guards a missing user.)
  const mine = p.payeeUserId === me?.id
  return (
    <ListRow
      leading={<IconTile icon={Icon} tone="accent" />}
      // Who was paid.
      title={p.payeeName}
      // Build an array of parts, drop empty ones with .filter(Boolean), then .join(' · ') them into one string.
      subtitle={[p.milestoneName ?? PAYMENT_TYPES[p.type], formatShortDate(p.paidOn), PAYMENT_METHODS[p.method]?.toLowerCase()].filter(Boolean).join(' · ')}
      trailing={
        <>
          {/* Amount without "Rs ". */}
          <span className="num text-body font-bold">{formatPKR(p.amountPaisa).replace('Rs ', '')}</span>
          {/* Confirmed → chip; mine and unconfirmed → confirm button; otherwise → "unconfirmed" chip. */}
          {p.confirmedAt ? (
            <StatusChip kind="payment" status="CONFIRMED" />
          ) : mine ? (
            <button
              type="button"
              className="text-meta font-semibold text-accent-700 hover:text-accent-800"
              // Prevent double clicks while sending.
              disabled={confirm.isPending}
              // Confirm, then thank the user.
              onClick={() => confirm.mutate(p.id, { onSuccess: () => toast.success('Thanks, payment confirmed') })}
            >
              I received it
            </button>
          ) : (
            <StatusChip kind="payment" status="UNCONFIRMED" />
          )}
        </>
      }
    />
  )
}

// The "record a payment" form inside a sheet.
function RecordPaymentSheet({ open, preset, milestones, onClose }) {
  // Current project (for members and id).
  const { project } = useProjectContext()
  // Mutation that creates the payment.
  const create = useCreatePayment(project.id)
  // People who can be paid: every member except the owner and inspectors.
  const payees = project.members.filter((m) => m.role !== 'OWNER' && m.role !== 'INSPECTOR')
  // The contractor, if any (used as the default payee).
  const contractor = payees.find((m) => m.role === 'CONTRACTOR')
  // A function returning a fresh, empty form (wrapped in parentheses so the arrow returns an object).
  const blank = () => ({
    // Paying a milestone → 'MILESTONE' (or 'ADVANCE' for a milestone with no stage, i.e. the up-front one); otherwise 'ADVANCE'. == null matches null or undefined.
    type: preset?.milestone ? (preset.milestone.stageIndex == null ? 'ADVANCE' : 'MILESTONE') : 'ADVANCE',
    // Default payee: the contractor's id, or '' (= "someone else").
    payeeUserId: contractor?.id ?? '',
    // Free-text name for "someone else".
    payeeName: '',
    // Prefill the milestone's amount if paying one.
    amountPaisa: preset?.milestone?.amountPaisa ?? null,
    // Default date: today.
    paidOn: today(),
    // Default method.
    method: 'BANK_TRANSFER',
    // Transaction ID / cheque number.
    reference: '',
    // Linked milestone id, if any.
    milestoneId: preset?.milestone?.id ?? '',
    // Optional note.
    note: '',
  })
  // useState(blank) passes the function itself: React calls it once to get the initial state ("lazy initial state").
  const [form, setForm] = useState(blank)
  // Uploaded proof files.
  const [proof, setProof] = useState([])
  // Show errors only after a save attempt.
  const [tried, setTried] = useState(false)
  // Remember which preset the form was built for.
  const [lastPreset, setLastPreset] = useState(preset)
  // When the sheet is opened with a different preset, reset everything (state updates during render are allowed for this pattern).
  if (preset !== lastPreset) {
    setLastPreset(preset)
    // Here blank() is called, to get a new object.
    setForm(blank())
    setProof([])
    setTried(false)
  }
  // Curried change-handler maker; accepts either an event (takes .target.value) or a plain value.
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }))
  // Milestones approved and ready to be paid.
  const approved = milestones.filter((m) => m.status === 'APPROVED')
  // Validation: each entry is a message string (or true) when invalid, false when fine.
  const errors = {
    // Neither a member chosen nor a name typed.
    payee: !form.payeeUserId && !form.payeeName.trim() && 'Who was paid?',
    // Amount missing or not positive.
    amount: !(form.amountPaisa > 0) && 'Enter the amount',
    // Milestone type but no milestone chosen.
    milestone: form.type === 'MILESTONE' && !form.milestoneId && 'Choose the milestone',
    // No proof uploaded (the uploader shows its own message).
    proof: !proof.length,
  }
  // Save button handler.
  const save = () => {
    // Turn on error display.
    setTried(true)
    // Object.values gives all error values; .some(Boolean) is true if any is truthy → stop.
    if (Object.values(errors).some(Boolean)) return
    // Send the payment.
    create.mutate(
      {
        type: form.type,
        method: form.method,
        // '' → null (no member).
        payeeUserId: form.payeeUserId || null,
        // Only send a typed name when no member was chosen.
        payeeName: form.payeeUserId ? undefined : form.payeeName.trim(),
        amountPaisa: form.amountPaisa,
        paidOn: form.paidOn,
        // Empty strings become undefined (left out).
        reference: form.reference.trim() || undefined,
        note: form.note.trim() || undefined,
        milestoneId: form.milestoneId || null,
        // Just the ids of the uploaded proof files.
        evidenceIds: proof.map((p) => p.id),
      },
      // The comma operator (a, b) runs a then b: show a toast, then close the sheet.
      { onSuccess: () => (toast.success('Payment recorded. The person paid will be asked to confirm it.'), onClose()) },
    )
  }
  return (
    <Sheet
      open={open}
      // Close when the sheet asks to close (o false).
      onOpenChange={(o) => !o && onClose()}
      // Title names the milestone when paying one.
      title={preset?.milestone ? `Pay ${preset.milestone.name}` : 'Record a payment'}
      // Save button in the footer.
      footer={
        <Button variant="primary" block loading={create.isPending} onClick={save}>
          record payment
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Payment-kind picker, hidden when paying a specific milestone. */}
        {!preset?.milestone && (
          <Segmented
            label="Kind of payment"
            value={form.type}
            onChange={set('type')}
            // Chained array methods: entries → drop MILESTONE if none are approved → turn into { value, label } options. ([v]) destructures just the first item of each pair.
            options={Object.entries(PAYMENT_TYPES)
              .filter(([v]) => v !== 'MILESTONE' || approved.length)
              .map(([value, label]) => ({ value, label: label.toLowerCase() }))}
          />
        )}
        {/* Milestone picker: when the kind is milestone (or one is linked), and not preset. */}
        {(form.type === 'MILESTONE' || form.milestoneId) && !preset?.milestone && (
          <Field label="Milestone" error={tried && errors.milestone}>
            <Select
              value={form.milestoneId}
              onChange={(e) => {
                // Find the chosen milestone.
                const m = milestones.find((x) => x.id === e.target.value)
                // Store its id and copy its amount (keep the old amount if none).
                setForm((f) => ({ ...f, milestoneId: e.target.value, amountPaisa: m?.amountPaisa ?? f.amountPaisa }))
              }}
            >
              {/* Placeholder option with an empty value. */}
              <option value="">Choose…</option>
              {/* One option per approved milestone. */}
              {approved.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {formatPKR(m.amountPaisa)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {/* Payee dropdown: members, plus "Someone else…" (empty value). */}
        <Field label="Paid to">
          <Select value={form.payeeUserId} onChange={set('payeeUserId')}>
            {payees.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="">Someone else…</option>
          </Select>
        </Field>
        {/* Name field only for "someone else". */}
        {!form.payeeUserId && (
          <Field label="Name of the person or shop" error={tried && errors.payee}>
            <Input value={form.payeeName} onChange={set('payeeName')} />
          </Field>
        )}
        {/* Amount in rupees (stored as paisa). */}
        <Field label="Amount" error={tried && errors.amount}>
          <MoneyInput value={form.amountPaisa} onChange={set('amountPaisa')} />
        </Field>
        {/* Two columns: date and method. */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid on">
            {/* max={today()} stops picking a future date. */}
            <Input type="date" value={form.paidOn} max={today()} onChange={set('paidOn')} />
          </Field>
          <Field label="Method">
            <Select value={form.method} onChange={set('method')}>
              {/* ([v, l]) = [key, label] pairs from PAYMENT_METHODS. */}
              {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {/* Optional reference. */}
        <Field label="Reference" optional>
          <Input value={form.reference} onChange={set('reference')} placeholder="Transaction ID or cheque number" />
        </Field>
        {/* Proof uploader with one required slot. */}
        <EvidenceUploader
          projectId={project.id}
          // Controlled list of uploaded files.
          value={proof}
          onChange={setProof}
          // Show "required" errors after a save attempt.
          showErrors={tried}
          // Slot definitions: an array with one object describing the required proof.
          slots={[{ kind: 'BANK_PROOF', label: 'Proof of payment', hint: 'Transfer screenshot, cheque photo or signed cash receipt', required: true, pick: 'file' }]}
        />
        {/* Optional note. */}
        <Field label="Note" optional>
          <Textarea rows={2} value={form.note} onChange={set('note')} />
        </Field>
        {/* Server error, if saving failed. */}
        {create.error && <Notice tone="error">{create.error.message}</Notice>}
      </div>
    </Sheet>
  )
}

