// FILE: components/DecisionTimeline.jsx — the "HISTORY" list on a record page.
//
// What it does: shows who decided what and when, in order: when the record was
// entered, when it was submitted, each decision (approve / reject / question /
// verify on site), and finally who it is waiting on now.
// Where it's used: the sidebar of the purchase, report and change pages.
// Rows come from the server's decisions table for that record.
// Depends on: lib/format.js date helpers (formatDateTime, timeAgo).

// Named imports of two date-formatting helpers.
import { formatDateTime, timeAgo } from '../lib/format.js'

// Lookup table from the server's decision codes to the text shown on screen.
const DECISION = { APPROVE: 'Approved', REJECT: 'Rejected', QUERY: 'Question asked', VERIFY: 'Verified on site' }

/** HISTORY card: entered → submitted → each decision, as plain rows. Sidebar of the purchase, report and change pages. */
// Destructured props: `created` ({ by, at }), `submitted` (a date), `decisions`
// (array of decision rows), `waiting` (text naming who it's waiting on, or empty).
export function DecisionTimeline({ created, submitted, decisions, waiting }) {
  // Build one array of row objects. Some entries may be false; they're removed below.
  const items = [
    // `a && {...}`: if `created` is falsy this entry is just false; otherwise
    // it's the object. The `sub` text is a template literal joining name and relative time.
    created && { key: 'c', title: 'Entered', sub: `${created.by}, ${timeAgo(created.at)}`, at: created.at },
    // Same pattern for the submitted row.
    submitted && { key: 's', title: 'Submitted', sub: timeAgo(submitted), at: submitted },
    // `...` spread: insert every element of the mapped array here. `.map`
    // turns each decision `d` into a row object; `(d) => ({ ... })` is an
    // arrow function whose body is an object, wrapped in () so the braces aren't
    // read as a function body.
    ...decisions.map((d) => ({
      // Unique row id for React's `key`.
      key: d.id,
      // Readable label from the lookup table.
      title: DECISION[d.decision],
      // Name, relative time, and for VERIFY decisions a nested ternary adding
      // whether the photo was taken live or picked from the gallery.
      sub: `${d.decidedByName}, ${timeAgo(d.createdAt)}${d.decision === 'VERIFY' ? (d.livePhoto ? ' · live photo' : ' · gallery photo') : ''}`,
      // Optional note the decider wrote.
      note: d.note,
      // Timestamp, used for the hover tooltip.
      at: d.createdAt,
    })),
    // Final "waiting on ..." row, flagged as pending so it's styled lighter.
    waiting && { key: 'w', title: waiting, sub: submitted ? `Since ${timeAgo(submitted)}` : null, pending: true },
    // .filter(Boolean) keeps only truthy entries, dropping the `false` ones.
  ].filter(Boolean)
  return (
    // Ordered list <ol> styled as a card with dividing lines between rows.
    <ol className="card divide-y divide-line">
      {/* List rendering: map each item to an <li>. React needs a unique `key`
          prop on each element in a list to track them between renders. */}
      {items.map((it) => (
        <li key={it.key} className="px-4 py-3">
          {/* Title; ternary picks a greyer colour for the pending row. */}
          <p className={it.pending ? 'text-body font-semibold text-ink-2' : 'text-body font-semibold text-ink'}>{it.title}</p>
          {/* Only show the note (in curly quotes) when there is one. */}
          {it.note && <p className="mt-0.5 text-meta text-ink-2">“{it.note}”</p>}
          {/* Conditional rendering of a multi-line block: `cond && ( <jsx/> )`. */}
          {it.sub && (
            // `title` gives a native hover tooltip with the exact date/time;
            // `undefined` means "don't set the attribute at all".
            <p className="mt-0.5 text-meta text-ink-3" title={it.at ? formatDateTime(it.at) : undefined}>
              {it.sub}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}
