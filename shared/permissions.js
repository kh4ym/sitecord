// FILE: shared/permissions.js
// Who can do what on a project. The server enforces it; the client uses it
// to decide which pages and actions to show. Adapted to the contract type
// and to what the owner has shared with an inspector.
// Owns the role vocabulary and the role x action matrix. Imported by both
// sides: the server in auth/middleware (the `can` check), services/access,
// dashboard, projects, routes/projects, routes/invitations and seed/demo;
// the client in ApprovalsPage, HistoryPage, ProjectSettingsPage, InvitePage,
// AccessLocked and ui/Chip. Action names are the single source of truth;
// add one here and it is enforced and shown everywhere.
// Depends on: features.js (featuresFor) to switch actions off per contract type.

// Named ES module import from the sibling file.
import { featuresFor } from './features.js'

// Lookup table: role key (stored in the database) -> label shown to people.
// `export const` makes it importable elsewhere and not reassignable.
export const ROLE_LABELS = {
  OWNER: 'Owner',
  LOCAL_REP: 'Local representative',
  CONTRACTOR: 'Contractor',
  SUPERVISOR: 'Site supervisor',
  INSPECTOR: 'Inspector',
}
// Object.keys returns the object's keys as an array: ['OWNER', 'LOCAL_REP', ...].
const ROLES = Object.keys(ROLE_LABELS)

// Lookup table: role key -> one-sentence description used on invite screens.
export const ROLE_DESCRIPTIONS = {
  OWNER: 'Sets up the project, approves money and sees everything.',
  LOCAL_REP: 'A trusted person near the site who verifies work. Cannot approve money.',
  CONTRACTOR: 'Submits reports, purchases and change requests, and answers questions.',
  SUPERVISOR: 'Daily reports, task progress and site purchases.',
  INSPECTOR: 'Independent engineer who records inspections. Sees history, reports or photos only when the owner shares them.',
}

/** What an inspector can ask the owner to share, and what each one opens. */
// Nested object literals: each scope key maps to { label, description, actions }.
// `actions` lists the matrix actions that the grant switches on.
export const ACCESS_SCOPES = {
  HISTORY: { label: 'History', description: 'The full record of everything that happened', actions: ['viewAudit'] },
  REPORTS: { label: 'Daily reports', description: 'What the site team reported each day', actions: ['viewReports'] },
  PHOTOS: { label: 'Site photos', description: 'Photos from reports, inspections and the site', actions: ['viewPhotos'] },
}
// How many days a grant can last; offered as choices in the UI.
export const ACCESS_DAYS = [1, 7, 30]

