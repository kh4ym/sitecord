// FILE: shared/records.js
// Record vocabulary shared by server and client: statuses, types and the
// evidence each kind of record needs before it can be submitted. The SQL
// CHECK constraints list the same values; keep them in step.
// Imported by both sides: the server validates and transitions records with
// it (services/expenses, payments, decisions, evidence, documents, budget,
// boq, dashboard, projects, routes/projects); the client uses the labels and
// rules in DecisionActions, EvidenceGallery, the purchase, payment, document
// and verify pages. Keys are stored in the database; values are UI labels.
// Depends on nothing; plain data plus a few small functions.

// --- Purchase (expense) types: database key -> label. `export const` makes
// the object importable and stops the name being reassigned. ---
export const EXPENSE_TYPES = {
  MATERIAL: 'Material',
  LABOUR: 'Labour',
  EQUIPMENT: 'Equipment hire',
  TRANSPORT: 'Transport',
  OTHER: 'Other',
}

// Purchase lifecycle: DRAFT -> SUBMITTED -> (QUERIED ->) APPROVED -> VERIFIED,
// or REJECTED. Only drafts and rejections are left out of the money totals.
// Array literal of every allowed status, in lifecycle order.
export const EXPENSE_STATUSES = ['DRAFT', 'SUBMITTED', 'QUERIED', 'APPROVED', 'REJECTED', 'VERIFIED']
/** Purchases that count as money committed to the house (approved or waiting). */
export const COUNTED_EXPENSE_STATUSES = ['SUBMITTED', 'QUERIED', 'APPROVED', 'VERIFIED']
// Statuses where the owner has said yes.
export const APPROVED_EXPENSE_STATUSES = ['APPROVED', 'VERIFIED']
// Statuses still waiting on the owner.
export const WAITING_EXPENSE_STATUSES = ['SUBMITTED', 'QUERIED']

// --- Payment types: key -> label. ---
export const PAYMENT_TYPES = {
  ADVANCE: 'Advance',
  MILESTONE: 'Milestone',
  EXPENSE_SETTLEMENT: 'Purchase settlement',
  OTHER: 'Other',
}

// --- How a payment was made: key -> label. ---
export const PAYMENT_METHODS = {
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  MOBILE_WALLET: 'Mobile wallet',
}

// Every allowed contract type key (labels live in houseConfig / i18n).
export const CONTRACT_TYPE_KEYS = ['LABOUR_ONLY', 'GREY_STRUCTURE', 'TURNKEY', 'SELF_MANAGED']

// --- Kinds of evidence file: key -> label. ---
export const EVIDENCE_KINDS = {
  PHOTO: 'Site photo',
  RECEIPT: 'Receipt',
  INVOICE: 'Invoice',
  HANDWRITTEN_SLIP: 'Handwritten slip',
  DELIVERY_PHOTO: 'Delivery photo',
  BANK_PROOF: 'Payment proof',
  DOCUMENT: 'Document',
}
// How a file was captured: live camera in the app, phone gallery, or a file picker.
export const CAPTURE_MODES = ['IN_APP_CAMERA', 'GALLERY', 'FILE']

// --- Document folders: key -> label. ---
export const DOCUMENT_CATEGORIES = {
  DRAWING: 'Drawings',
  APPROVAL: 'Approvals',
  CONTRACT: 'Contracts',
  RECEIPT: 'Receipts',
  PHOTO: 'Photos',
  OTHER: 'Other',
}

/** Documents an inspector can always open; everything else needs the owner's say-so. */
export const INSPECTOR_DOCUMENT_CATEGORIES = ['DRAWING', 'APPROVAL']

/** Proof that a purchase happened: any one of these. */
// Not exported: only used inside this file.
const PURCHASE_PROOF = ['RECEIPT', 'INVOICE', 'HANDWRITTEN_SLIP']

/** Which kinds of file may be attached to each kind of record. */
// Record type -> allowed evidence kinds. `...PURCHASE_PROOF` spreads that
// array's items into this one.
export const EVIDENCE_KINDS_FOR = {
  EXPENSE: [...PURCHASE_PROOF, 'DELIVERY_PHOTO', 'PHOTO'],
  PAYMENT: ['BANK_PROOF', 'RECEIPT', 'HANDWRITTEN_SLIP'],
  REPORT: ['PHOTO'],
  CHANGE: ['DOCUMENT', 'PHOTO'],
  INSPECTION: ['PHOTO'],
  DOCUMENT: ['DOCUMENT'],
  DECISION: ['PHOTO'],
}

