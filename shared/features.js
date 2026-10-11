// FILE: shared/features.js
// What applies to a project depends on how the contract works (proposal §5:
// "the project records its contract type and the dashboard adapts"). The
// server enforces these; the client uses them for navigation and pages.
// Owns the feature flags per contract type. Imported by both sides: the
// server in services/projects, dashboard, decisions, expenses, payments,
// plan, reports and routes/projects; the client in ProjectsPage, the
// project pages (Today, Progress, Reports, Verify, NewReport) and
// lib/useProgressEditor. permissions.js builds on featuresFor.
// Depends on: houseConfig.js (buildStages) only. Plain JavaScript, no
// framework, so the same file runs in Node and in the browser.

// ES module import: pulls the named export `buildStages` out of the sibling
// file. The curly braces mean "named import"; the './' path is relative and
// the '.js' extension is required for ES modules in Node.
import { buildStages } from './houseConfig.js'

/** Roles an owner can invite; a self-managed project has no contractor or inspector. */
// `export` makes the name importable from other files; `const` declares a
// binding that cannot be reassigned. The value is an array literal of strings.
export const INVITE_ROLES = ['CONTRACTOR', 'SUPERVISOR', 'LOCAL_REP', 'INSPECTOR']

/** Feature flags for a contract type; every other type gets the full set. */
// A named, exported function declaration taking one parameter, `contractType`.
export function featuresFor(contractType) {
  // Self-managed: the owner buys, pays and reports. There is no contractor to
  // approve, pay or question, and no third-party inspection.
  // `===` is strict equality (no type conversion); the result is true/false.
  const self = contractType === 'SELF_MANAGED'
  // Return an object literal: { key: value, ... }. Each flag is the opposite
  // of `self` (the `!` operator negates a boolean).
  return {
    contractor: !self, // is there a contractor on this project?
    approvals: !self, // does the owner approve contractor purchases?
    payments: !self, // are there payments to a contractor?
    milestones: !self, // are payments tied to milestones?
    changes: !self, // are change requests used?
    questions: !self, // can the owner ask the contractor questions?
    inspections: !self, // are third-party inspection steps included?
    // Ternary operator `cond ? a : b`: self-managed projects may only invite
    // a local rep; every other project may invite any of INVITE_ROLES.
    inviteRoles: self ? ['LOCAL_REP'] : INVITE_ROLES,
  }
}

/** The project's stages, without inspection steps when it has no inspections. */
// An exported arrow function: `(project) => expr` returns `expr` directly.
// It reads `project.floors` (dot = property access) and passes an options
// object whose `inspections` flag comes from this contract type's features.
export const stagesFor = (project) => buildStages(project.floors, { inspections: featuresFor(project.contractType).inspections })
