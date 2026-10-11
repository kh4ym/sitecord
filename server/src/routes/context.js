// The bridge between a route and a service: builds the `ctx` every service
// takes, runs the service inside one transaction, and parses request bodies
// with zod. Used by all three route files. The demo seed builds the same
// ctx shape by hand (with `at` set) so it can replay history through the
// services.
//
// Typical use in a route: `res.json(await run(req, (q, ctx) => someService(q, ctx, input)))`.
// Depends only on db/index.js (tx = run inside a transaction).

// Named import of the transaction helper.
import { tx } from '../db/index.js'

/**
 * Everything a service needs to know about who is acting, and where.
 * `at` (an ISO time) back-dates audit entries; only the demo seed sets it.
 * `cleanup` collects undo steps for side effects outside the database (a
 * file written to disk) that must not survive a rolled-back transaction.
 */
export function ctxFrom(req) {
  // Return a new object literal built from fields the middleware put on req.
  return {
    userId: req.user?.id, // `?.`: undefined instead of a crash when req.user is null
    userName: req.user?.name,
    userEmail: req.user?.email,
    project: req.project, // set by loadProject (undefined on non-project routes)
    role: req.role, // the caller's role in that project
    // Permission checker; if loadProject didn't run, `??` supplies a function
    // that always says no. `() => false` is an arrow function with no parameters.
    can: req.can ?? (() => false),
    cleanup: [], // empty array; services push undo functions into it
  }
}

/**
 * Run a service inside a transaction with the request's context. One route
 * call = one transaction, so a service that writes a record, its audit
 * event and its notifications either lands all of them or none. On failure
 * the cleanup steps (files already written to disk) run before the error
 * reaches the handler in app.js.
 */
// fn is the service call, written by the route as (q, ctx) => ...
export async function run(req, fn) {
  // Build the context for this request.
  const ctx = ctxFrom(req)
  try {
    // tx gives a transaction-bound q; pass it and ctx to fn. `return await`
    // inside try makes a rejection land in the catch below.
    return await tx((q) => fn(q, ctx))
  } catch (err) {
    // Run each undo step in turn; ignore failures of the undo itself.
    for (const undo of ctx.cleanup) await undo().catch(() => {})
    // Re-throw so Express's error handler answers the request.
    throw err
  }
}

/** Parse a zod schema against the body (or query), throwing a 400 on failure. */
// schema.parse(data) returns the validated (and cleaned) data, or throws a
// ZodError which app.js turns into a 400. `?? {}` treats a missing body as empty.
export const body = (schema, req) => schema.parse(req.body ?? {})
// Same for URL query-string parameters (?a=1&b=2), found in req.query.
export const query = (schema, req) => schema.parse(req.query ?? {})
