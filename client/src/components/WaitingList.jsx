// FILE: components/WaitingList.jsx — the "Waiting for you" rows.
//
// What it does: renders the person's to-do items on a project as list rows,
// each with an icon tile, a title, a subtitle with relative time, an optional
// amount and a small chip. The server decides what each person has to do
// (overview.waiting / today.waiting); this file only maps each kind to an
// icon, a tile tone and a chip.
// Where it's used: the Home and Today pages.
// Depends on: lucide-react icons, format helpers (amount, timeAgo), and ui pieces.

// Many icon components imported by name in one statement.
import { Banknote, ClipboardCheck, HandCoins, Inbox, KeyRound, MapPin, MessageCircleQuestion, MessageSquare, PencilLine, ShieldCheck, UserPlus, Wallet } from 'lucide-react'
// amount(paisa, opts) formats money compactly; timeAgo formats relative time.
import { amount, timeAgo } from '../lib/format.js'
// Design-system pieces.
import { Chip, IconTile, ListCard, ListRow } from './ui/index.js'

// kind → [icon, tile tone, [chip tone, chip label]]
// A lookup object whose values are nested arrays (unpacked with array destructuring below).
const KINDS = {
  // A purchase needs approving.
  APPROVE_EXPENSE: [Inbox, 'accent', ['evidence', 'purchase']],
  // A change request needs approving.
  APPROVE_CHANGE: [Inbox, 'warn', ['waiting', 'change']],
  // A milestone payment request needs approving.
  APPROVE_MILESTONE: [HandCoins, 'warn', ['waiting', 'payment']],
  // Someone asked for access to the project.
  APPROVE_ACCESS: [KeyRound, 'neutral', ['waiting', 'access']],
  // An approved milestone is ready to pay.
  PAY_MILESTONE: [Wallet, 'accent', ['approved', 'to pay']],
  // A question about a purchase needs answering.
  ANSWER_EXPENSE: [MessageCircleQuestion, 'warn', ['waiting', 'question']],
  // A general question needs answering.
  ANSWER_QUESTION: [MessageCircleQuestion, 'warn', ['waiting', 'question']],
  // Your question was answered.
  READ_ANSWER: [MessageSquare, 'accent', ['approved', 'answered']],
  // A draft you started needs finishing.
  FINISH_DRAFT: [PencilLine, 'neutral', ['neutral', 'draft']],
  // A payment needs confirming as received.
  CONFIRM_PAYMENT: [Banknote, 'accent', ['evidence', 'confirm']],
  // A milestone can be requested for payment.
  REQUEST_MILESTONE: [HandCoins, 'accent', ['evidence', 'request']],
  // A purchase can be verified on site.
  VERIFY_EXPENSE: [ShieldCheck, 'neutral', ['neutral', 'check']],
  // A report can be verified on site.
  VERIFY_REPORT: [ShieldCheck, 'neutral', ['neutral', 'check']],
  // A step needs inspecting.
  INSPECT: [ClipboardCheck, 'warn', ['waiting', 'inspect']],
  // Invite people to the project.
  INVITE: [UserPlus, 'accent', ['evidence', 'invite']],
  // Set the site's map pin.
  PIN_SITE: [MapPin, 'neutral', ['neutral', 'set up']],
}

/** The person's to-do list on this project, worked out by the server per role. */
// Props: `items` from the server, max rows `limit` (default 3), and the
// `empty` message (default text) shown when there's nothing.
export function WaitingRows({ items, limit = 3, empty = 'Nothing is waiting for you.' }) {
  // Empty list: show a simple card with the message.
  if (!items.length) {
    return (
      // data-reveal: included in the page's reveal animation.
      <div data-reveal className="card px-5 py-6 text-center text-meta text-ink-3">
        {empty}
      </div>
    )
  }
  return (
    <ListCard>
      {/* First `limit` items; map gives each item and its index `i`. */}
      {items.slice(0, limit).map((item, i) => {
        // Nested array destructuring: [icon, tone, [chipTone, chip]] pulls four
        // values out of the KINDS entry, or out of the fallback after `??` for unknown kinds.
        const [icon, tone, [chipTone, chip]] = KINDS[item.kind] ?? [Inbox, 'neutral', ['neutral', '']]
        return (
          <ListRow
            // Key built from kind, link and index so it's unique even for repeats.
            key={`${item.kind}-${item.href}-${i}`}
            // The whole row links to the place to act.
            to={item.href}
            // Leading icon tile, passed as a JSX element prop.
            leading={<IconTile icon={icon} tone={tone} />}
            title={item.title}
            // Join subtitle and relative time with " · ", skipping missing parts.
            subtitle={[item.subtitle, item.at && timeAgo(item.at)].filter(Boolean).join(' · ')}
            // Trailing content: a Fragment holding the amount and the chip.
            trailing={
              <>
                {/* Amount when present (`!= null` so 0 still shows); `sign` adds +/- for signed amounts. */}
                {item.amountPaisa != null && <span className="num text-body font-bold">{amount(item.amountPaisa, { sign: item.signed })}</span>}
                {/* Chip only when it has a label (the '' fallback is falsy). */}
                {chip && <Chip tone={chipTone}>{chip}</Chip>}
              </>
            }
          />
        )
      })}
    </ListCard>
  )
}