/**
 * Which decisions apply to a record in each status. The server enforces
 * these; the client uses them to show only the buttons that can work.
 * Read as DECISION_RULES[recordType][decision] = statuses it is allowed from.
 * A queried purchase or change cannot be approved until it is resubmitted,
 * so the owner sees the answer first. For purchases VERIFY is a second,
 * on-site confirmation after APPROVE; for reports it is the only sign-off.
 */
// Two-level lookup table; each row is one record type.
export const DECISION_RULES = {
  // Purchases: approve/query from SUBMITTED, reject also from QUERIED, verify after approval.
  EXPENSE: { APPROVE: ['SUBMITTED'], REJECT: ['SUBMITTED', 'QUERIED'], QUERY: ['SUBMITTED'], VERIFY: ['APPROVED'] },
  // Change requests: like purchases but with no verify step.
  CHANGE: { APPROVE: ['SUBMITTED'], REJECT: ['SUBMITTED', 'QUERIED'], QUERY: ['SUBMITTED'] },
  // Milestone payment requests: a simple yes/no.
  MILESTONE: { APPROVE: ['REQUESTED'], REJECT: ['REQUESTED'] },
  // Daily reports: verify (sign off) or query.
  REPORT: { VERIFY: ['SUBMITTED', 'QUERIED'], QUERY: ['SUBMITTED'] },
}

/**
 * How a file's times line up. The phone's clock when it sent the file is
 * compared with the server's, which tells an honest late upload (saved on the
 * phone while offline) apart from a phone whose clock is wrong.
 */
// `ev` is an evidence record with capturedAt, receivedAt and clientSentAt.
export function evidenceTiming(ev) {
  // Small arrow helper: turn a date value into milliseconds since 1970
  // (`new Date(v).getTime()`), or null when `v` is empty (falsy).
  const t = (v) => (v ? new Date(v).getTime() : null)
  const captured = t(ev.capturedAt) // when the photo was taken (phone clock)
  const received = t(ev.receivedAt) // when the server got it (server clock)
  const sent = t(ev.clientSentAt) // when the phone sent it (phone clock)
  // clockOffsetS: how far the phone's clock is from the server's (network
  // delay included). delayS: how long the file sat on the phone between
  // capture and send, measured on the phone's own clock so a wrong clock
  // does not turn into a fake delay.
  // `!= null` is true for any value except null/undefined; /1000 = ms to seconds.
  const clockOffsetS = sent != null && received != null ? Math.round((received - sent) / 1000) : null
  // `sent ?? received`: nullish coalescing - use `sent`, or `received` if sent is null.
  const delayS = captured != null ? Math.round(((sent ?? received) - captured) / 1000) : null
  return {
    clockOffsetS, // shorthand property: same as clockOffsetS: clockOffsetS
    delayS,
    // Five minutes covers slow uploads and small drift; more means a wrong clock.
    clockOk: clockOffsetS != null ? Math.abs(clockOffsetS) <= 300 : null,
    // Longer than 15 minutes is worth telling the owner, not a problem in itself.
    sentLater: delayS != null && delayS > 15 * 60,
  }
}

/**
 * What evidence is still missing before a purchase can be submitted: every
 * purchase needs proof; materials also need a photo of the delivery at the site.
 */
// `type` is the expense type key; `kinds` is the array of attached evidence kinds.
export function expenseEvidenceGaps(type, kinds) {
  const gaps = [] // collects missing-evidence codes
  // `.some` is true if at least one kind is a purchase proof; `!` negates it.
  if (!kinds.some((k) => PURCHASE_PROOF.includes(k))) gaps.push('PROOF')
  // Materials must also have a delivery photo.
  if (type === 'MATERIAL' && !kinds.includes('DELIVERY_PHOTO')) gaps.push('DELIVERY')
  return gaps
}

/** What to ask the user for, keyed by the gap codes the two gap functions return. */
export const GAP_LABELS = {
  PROOF: 'A receipt, invoice or photo of a handwritten slip',
  DELIVERY: 'A photo of the delivery at the site',
  PAYMENT_PROOF: 'Proof of payment: a transfer screenshot, cheque photo or signed cash receipt',
}

/** A payment needs proof it was made; BANK_PROOF covers transfer, cheque and signed cash receipt. */
// Arrow function with a ternary body: no gaps when BANK_PROOF is attached,
// otherwise a one-item array naming the gap.
export const paymentEvidenceGaps = (kinds) => (kinds.includes('BANK_PROOF') ? [] : ['PAYMENT_PROOF'])
