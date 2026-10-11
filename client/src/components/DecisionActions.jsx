// FILE: components/DecisionActions.jsx — approve / ask / reject / verify buttons.
//
// What it does: renders the decision buttons for a record (purchases, reports,
// changes and milestones) with their confirmation dialogs. Buttons only appear
// for people allowed to use them and only when the record's status allows it.
// Approve, question and reject all go through the one /decisions endpoint
// (useDecide); "verify on site" links to the Verify page, which takes a live
// photo at the site.
// Where it's used: the detail pages, and inside the Approvals review sheet and
// the milestone review sheet.
// Depends on: React useState, sonner (toast pop-ups), shared/records.js
// (DECISION_RULES, the same table the server enforces), the project context
// (current project, permissions, current user, feature flags), format helpers,
// the useDecide mutation hook, and the ui Button / ConfirmDialog.

// Hook for local component state.
import { useState } from 'react'
// `toast` shows small pop-up notifications ("Approved P-12").
import { toast } from 'sonner'
// Table of which decisions each record type allows in each status.
import { DECISION_RULES } from '@shared/records.js'
// Hook returning the current project, permission checker and user.
import { useProjectContext } from '../layout/ProjectContext.jsx'
// Class joiner and rupee formatter.
import { cn, formatPKR } from '../lib/format.js'
// TanStack Query mutation hook that POSTs a decision.
import { useDecide } from '../lib/queries.js'
// Design-system components via the ui barrel file.
import { Button, ConfirmDialog } from './ui/index.js'

// Which record types can be verified on site, and the URL word for each.
const VERIFY_KIND = { EXPENSE: 'purchase', REPORT: 'report' }

/**
 * approve (black) / ask a question (outlined) / reject (text), shown only to
 * people allowed to and only when the record's status allows it. Verifying
 * opens the Verify page, which takes a live photo at the site.
 *   <DecisionActions targetType="EXPENSE" targetId status label amount createdBy layout="bar" />
 */
