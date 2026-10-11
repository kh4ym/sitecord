// FILE: components/QuestionThread.jsx — a question and its replies as a chat thread.
//
// What it does: shows a question's messages as chat bubbles (yours on the
// right in black, others' on the left in white), a reply box, and a "resolve"
// button; once resolved it shows a "Resolved" note instead of the form.
// Replies need the `reply` permission; resolving is for the asker or the owner.
// Where it's used: the Questions page (full) and inline on the purchase detail
// page (`compact`).
// Depends on: React useState, sonner toasts, lucide-react icons, the project
// context, format helpers, the reply/resolve mutation hooks, and ui Button.

// Local state hook (the reply text).
import { useState } from 'react'
// Pop-up notifications.
import { toast } from 'sonner'
// Send arrow and tick icons.
import { ArrowUp, CircleCheck } from 'lucide-react'
// Current project, permission checker and user.
import { useProjectContext } from '../layout/ProjectContext.jsx'
// Class joiner and date helpers.
import { cn, formatDateTime, timeAgo } from '../lib/format.js'
// Mutation hooks for posting a reply and resolving a question.
import { useReply, useResolveQuestion } from '../lib/queries.js'
// Design-system button.
import { Button } from './ui/index.js'

/**
 * A question as a chat: your messages on the right in black, theirs on the
 * left. The full view on the Questions page; `compact` inline on a purchase.
 * Replies need the `reply` permission; resolving is for the asker or the owner.
 */
// Props: the `question` object (with messages) and a `compact` flag.
export function QuestionThread({ question, compact }) {
  // Project context values.
  const { project, can, me } = useProjectContext()
  // Reply mutation.
  const reply = useReply(project.id)
  // Resolve mutation.
  const resolve = useResolveQuestion(project.id)
  // Controlled reply text.
  const [text, setText] = useState('')
  // Can resolve: not already resolved, and the viewer asked it or is the owner.
  const canResolve = question.status !== 'RESOLVED' && (me?.id === question.createdBy || project.role === 'OWNER')

  // Form submit handler; `e` is the submit event.
  const send = (e) => {
    // Stop the browser's default full-page form submission.
    e.preventDefault()
    // Ignore empty/whitespace-only replies.
    if (!text.trim()) return
    // Post the reply; on success clear the box, on failure show the error as a toast.
    reply.mutate({ id: question.id, body: text.trim() }, { onSuccess: () => setText(''), onError: (err) => toast.error(err.message) })
  }

  return (
    // Column: messages, then the form or resolved note.
    <div className="flex flex-col gap-4">
      {/* Ordered list of messages. */}
      <ol className="flex flex-col gap-3">
        {question.messages.map((m) => {
          // Was this message written by the viewer?
          const mine = m.authorId === me?.id
          return (
            // Align right for mine, left for others.
            <li key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
              <p
                // Bubble: rounded, max 85% wide, keeps line breaks
                // (whitespace-pre-line); black with a smaller bottom-end corner
                // for mine, white bordered with a smaller bottom-start corner for theirs.
                className={cn(
                  'max-w-[85%] rounded-[1.25rem] px-4 py-3 text-body leading-relaxed whitespace-pre-line',
                  mine ? 'rounded-ee-md bg-ink text-white' : 'rounded-es-md border border-line bg-white text-ink',
                )}
              >
                {m.body}
              </p>
              {/* <time> with a machine-readable dateTime and a hover tooltip; text like "You, 5 min ago". */}
              <time className="mt-1 px-1 text-2xs font-semibold text-ink-3" dateTime={m.createdAt} title={formatDateTime(m.createdAt)}>
                {mine ? 'You' : m.authorName}, {timeAgo(m.createdAt)}
              </time>
            </li>
          )
        })}
      </ol>

      {/* Resolved: grey note. Otherwise: the reply form. */}
      {question.status === 'RESOLVED' ? (
        // Tick icon plus "Resolved 2 days ago" (time only when resolvedAt exists).
        <p className="flex items-center gap-2 rounded-tile bg-sunken px-4 py-3 text-meta font-semibold text-ink-2">
          <CircleCheck size={16} aria-hidden /> Resolved {question.resolvedAt && timeAgo(question.resolvedAt)}
        </p>
      ) : (
        // onSubmit runs `send` on Enter or the send button. In the full view the
        // form sticks near the bottom of the screen while scrolling.
        <form onSubmit={send} className={cn('flex items-center gap-2', compact ? '' : 'sticky bottom-24 lg:bottom-4')}>
          {/* Reply box only for people allowed to reply. */}
          {can('reply') && (
            <div className="relative min-w-0 flex-1">
              {/* Screen-reader-only label tied to the input by a per-question id. */}
              <label htmlFor={`reply-${question.id}`} className="sr-only">
                Your reply
              </label>
              <input
                // Matches the label's htmlFor.
                id={`reply-${question.id}`}
                // Controlled input value...
                value={text}
                // ...updated on every keystroke.
                onChange={(e) => setText(e.target.value)}
                placeholder="Write a reply"
                // Pill-shaped input with room on the end for the send button.
                className="field-input rounded-full pe-14"
                // Don't offer browser autofill suggestions.
                autoComplete="off"
              />
              <button
                // Submits the form.
                type="submit"
                // Disabled when empty or while a reply is being sent.
                disabled={!text.trim() || reply.isPending}
                // Small black circle placed inside the input's end edge.
                className="absolute end-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-ink text-white transition disabled:opacity-30"
                aria-label="Send reply"
              >
                <ArrowUp size={17} />
              </button>
            </div>
          )}
          {/* Resolve button for the asker/owner; toast on success. */}
          {canResolve && (
            <Button variant="secondary" loading={resolve.isPending} onClick={() => resolve.mutate(question.id, { onSuccess: () => toast.success('Question resolved') })}>
              resolve
            </Button>
          )}
        </form>
      )}
    </div>
  )
}
