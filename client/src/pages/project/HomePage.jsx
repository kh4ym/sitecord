// =============================================================================
// HomePage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id  (the project's home tab).
//
// What it shows: the house at a glance: a snapshot image of the house at its
// current build position (tap it to open the 3D progress view), the address
// and week line, a one-sentence status line, three headline figures (spent /
// waiting / left, or % built / waiting / reports this week when the viewer
// can't see money), the offline outbox, what's waiting on this person, and the
// main call-to-action buttons (review approvals, add a purchase).
//
// Who can see it: the owner and the local representative (other roles get a
// different home). The settings button needs "manageProject"; the review
// button needs "decide" with approvals on; the add-purchase button needs
// "createExpense" on projects without a contractor.
//
// Data it loads: the project overview (money, waiting items, counts, next
// step) via the useOverview query hook.
//
// Depends on: React Router (Link), lucide-react, the shared house build
// position helper, the snapshot/notification/outbox/waiting components, the
// UI kit, i18n, and the derive/format helpers.
// =============================================================================

// Link: an <a> tag that changes page inside the app without reloading.
import { Link } from 'react-router'
// Icon components.
import { ArrowUpRight, Plus, Settings } from 'lucide-react'
// Converts stage index + progress into a position for the house snapshot.
import { buildPosition } from '@shared/houseConfig.js'
// Still image of the house at a given build position.
import { HouseSnapshot } from '../../components/HouseSnapshot.jsx'
// The SiteCord wordmark logo.
import { Wordmark } from '../../components/Logo.jsx'
// Bell icon with a notifications dropdown.
import { NotificationsMenu } from '../../components/Notifications.jsx'
// Items saved offline and waiting to be sent.
import { OutboxList } from '../../components/OutboxList.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// Rows of things waiting on this person.
import { WaitingRows } from '../../components/WaitingList.jsx'
// UI kit components.
import { Button, Chip, ErrorState, IconButton, PageSkeleton, SectionHead, StatRow } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Helpers that compose the status sentence and the "week 12" line.
import { statusLine, weekLine } from '../../lib/derive.js'
// Number formatter and money splitter.
import { fixed, moneyParts } from '../../lib/format.js'
// Query hook for the overview.
import { useOverview } from '../../lib/queries.js'