// Props: what record (`targetType`, `targetId`), its `status`, a human `label`
// ("P-12"), optional `amount`, who created it, `layout` ('row' default or 'bar'
// for stacked full-width buttons), an `onDone` callback, and the ask-button text.
export function DecisionActions({ targetType, targetId, status, label, amount, createdBy, layout = 'row', onDone, askLabel = 'ask a question' }) {
  // Destructure four values from the project context.
  const { project, can, me, features } = useProjectContext()
  // Mutation object with mutateAsync, isPending, error, reset.
  const decide = useDecide(project.id)
  // Which dialog is open: 'APPROVE' | 'REJECT' | 'QUERY' | null.
  const [dialog, setDialogState] = useState(null)
  // A failure in one dialog must not show up in the next one.
  // The comma operator `(a, b)` runs a then b and returns b: clear the
  // mutation's error, then set the dialog.
  const setDialog = (d) => (decide.reset(), setDialogState(d))
  // Which decisions a record's status allows comes from shared/records.js,
  // the same table the server enforces, so a button never appears that the
  // API would refuse. Permissions decide who; rules decide when.
  // Chained `?.` guards each lookup step; `.includes(status)` checks the list.
  const allowed = (d) => DECISION_RULES[targetType]?.[d]?.includes(status)
  // Nobody approves their own purchase, except an owner running the site alone.
  const ownWork = createdBy && createdBy === me?.id && project.contractType !== 'SELF_MANAGED'

  // Can approve: has permission, status allows it, and it isn't their own work.
  const approve = can('decide') && allowed('APPROVE') && !ownWork
  // Can ask: questions feature not switched off; reports need the raiseQuestion
  // permission, other records need decide; and the status allows QUERY.
  const query = features.questions !== false && (targetType === 'REPORT' ? can('raiseQuestion') : can('decide')) && allowed('QUERY')
  // Can reject.
  const reject = can('decide') && allowed('REJECT')
  // Can verify: permission, status, and a verifiable record type (truthy URL word).
  const verify = can('verify') && allowed('VERIFY') && VERIFY_KIND[targetType]
  // No buttons to show: render nothing.
  if (!approve && !query && !reject && !verify) return null

  // Awaited rather than passed as mutate callbacks: a decided record can drop
  // out of the list that rendered these buttons, and the follow-up must still run.
  // `async` arrow function: inside it, `await` pauses until a Promise settles.
  // `extra = {}` is a default parameter (e.g. { note }).
  const run = async (decision, extra = {}) => {
    // try/catch: if the request fails, jump to catch instead of crashing.
    try {
      // Send the decision; `...extra` spreads in extra fields like the note.
      await decide.mutateAsync({ targetType, targetId, decision, ...extra })
      // `catch {` without a variable: we don't need the error object here.
    } catch {
      return // shown in the dialog
    }
    // Success: close the dialog.
    setDialog(null)
    // Pick the success message by indexing an object literal with `[decision]`.
    toast.success({ APPROVE: `Approved ${label}`, REJECT: `Rejected ${label}`, QUERY: 'Question sent' }[decision])
    // `?.()` calls onDone only if the parent supplied it.
    onDone?.(decision)
  }
  // " (Rs 12,000)" when an amount is known, else an empty string.
  const amountText = amount != null ? ` (${formatPKR(amount)})` : ''

  return (
    // Fragment: the buttons and the three dialogs side by side without a wrapper element.
    <>
      {/* Button container: stacked column for 'bar' layout, wrapping row otherwise. */}
      <div className={cn(layout === 'bar' ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2')}>
        {/* Approve button opens the approve dialog. `block` = full width in bar layout. */}
        {approve && (
          <Button variant="primary" block={layout === 'bar'} onClick={() => setDialog('APPROVE')}>
            approve
          </Button>
        )}
        {/* Verify is a link (`to`) to the Verify page for this record; built with a template literal. */}
        {verify && (
          <Button variant="accent" block={layout === 'bar'} to={`/p/${project.id}/verify/${VERIFY_KIND[targetType]}/${targetId}`}>
            verify on site
          </Button>
        )}
        {/* The ask and reject buttons share one row. */}
        {(query || reject) && (
          <div className={cn('flex items-center gap-2', layout === 'bar' && 'w-full')}>
            {/* Ask a question; takes half the row in bar layout (flex-1). */}
            {query && (
              <Button variant="secondary" className={layout === 'bar' ? 'flex-1' : ''} onClick={() => setDialog('QUERY')}>
                {askLabel}
              </Button>
            )}
            {/* Reject as red text button. */}
            {reject && (
              <Button variant="danger-text" className={layout === 'bar' ? 'flex-1' : ''} onClick={() => setDialog('REJECT')}>
                reject
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Approve confirmation. */}
      <ConfirmDialog
        // Open when this is the active dialog.
        open={dialog === 'APPROVE'}
        // When it asks to close (`o` false), clear the dialog.
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Approve ${label}?`}
        description={`This accepts ${label}${amountText}. It's recorded in the history with your name.`}
        confirmLabel="approve"
        // Spinner while the request runs.
        loading={decide.isPending}
        // Error message from a failed request (undefined if none).
        error={decide.error?.message}
        // Send the APPROVE decision.
        onConfirm={() => run('APPROVE')}
      />
      {/* Reject confirmation, requiring a written reason. */}
      <ConfirmDialog
        open={dialog === 'REJECT'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Reject ${label}?`}
        description="The person who submitted it sees your reason."
        confirmLabel="reject"
        // Red confirm button.
        tone="danger"
        // Show the reason box with this label and placeholder...
        noteLabel="Reason"
        notePlaceholder="For example: the price is higher than agreed."
        // ...and make it mandatory.
        requireNote
        loading={decide.isPending}
        error={decide.error?.message}
        // `{ note }` is shorthand for `{ note: note }`.
        onConfirm={(note) => run('REJECT', { note })}
      />
      {/* Question dialog: the note is the question text. */}
      <ConfirmDialog
        open={dialog === 'QUERY'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Ask about ${label}`}
        description="It goes to the person who submitted it, and the record waits for the answer."
        confirmLabel="send question"
        noteLabel="Your question"
        notePlaceholder="Ask in a neutral way, e.g. “Can you share the delivery slip?”"
        requireNote
        loading={decide.isPending}
        error={decide.error?.message}
        onConfirm={(note) => run('QUERY', { note })}
      />
    </>
  )
}
