// FILE: client/src/lib/status.js
//
// What it does: one vocabulary for every status chip in the app. For each kind
// of record (expense, report, milestone...) and each server status
// (DRAFT, APPROVED...) it gives a pair [tone, label].
//
// Where it's used: tones map to colours in components/ui/Chip.jsx; labels can
// be translated with keys `chip.<kind>.<STATUS>` in i18n/strings.js. Read
// through StatusChip; only `expenseChip` is called by pages directly
// (purchase lists and detail).
//
// Depends on: nothing.
//
//   evidence  blue tint   has proof, waiting for someone
//   waiting   amber tint  needs attention or an answer
//   verified  black       checked on site / confirmed
//   approved  solid blue  accepted
//   neutral   grey        draft, done, not applicable
//   danger    red tint    rejected, failed, not sent

// A nested object literal used as a lookup table: STATUS[kind][status] -> [tone, label].
// Each value is a two-element array.
const STATUS = {
  // Purchases / expenses.
  expense: {
    DRAFT: ['neutral', 'draft'],
    SUBMITTED: ['evidence', 'evidence'],
    QUERIED: ['waiting', 'question'],
    APPROVED: ['approved', 'approved'],
    REJECTED: ['danger', 'rejected'],
    VERIFIED: ['verified', 'verified'],
    // Not a server status: computed by expenseChip below when there are open findings.
    FLAGGED: ['waiting', 'price check'],
  },
  // Daily site reports.
  report: { SUBMITTED: ['neutral', 'reported'], QUERIED: ['waiting', 'question'], VERIFIED: ['verified', 'verified'] },
  // Payment milestones.
  milestone: {
    PLANNED: ['neutral', 'planned'],
    REQUESTED: ['waiting', 'requested'],
    APPROVED: ['approved', 'approved'],
    REJECTED: ['danger', 'not approved'],
    PAID: ['verified', 'paid'],
  },
  // Payments made.
  payment: { CONFIRMED: ['verified', 'confirmed'], UNCONFIRMED: ['neutral', 'unconfirmed'] },
  // Change requests.
  change: { SUBMITTED: ['waiting', 'waiting'], QUERIED: ['waiting', 'question'], APPROVED: ['approved', 'approved'], REJECTED: ['danger', 'rejected'] },
  // Questions between owner and engineer.
  question: { OPEN: ['waiting', 'waiting'], ANSWERED: ['approved', 'answered'], RESOLVED: ['neutral', 'resolved'] },
  // Inspection results.
  inspection: { PASS: ['verified', 'passed'], PARTIAL: ['waiting', 'needs fixes'], FAIL: ['danger', 'failed'], NONE: ['neutral', 'not inspected'] },
  // Automated findings (e.g. price checks), by severity.
  finding: { HIGH: ['waiting', 'high'], MEDIUM: ['waiting', 'medium'], LOW: ['neutral', 'low'], DISMISSED: ['approved', 'resolved'] },
  // Shared-access grants.
  access: {
    NONE: ['neutral', 'not shared'],
    PENDING: ['waiting', 'requested'],
    ACTIVE: ['approved', 'shared'],
    EXPIRED: ['neutral', 'ended'],
    DENIED: ['neutral', 'declined'],
    REVOKED: ['neutral', 'ended'],
    CANCELLED: ['neutral', 'withdrawn'],
  },
  // Items in the offline upload queue (lib/outbox).
  outbox: { WAITING: ['waiting', 'waiting'], SENDING: ['evidence', 'sending'], FAILED: ['danger', 'not sent'] },
}

/** [tone, english label] for a status, or a grey fallback. */
// `STATUS[kind]?.[status]`: bracket access with a variable key, guarded by optional
// chaining in case the kind is unknown. Fallback: grey tone and the status lower-cased
// (`String(status ?? '')` makes sure we have a string even for null).
export const statusOf = (kind, status) => STATUS[kind]?.[status] ?? ['neutral', String(status ?? '').toLowerCase()]

/** The chip for a purchase in a list: open flags win over the plain status. */
// If the expense has open findings and is still under review, show FLAGGED; otherwise its own status.
export const expenseChip = (e) => (e.openFindings > 0 && ['SUBMITTED', 'QUERIED'].includes(e.status) ? 'FLAGGED' : e.status)