// The page component (default export).
export default function HomePage() {
  // Destructure project, permission checker and feature flags.
  const { project, can, features } = useProjectContext()
  // Translators.
  const { t, term } = useI18n()
  // Fetch the overview.
  const { data, isLoading, error, refetch } = useOverview(project.id)
  // Loading placeholder shaped like a hero layout.
  if (isLoading) return <PageSkeleton variant="hero" />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Base URL of this project, e.g. "/p/12".
  const base = `/p/${project.id}`
  // Money figures; null/undefined when the viewer isn't allowed to see money.
  const money = data.money
  // How many waiting items are approvals: kinds starting with "APPROVE" (.startsWith checks the beginning of a string).
  const approvals = data.waiting.filter((w) => w.kind.startsWith('APPROVE')).length
  // Spent amount split into number + unit; `money?.spent ?? 0` = 0 if money or spent is missing.
  const spent = moneyParts(money?.spent ?? 0)
  // If over budget, show the overspend; otherwise what's left (0 if unknown).
  const left = moneyParts(money?.over ? money.over : (money?.left ?? 0))
  // Kicker text: "address, city" (or just city) and the week line, empty parts filtered out, joined with ". ".
  const kicker = [project.address ? `${project.address}, ${project.city}` : project.city, weekLine(project)].filter(Boolean).join('. ')

  return (
    <Page width="wide">
      {/* Phone-only top bar (lg:hidden hides it on large screens): logo left, buttons right. */}
      <div className="mb-5 flex items-center justify-between lg:hidden">
        <Wordmark />
        <div className="flex items-center gap-2">
          {/* Settings gear only for people who manage the project. */}
          {can('manageProject') && <IconButton icon={Settings} label="Project settings" to={`${base}/settings`} />}
          <NotificationsMenu />
        </div>
      </div>

      {/* Two columns on large screens: house picture left, details right. */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start lg:gap-10">
        {/* The whole picture is a link to the 3D progress page. `group` lets children react to hovering the link (group-hover:...). */}
        <Link data-reveal to={`${base}/progress`} className="group relative block overflow-hidden rounded-card lg:sticky lg:top-8" aria-label="Open the 3D progress view">
          {/* The house image at the current stage and progress; it zooms slightly on hover. */}
          <HouseSnapshot project={project} position={buildPosition(project.stageIndex, project.stageProgress)} className="aspect-[4/3] lg:aspect-[5/4]" imgClassName="transition duration-700 group-hover:scale-[1.03]" />
          {/* Chips overlaid at the bottom corner. */}
          <span className="absolute start-3 bottom-3 flex flex-wrap gap-2">
            {/* "62% built" — t() fills {n} with the overall percentage. */}
            <Chip tone="verified" size="md">
              {t('home.built', { n: project.overall })}
            </Chip>
            {/* "Next: plaster" when there is a next step and the house isn't done. */}
            {data.nextStep?.next && !project.complete && (
              <Chip tone="glass" size="md">
                {t('home.next', { step: term(data.nextStep.next).toLowerCase() })}
              </Chip>
            )}
          </span>
          {/* Round white arrow badge in the top corner (decorative, so aria-hidden). */}
          <span className="absolute end-3 top-3 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-ink backdrop-blur transition group-hover:bg-white" aria-hidden>
            {/* Mirrored for right-to-left languages. */}
            <ArrowUpRight size={18} className="rtl:-scale-x-100" />
          </span>
        </Link>

        {/* Right column. */}
        <div className="flex flex-col gap-7">
          {/* Project name with the kicker line; mb-0 removes the default bottom margin. */}
          <PageTitle kicker={kicker} title={project.name} className="mb-0" />
          {/* One-sentence status, pulled up a little with a negative top margin (-mt-4). */}
          <p data-reveal className="-mt-4 text-body text-ink-2">
            {statusLine(project, data, t, term)}
          </p>

          {/* If the viewer can see money: spent / waiting / left. Otherwise: % built / waiting / reports. */}
          {money ? (
            <StatRow
              data-reveal
              items={[
                // Spent, linking to the budget page; the unit key is built with a template literal, e.g. t('money.lakh').
                { value: spent.n, format: fixed(spent.digits), unit: t(`money.${spent.unit}`), label: t('home.spent'), to: `${base}/budget` },
                // Number of waiting items.
                { value: data.waiting.length, label: t('home.waiting') },
                // A ternary inside the array: "over" (red) when over budget, otherwise "left".
                money.over
                  ? { value: left.n, format: fixed(left.digits), unit: t(`money.${left.unit}`), label: t('home.over'), tone: 'danger' }
                  : { value: left.n, format: fixed(left.digits), unit: t(`money.${left.unit}`), label: t('home.left') },
              ]}
            />
          ) : (
            <StatRow
              data-reveal
              items={[
                // Percentage built.
                { value: project.overall, label: t('home.percentBuilt') },
                // Waiting items.
                { value: data.waiting.length, label: t('home.waiting') },
                // Reports this week, 0 if missing.
                { value: data.counts.reportsThisWeek ?? 0, label: t('home.reportsWeek') },
              ]}
            />
          )}

          {/* Anything saved offline that hasn't been sent yet. */}
          <OutboxList projectId={project.id} />

          {/* "Waiting on you" section. */}
          <section data-reveal className="flex flex-col gap-3">
            {/* A "see all" link only when there are more than 3 approvals and approvals are on. */}
            <SectionHead title={t('home.waitingHead')} action={approvals > 3 && features.approvals ? { label: t('common.seeAll'), to: `${base}/approvals` } : undefined} />
            {/* Show 3 rows (when there's a "see all" link) or 4; `empty` is the text when nothing is waiting. */}
            <WaitingRows items={data.waiting} limit={approvals > 3 ? 3 : 4} empty={t('today.allClear')} />
          </section>

          {/* Main action buttons. */}
          <div data-reveal className="flex flex-col gap-2">
            {/* Review approvals: decision-makers, approvals on, and something to approve. */}
            {can('decide') && features.approvals && approvals > 0 && (
              <Button variant="primary" size="lg" block to={`${base}/approvals`}>
                {t('home.review')}
              </Button>
            )}
            {/* Add purchase: projects without a contractor, for people allowed to create purchases. */}
            {!features.contractor && can('createExpense') && (
              <Button variant="primary" size="lg" block icon={Plus} to={`${base}/purchases/new`}>
                {t('home.addPurchase')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Page>
  )
}
