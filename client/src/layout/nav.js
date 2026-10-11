// FILE: client/src/layout/nav.js
//
// What it does: one table for project navigation: every destination (page),
// what it needs (permission, contract feature), and how each role's tabs and
// "more" list are arranged. It also decides each role's landing page and
// whether a destination is the current page.
//
// Where it's used: the phone tab bar, the desktop sidebar and the More page
// all read from here, through ProjectContext.nav, which is built once in
// ProjectLayout (navFor). AppShell uses isActive.
//
// How to extend: adding a page means one DESTINATIONS row and a place in each
// role's LAYOUTS entry.
//
// Depends on: lucide-react (icon components).

// A multi-line named import: each name is an icon React component from lucide-react.
import {
  Box,
  ClipboardCheck,
  ClipboardList,
  Flag,
  FolderOpen,
  GitPullRequestArrow,
  History,
  House,
  Inbox,
  MessageCircleQuestion,
  PencilRuler,
  Receipt,
  Settings,
  Sun,
  Wallet,
} from 'lucide-react'

/**
 * `can`: permission needed. `feature`: contract-type feature needed.
 * `scope`: something an inspector asks the owner for; shown locked until shared.
 * `match`: other paths that light this item up.
 */
// Object literal keyed by destination name. Each entry: `key` (same name), `to`
// (path after /p/:id), `label` (translation key), `icon` (the component itself,
// not rendered yet), plus optional rules. `end: true` = only active on the exact path.
// `badge` names a count to show on the item.
const DESTINATIONS = {
  home: { key: 'home', to: '', end: true, label: 'nav.home', icon: House },
  today: { key: 'today', to: 'today', label: 'nav.today', icon: Sun, can: 'submitReport' },
  progress: { key: 'progress', to: 'progress', label: 'nav.progress', icon: Box },
  money: { key: 'money', to: 'money', label: 'nav.money', icon: Wallet, can: 'viewMoney', match: ['money', 'budget', 'purchases', 'payments', 'materials'] },
  purchases: { key: 'purchases', to: 'purchases', label: 'nav.purchases', icon: Receipt, can: 'viewMoney' },
  approvals: { key: 'approvals', to: 'approvals', label: 'nav.approvals', icon: Inbox, can: 'decide', feature: 'approvals', badge: 'waiting' },
  inspections: { key: 'inspections', to: 'inspections', label: 'nav.inspections', icon: ClipboardCheck, can: 'recordInspection', match: ['inspections', 'verify'] },
  drawings: { key: 'drawings', to: 'documents', label: 'nav.drawings', icon: PencilRuler },
  reports: { key: 'reports', to: 'reports', label: 'nav.reports', icon: ClipboardList, can: 'viewReports', scope: 'REPORTS' },
  questions: { key: 'questions', to: 'questions', label: 'nav.questions', icon: MessageCircleQuestion, can: 'viewQuestions', feature: 'questions', badge: 'openQuestions' },
  changes: { key: 'changes', to: 'changes', label: 'nav.changes', icon: GitPullRequestArrow, can: 'viewChanges', feature: 'changes' },
  findings: { key: 'findings', to: 'findings', label: 'nav.findings', icon: Flag, can: 'viewMoney' },
  documents: { key: 'documents', to: 'documents', label: 'nav.documents', icon: FolderOpen },
  history: { key: 'history', to: 'history', label: 'nav.history', icon: History, can: 'viewAudit', scope: 'HISTORY' },
  settings: { key: 'settings', to: 'settings', label: 'nav.settings', icon: Settings, can: 'manageProject' },
}

// Four tabs at most, so they fit a phone. A key the role can't use (no
// permission, feature off) simply drops out, so the lists are upper bounds.
// Keyed by role; each has `tabs` (main bar) and `more` (overflow list), as arrays of DESTINATIONS keys.
const LAYOUTS = {
  OWNER: { tabs: ['home', 'progress', 'money', 'approvals'], more: ['reports', 'questions', 'changes', 'findings', 'documents', 'history', 'settings'] },
  // An owner managing the build themselves (no contractor).
  OWNER_SELF: { tabs: ['home', 'progress', 'money', 'today'], more: ['reports', 'findings', 'documents', 'history', 'settings'] },
  LOCAL_REP: { tabs: ['home', 'progress', 'money', 'reports'], more: ['questions', 'changes', 'findings', 'documents', 'history'] },
  CONTRACTOR: { tabs: ['today', 'reports', 'purchases'], more: ['progress', 'money', 'questions', 'changes', 'documents'] },
  SUPERVISOR: { tabs: ['today', 'reports', 'progress'], more: ['questions', 'documents'] },
  INSPECTOR: { tabs: ['inspections', 'progress', 'drawings'], more: ['reports', 'history'] },
}

// Pick the layout for this viewer's role on this project.
function layoutFor(project) {
  // Self-managed owners get their own layout.
  if (project.role === 'OWNER' && project.contractType === 'SELF_MANAGED') return LAYOUTS.OWNER_SELF
  // Look up by role (bracket access with a variable key); unknown roles fall back to OWNER.
  return LAYOUTS[project.role] ?? LAYOUTS.OWNER
}

/** Whether a destination applies to this person on this project, and whether it's locked. */
// `can` is a function: can('viewMoney') -> true/false.
function resolve(key, project, can) {
  // The destination definition.
  const d = DESTINATIONS[key]
  // Unknown key: drop it (null is filtered out later).
  if (!d) return null
  // Needs a feature this contract type doesn't have: drop it.
  if (d.feature && !project.features?.[d.feature]) return null
  // Inspectors see scoped pages even without access, marked locked: a copy of d plus `locked`.
  if (d.scope && project.role === 'INSPECTOR') return { ...d, locked: !can(d.can) }
  // Needs a permission the viewer lacks: drop it.
  if (d.can && !can(d.can)) return null
  // Allowed as-is.
  return d
}

/** Tabs (phone tab bar, sidebar top group), the "more" list, and where to land. */
export function navFor(project, can) {
  // This role's layout.
  const layout = layoutFor(project)
  // Helper: resolve each key, then drop the nulls with `.filter(Boolean)`.
  const pick = (keys) => keys.map((k) => resolve(k, project, can)).filter(Boolean)
  // The nav object stored in ProjectContext.
  return { tabs: pick(layout.tabs), more: pick(layout.more), landing: landingFor(project) }
}

/** The first page someone sees when they open a project. */
// Returns a path segment; '' means the Home page.
export function landingFor(project) {
  // Site roles start on Today.
  if (project.role === 'CONTRACTOR' || project.role === 'SUPERVISOR') return 'today'
  // Inspectors start on Inspections if the contract has them, else Progress.
  if (project.role === 'INSPECTOR') return project.features?.inspections ? 'inspections' : 'progress'
  // Everyone else: Home.
  return ''
}

/**
 * Is this destination the current page? Matches on the first path segment
 * after /p/:id, so /purchases/P-12 still lights up "purchases" (or "money",
 * whose `match` lists every money section).
 */
export function isActive(d, pathname) {
  // '/p/12/purchases/P-12'.split('/') -> ['', 'p', '12', 'purchases', 'P-12']; index 3 is the section.
  const section = pathname.split('/')[3] ?? ''
  // `end` destinations (Home) are active only with no section.
  if (d.end) return section === ''
  // Use the `match` list if present, otherwise a one-item list of its own path.
  return (d.match ?? [d.to]).includes(section)
}