// Base matrix: action -> roles allowed before any contract-type or sharing
// adjustments. TEAM is everyone except the inspector, who only sees what is
// granted (ACCESS_SCOPES) on top of progress and inspections.
const ALL = ROLES // every role
const TEAM = ['OWNER', 'LOCAL_REP', 'CONTRACTOR', 'SUPERVISOR'] // everyone but the inspector
// Each row is `actionName: [roles allowed]`. Rows are grouped below by purpose.
const MATRIX = {
  // --- Viewing rows: who can see each part of the project ---
  viewProgress: ALL, // stage and task progress
  viewMoney: ['OWNER', 'LOCAL_REP', 'CONTRACTOR'], // purchases and payments
  // The owner's total budget is theirs: the contractor sees purchases and payments, not the budget.
  viewBudget: ['OWNER', 'LOCAL_REP'],
  viewBoq: TEAM, // bill of quantities
  viewReports: TEAM, // daily site reports
  viewPhotos: TEAM, // site photos
  viewQuestions: TEAM, // owner/contractor question threads
  viewChanges: ['OWNER', 'LOCAL_REP', 'CONTRACTOR'], // change requests
  viewAllDocuments: TEAM, // every document category
  viewAudit: ['OWNER', 'LOCAL_REP'], // the full history log
  // --- Managing rows: setting up the project ---
  manageProject: ['OWNER'], // edit project settings and team
  setSitePin: ['OWNER', 'LOCAL_REP'], // set the site's map location
  // --- Site-team rows: reporting work and spending ---
  updateProgress: ['CONTRACTOR', 'SUPERVISOR'], // tick off tasks
  submitReport: ['CONTRACTOR', 'SUPERVISOR'], // send a daily report
  createExpense: ['OWNER', 'CONTRACTOR', 'SUPERVISOR'], // log a purchase
  // --- Decision and money rows ---
  decide: ['OWNER'], // approve / reject / query
  submitChange: ['CONTRACTOR'], // ask for a change to the plan
  requestMilestone: ['CONTRACTOR'], // ask for a milestone payment
  recordPayment: ['OWNER'], // record money paid out
  // Whoever was paid confirms it (the service checks the payee is this person).
  confirmPayment: ['LOCAL_REP', 'CONTRACTOR', 'SUPERVISOR'],
  // --- Conversation rows ---
  raiseQuestion: ['OWNER', 'LOCAL_REP'], // start a question thread
  reply: TEAM, // answer in a thread
  // --- Verification and inspection rows ---
  verify: ['OWNER', 'LOCAL_REP', 'INSPECTOR'], // confirm work on site
  recordInspection: ['INSPECTOR'], // file an inspection
  // --- File rows ---
  uploadEvidence: ALL, // attach photos/receipts to records
  uploadDocument: ALL, // add project documents
  manageBoq: ['OWNER'], // edit the bill of quantities
  // --- Inspector sharing rows ---
  requestAccess: ['INSPECTOR'], // ask the owner to share more
  decideAccess: ['OWNER'], // grant or refuse that request
}
// Every action name, in the order written above.
const ACTIONS = Object.keys(MATRIX)

/** Actions that only make sense when the contract type has that feature. */
// Lookup table: feature flag name (from featuresFor) -> actions it controls.
const FEATURE_ACTIONS = {
  inspections: ['recordInspection', 'requestAccess', 'decideAccess'],
  payments: ['recordPayment', 'confirmPayment'],
  milestones: ['requestMilestone'],
  changes: ['submitChange', 'viewChanges'],
  questions: ['raiseQuestion', 'reply', 'viewQuestions'],
}

/**
 * All actions a role may take on a project. `project.contractType` switches
 * features off; `project.grants` lists what the owner currently shares with
 * an inspector (HISTORY, REPORTS, PHOTOS).
 */
export function permissionsFor(role, project) {
  // Three passes: the base matrix, then additions (self-managed owner,
  // inspector grants), then removals for features the contract type lacks.
  // Removals run last so a grant can never reopen a switched-off feature.
  // `let` (unlike const) allows reassignment later. `.filter` keeps actions
  // whose role list `.includes` this role.
  let actions = ACTIONS.filter((a) => MATRIX[a].includes(role))
  // A self-managing owner is also the one reporting progress.
  // `project?.contractType` is optional chaining: gives undefined instead of
  // crashing when `project` is null/undefined. `.push` can add several items.
  if (role === 'OWNER' && project?.contractType === 'SELF_MANAGED') actions.push('updateProgress', 'submitReport')
  // For an inspector, loop over each granted scope (`?? []` = use an empty
  // array when grants is null/undefined) and push that scope's actions;
  // `...(list)` spreads the array into separate push arguments.
  if (role === 'INSPECTOR') for (const scope of project?.grants ?? []) actions.push(...(ACCESS_SCOPES[scope]?.actions ?? []))
  const features = featuresFor(project?.contractType) // this project's feature flags
  // Object.entries gives [key, value] pairs; `[feature, list]` destructures
  // each pair into two variables.
  for (const [feature, list] of Object.entries(FEATURE_ACTIONS)) {
    // When the feature is off, drop every action in its list.
    if (!features[feature]) actions = actions.filter((a) => !list.includes(a))
  }
  // A Set keeps only unique values; spreading it into [...] makes an array again.
  return [...new Set(actions)]
}
