// /p/:id/questions and /:id (projects with questions). Open and resolved
// question threads tied to records, with the sheet to ask a new one.
//
// FILE OVERVIEW
// What it does: one file, two screens.
//   - QuestionList (/p/:id/questions): every question on the project, filtered
//     by open / resolved / all (the filter lives in the URL as ?show=...). A "+"
//     button opens AskSheet, a slide-up panel for asking a new general question.
//   - QuestionPage (/p/:id/questions/:questionId): one question's conversation
//     (QuestionThread), with its status and a link to the record it is about
//     (a purchase, report, change...).
//   Old links of the form /questions?q=<id> are redirected to the new form.
// Route: /p/:id/questions and /p/:id/questions/:questionId.
// Who can see it: members of projects that have the questions feature.
//   Asking needs the raiseQuestion permission.
// Data it loads: useQuestions (the list), useQuestion (one thread) and the
//   useAskQuestion mutation from lib/queries.js.
// Depends on: React, React Router (Link, Navigate, useNavigate, useParams,
//   useSearchParams), sonner toasts, lucide icons, the QuestionThread
//   component, the UI kit, i18n, project context and timeAgo.

// useState hook.
import { useState } from 'react'
// Router pieces: <Link> (in-app link), <Navigate> (redirects when rendered), useNavigate, useParams, useSearchParams.
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
// Toast notifications.
import { toast } from 'sonner'
// Icon components.
import { Link2, MessageCircleQuestion, Plus } from 'lucide-react'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// The conversation view for one question.
import { QuestionThread } from '../../components/QuestionThread.jsx'
// UI kit components.
import { Button, EmptyState, ErrorState, Field, FilterChips, IconButton, IconTile, Input, ListCard, ListRow, Notice, PageSkeleton, Sheet, StatusChip, Textarea } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// "3 hours ago"-style text.
import { timeAgo } from '../../lib/format.js'
// Query/mutation hooks for questions.
import { useAskQuestion, useQuestion, useQuestions } from '../../lib/queries.js'

/** Questions: the list at /questions, one conversation at /questions/:questionId. */
// The page component: decides which screen to show.
export default function QuestionsPage() {
  // :questionId from the URL (undefined on the list route).
  const { questionId } = useParams()
  // Array destructuring that takes only the first item (the params); the setter is not needed here.
  const [params] = useSearchParams()
  // Current project.
  const { project } = useProjectContext()
  // Older links used ?q=<id>.
  // Rendering <Navigate> redirects to the new URL; `replace` replaces the old entry in the browser history.
  if (!questionId && params.get('q')) return <Navigate to={`/p/${project.id}/questions/${params.get('q')}`} replace />
  // Ternary: one question if there is an id, otherwise the list.
  return questionId ? <QuestionPage id={questionId} /> : <QuestionList />
}

// The list screen.
function QuestionList() {
  // Project and permission check.
  const { project, can } = useProjectContext()
  // Translation function.
  const { t } = useI18n()
  // Page navigation.
  const navigate = useNavigate()
  // Query string state.
  const [params, setParams] = useSearchParams()
  // Current filter (?show=...), default 'open'.
  const filter = params.get('show') ?? 'open'
  // Is the "ask" sheet open?
  const [asking, setAsking] = useState(false)
  // Load all questions.
  const { data, isLoading, error, refetch } = useQuestions(project.id)

  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Questions not yet resolved.
  const open = data.filter((q) => q.status !== 'RESOLVED')
  // Rows to show for the current filter (nested ternary: open / resolved / all).
  const rows = filter === 'open' ? open : filter === 'resolved' ? data.filter((q) => q.status === 'RESOLVED') : data
  return (
    <Page width="narrow">
      <PageTitle
        // Translated title.
        title={t('nav.questions')}
        // "+" button only for people allowed to ask (`&&` gives false otherwise, which renders nothing).
        actions={can('raiseQuestion') && <IconButton icon={Plus} label="Ask a question" onClick={() => setAsking(true)} variant="solid" />}
      />
      <FilterChips
        // Reveal animation marker.
        data-reveal
        className="mb-5"
        label="Show"
        // Current filter.
        value={filter}
        // 'open' is the default so it clears the query; others set ?show=... . replace: no new history entry.
        onChange={(v) => setParams(v === 'open' ? {} : { show: v }, { replace: true })}
        // The three options; "open" shows a count.
        options={[
          { value: 'open', label: 'open', count: open.length },
          { value: 'resolved', label: 'resolved' },
          { value: 'all', label: 'all' },
        ]}
      />
      {/* Empty state or the list. */}
      {rows.length === 0 ? (
        <div data-reveal className="card">
          <EmptyState
            // Question icon.
            icon={MessageCircleQuestion}
            // Message depends on the filter.
            title={filter === 'open' ? 'No open questions' : 'No questions'}
            description="Questions about purchases, reports and changes stay here, on the record."
          />
        </div>
      ) : (
        <div data-reveal>
          {/* animateKey: when the filter changes, the list re-animates. */}
          <ListCard animateKey={filter}>
            {/* One row per question. */}
            {rows.map((q) => (
              <ListRow
                // Unique key.
                key={q.id}
                // `to` makes the whole row a link to the question.
                to={`/p/${project.id}/questions/${q.id}`}
                // Icon tile, amber ("warn") for open questions.
                leading={<IconTile icon={MessageCircleQuestion} tone={q.status === 'OPEN' ? 'warn' : 'neutral'} />}
                // Question title.
                title={q.title}
                // Latest message text.
                subtitle={q.lastMessage}
                // Right side: time of the last message (or creation) and a status chip, grouped in a Fragment.
                trailing={
                  <>
                    <span className="text-2xs font-semibold text-ink-3">{timeAgo(q.lastMessageAt ?? q.createdAt)}</span>
                    <StatusChip kind="question" status={q.status} />
                  </>
                }
              />
            ))}
          </ListCard>
        </div>
      )}
      {/* Ask sheet: after asking, onAsked receives the new id and opens that question. */}
      <AskSheet open={asking} onClose={() => setAsking(false)} onAsked={(id) => navigate(`/p/${project.id}/questions/${id}`)} />
    </Page>
  )
}

