// /p/:id/changes (contractor-run projects). Change requests with their cost and
// extra days, totals, and the sheet to raise a new one.
//
// FILE OVERVIEW
// What it does: lists the project's change requests (proposals that change the
//   drawings, cost or schedule and must be agreed by the owner first). At the
//   top, a row of stats: total approved cost (+/-), extra days agreed, and how
//   many are waiting for a decision. Each row links to the change's own page
//   (/p/:id/changes/:changeId, a different file). A "+" button opens
//   NewChangeSheet, a slide-up form to propose a change with a title,
//   description, reason, cost impact (more or less), extra days and drawings.
//   Old links of the form ?c=<id> are redirected to the change's page.
// Route: /p/:id/changes.
// Who can see it: members of projects run by a contractor (the "changes"
//   feature). Proposing needs the submitChange permission (usually the
//   contractor).
// Data it loads: useChanges (the list) and the useCreateChange mutation from
//   lib/queries.js.
// Depends on: React, React Router (Navigate, useNavigate, useSearchParams),
//   sonner toasts, lucide icons, EvidenceUploader, the UI kit, i18n, project
//   context and money/time formatting helpers.

// useState hook.
import { useState } from 'react'
// <Navigate> redirects when rendered; useNavigate changes page from code; useSearchParams reads the "?..." part of the URL.
import { Navigate, useNavigate, useSearchParams } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icons.
import { GitPullRequestArrow, Plus } from 'lucide-react'
// File/photo uploader.
import { EvidenceUploader } from '../../components/evidence/EvidenceUploader.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { Button, EmptyState, ErrorState, Field, IconButton, IconTile, Input, ListCard, ListRow, MoneyInput, Notice, PageSkeleton, Segmented, Sheet, StatRow, StatusChip, Stepper, Textarea } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// fixed(digits) returns a number formatter; formatPKR formats money; moneyParts splits an amount into { n, digits, unit }; timeAgo gives "2 days ago".
import { fixed, formatPKR, moneyParts, timeAgo } from '../../lib/format.js'
// Query (list of changes) and mutation (create one).
import { useChanges, useCreateChange } from '../../lib/queries.js'

/** Change requests: anything that changes the drawings, cost or schedule is agreed here first. */
// The page component.
export default function ChangesPage() {
  // Project and permission check.
  const { project, can } = useProjectContext()
  // Translation function.
  const { t } = useI18n()
  // Page navigation.
  const navigate = useNavigate()
  // Only the params (first item of the returned array) are needed.
  const [params] = useSearchParams()
  // Is the "new change" sheet open?
  const [creating, setCreating] = useState(false)
  // Load the list: data, loading flag, error and a retry function.
  const { data, isLoading, error, refetch } = useChanges(project.id)

  // Older links used ?c=<id>.
  // Redirect them to /changes/<id>; `replace` so Back does not return to the old URL.
  if (params.get('c')) return <Navigate to={`/p/${project.id}/changes/${params.get('c')}`} replace />
  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Approved changes only.
  const approved = data.filter((c) => c.status === 'APPROVED')
  // Number of changes waiting for the owner (filter then .length).
  const waiting = data.filter((c) => c.status === 'SUBMITTED' || c.status === 'QUERIED').length
  // Sum of approved cost impacts in paisa (.reduce with a starting value of 0).
  const cost = approved.reduce((n, c) => n + c.costImpactPaisa, 0)
  // Split the total into a display number and unit (e.g. 1.2 + 'lakh').
  const costParts = moneyParts(cost)
  return (
    <Page>
      <PageTitle
        // Translated title.
        title={t('nav.changes')}
        // "+" button for people allowed to propose changes.
        actions={can('submitChange') && <IconButton icon={Plus} label="Request a change" onClick={() => setCreating(true)} variant="solid" />}
      />
      {/* Stats row, only when there are changes. */}
      {data.length > 0 && (
        <StatRow
          // Reveal animation marker.
          data-reveal
          className="mb-6"
          // Three stat items as objects.
          items={[
            // Approved cost. `format` is a function the StatRow calls with the (animated) number: it adds a sign (− / + / nothing, nested ternary)
            // and formats with the right number of decimals: fixed(digits) returns a function, which is then called with n.
            // The unit is hidden for plain rupees.
            { value: costParts.n, format: (n) => `${cost < 0 ? '−' : cost > 0 ? '+' : ''}${fixed(costParts.digits)(n)}`, unit: costParts.unit === 'rupees' ? '' : costParts.unit, label: 'approved cost' },
            // Total extra days of approved changes.
            { value: approved.reduce((n, c) => n + c.daysImpact, 0), label: 'extra days agreed' },
            // Waiting count, shown in red when above zero.
            { value: waiting, label: 'waiting', tone: waiting ? 'danger' : undefined },
          ]}
        />
      )}
      {/* Empty state or list. */}
      {data.length === 0 ? (
        <div data-reveal className="card">
          <EmptyState icon={GitPullRequestArrow} title="No change requests" description="When the contractor proposes a change, it appears here with what it costs and how long it adds." />
        </div>
      ) : (
        <div data-reveal>
          <ListCard>
            {/* One row per change. */}
            {data.map((c) => (
              <ListRow
                // Unique key.
                key={c.id}
                // The row links to the change's page.
                to={`/p/${project.id}/changes/${c.id}`}
                // Orange icon tile.
                leading={<IconTile icon={GitPullRequestArrow} tone="accent" />}
                // Change title.
                title={c.title}
                // e.g. "C-3 · +5 days · Ali, 2 days ago". The days part appears only when daysImpact is non-zero (nested template literal in a ternary).
                subtitle={`C-${c.number} · ${c.daysImpact ? `${c.daysImpact > 0 ? '+' : ''}${c.daysImpact} days · ` : ''}${c.createdByName}, ${timeAgo(c.createdAt)}`}
                // Right side: signed amount without the "Rs " prefix, and a status chip.
                trailing={
                  <>
                    <span className="num text-body font-bold">{formatPKR(c.costImpactPaisa, { sign: true }).replace('Rs ', '')}</span>
                    <StatusChip kind="change" status={c.status} />
                  </>
                }
              />
            ))}
          </ListCard>
        </div>
      )}
      {/* New change sheet; after creating, go to the new change's page. */}
      <NewChangeSheet open={creating} onClose={() => setCreating(false)} onCreated={(id) => navigate(`/p/${project.id}/changes/${id}`)} />
    </Page>
  )
}

// Slide-up form for a new change request. Props: open, onClose(), onCreated(id).
function NewChangeSheet({ open, onClose, onCreated }) {
  // Current project.
  const { project } = useProjectContext()
  // Create mutation.
  const create = useCreateChange(project.id)
  // Empty form values (also used to reset).
  const blank = { title: '', description: '', reason: '', cost: null, direction: 'more', days: 0 }
  // Form state.
  const [form, setForm] = useState(blank)
  // Attached files.
  const [files, setFiles] = useState([])
  // Show errors after a try.
  const [tried, setTried] = useState(false)
  // Validation: message when empty, false when fine.
  const errors = { title: !form.title.trim() && 'Give it a short title', description: !form.description.trim() && 'Describe the change' }
  // Reset everything and tell the parent to close.
  const close = () => {
    setForm(blank)
    setFiles([])
    setTried(false)
    onClose()
  }
  return (
    <Sheet
      // Controlled open state.
      open={open}
      // Closing resets the form.
      onOpenChange={(o) => !o && close()}
      title="Request a change"
      description="The owner decides. Their budget stays as it is; approved changes are shown next to it."
      // Footer with the send button.
      footer={
        <Button
          // Full-width primary button.
          variant="primary"
          block
          // Spinner while sending.
          loading={create.isPending}
          // Click handler.
          onClick={() => {
            // Show errors.
            setTried(true)
            // Stop if required fields are empty.
            if (errors.title || errors.description) return
            // mutate(variables, options).
            create.mutate(
              {
                // Trimmed texts.
                title: form.title.trim(),
                description: form.description.trim(),
                // Empty reason left out.
                reason: form.reason.trim() || undefined,
                // Amount (0 if empty) made negative when it saves money.
                costImpactPaisa: (form.cost ?? 0) * (form.direction === 'less' ? -1 : 1),
                // Days as a number (0 if invalid).
                daysImpact: Number(form.days) || 0,
                // Ids of uploaded files.
                evidenceIds: files.map((f) => f.id),
              },
              {
                // Success: destructure the new id, toast, close, and let the parent navigate.
                onSuccess: ({ id }) => {
                  toast.success('Change request sent to the owner')
                  close()
                  onCreated(id)
                },
              },
            )
          }}
        >
          send request
        </Button>
      }
    >
      {/* Form fields. */}
      <div className="flex flex-col gap-4">
        {/* Title; onChange copies the form and replaces `title`. */}
        <Field label="Title" error={tried && errors.title}>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Add a store room under the stairs" />
        </Field>
        {/* Description. */}
        <Field label="What changes" error={tried && errors.description}>
          <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        {/* Optional reason. */}
        <Field label="Why" optional>
          <Textarea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        </Field>
        {/* Cost: direction switch plus amount. */}
        <Field label="Cost" group>
          <div className="flex flex-col gap-2">
            <Segmented
              // Small size.
              size="sm"
              // Accessible label.
              label="Cost direction"
              // Controlled value.
              value={form.direction}
              onChange={(v) => setForm({ ...form, direction: v })}
              // The two choices.
              options={[
                { value: 'more', label: 'costs more' },
                { value: 'less', label: 'saves money' },
              ]}
            />
            {/* Amount in paisa (or null when empty). */}
            <MoneyInput value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} />
          </div>
        </Field>
        {/* Days: a +/- stepper from -60 to 365. */}
        <Field label="Extra days needed" hint="Below zero if it saves time" group>
          <Stepper value={form.days} onChange={(v) => setForm({ ...form, days: v })} min={-60} max={365} label="days" unit="days" />
        </Field>
        {/* Optional drawings or photos (not required, picked from files). */}
        <EvidenceUploader projectId={project.id} value={files} onChange={setFiles} slots={[{ kind: 'DOCUMENT', label: 'Drawings or photos', hint: 'A sketch or photo helps the owner decide.', pick: 'file' }]} />
        {/* Server error, if any. */}
        {create.error && <Notice tone="error">{create.error.message}</Notice>}
      </div>
    </Sheet>
  )
}