// One question's screen. `{ id }` destructures the prop.
function QuestionPage({ id }) {
  // Current project.
  const { project } = useProjectContext()
  // Destructuring with a rename: `data` becomes `q`.
  const { data: q, isLoading, error, refetch } = useQuestion(project.id, id)
  // Loading placeholder (detail layout).
  if (isLoading) return <PageSkeleton variant="detail" />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />
  return (
    <Page width="narrow">
      <PageTitle
        // Back link to the list (an object prop).
        back={{ to: `/p/${project.id}/questions`, label: 'Back to questions' }}
        // "Asked by Ali, 2 days ago".
        kicker={`Asked by ${q.createdByName}, ${timeAgo(q.createdAt)}`}
        // The question as the big title.
        title={q.title}
        // Text for the browser tab title.
        documentTitle={`Question ${q.number}`}
        // Extra row under the title: status chip, and a link to the related record if any.
        meta={
          <>
            <StatusChip kind="question" status={q.status} size="md" />
            {/* Pill-shaped link to the record this question is about. */}
            {q.target && (
              <Link to={q.target.href} className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-white px-3 text-meta font-semibold text-ink hover:border-line-strong">
                <Link2 size={14} aria-hidden /> {q.target.label}
              </Link>
            )}
          </>
        }
      />
      {/* The conversation. */}
      <div data-reveal>
        <QuestionThread question={q} />
      </div>
    </Page>
  )
}

// Slide-up panel for asking a new question. Props: open, onClose(), onAsked(id).
function AskSheet({ open, onClose, onAsked }) {
  // Current project.
  const { project } = useProjectContext()
  // Mutation that creates a question.
  const ask = useAskQuestion(project.id)
  // Form state: title and body text.
  const [form, setForm] = useState({ title: '', body: '' })
  // Show errors after a try.
  const [tried, setTried] = useState(false)
  // Simple validation: `!text.trim() && 'message'` is the message when empty, otherwise false.
  const errors = { title: !form.title.trim() && 'What do you want to know?', body: !form.body.trim() && 'Add a little detail' }
  return (
    <Sheet
      // Controlled open state.
      open={open}
      // When the sheet closes itself, tell the parent.
      onOpenChange={(o) => !o && onClose()}
      title="Ask a question"
      description="It goes to the contractor. To ask about one purchase or report, ask from its page."
      // Footer holds the send button.
      footer={
        <Button
          // Full-width primary button.
          variant="primary"
          block
          // Spinner while sending.
          loading={ask.isPending}
          // Click handler.
          onClick={() => {
            // Show errors.
            setTried(true)
            // Stop if either field is missing.
            if (errors.title || errors.body) return
            // mutate(variables, options).
            ask.mutate(
              // Variables: trimmed title and body.
              { title: form.title.trim(), body: form.body.trim() },
              {
                // Success: destructure the new id from the response.
                onSuccess: ({ id }) => {
                  // Confirmation toast.
                  toast.success('Question sent')
                  // Reset the form.
                  setForm({ title: '', body: '' })
                  setTried(false)
                  // Close the sheet.
                  onClose()
                  // Let the parent open the new question.
                  onAsked(id)
                },
              },
            )
          }}
        >
          send question
        </Button>
      }
    >
      {/* Sheet body: two fields and an error box. */}
      <div className="flex flex-col gap-4">
        {/* Question title, max 160 characters. The onChange copies form and replaces `title`. */}
        <Field label="Question" error={tried && errors.title}>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. When will the roof slab be cast?" maxLength={160} />
        </Field>
        {/* Details text area. */}
        <Field label="Details" error={tried && errors.body} hint="Neutral and specific. It stays on the record.">
          <Textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </Field>
        {/* Server error, if any. */}
        {ask.error && <Notice tone="error">{ask.error.message}</Notice>}
      </div>
    </Sheet>
  )
}
