// / (signed in). The person's houses as cards with a 3D snapshot, stage line,
// budget meter (money roles) and waiting count; "+" starts a new project.
//
// FILE OVERVIEW
// - Route: /  (the index route inside the signed-in app shell, RequireAuth).
// - Who sees it: every signed-in person. Owners see their own houses; invited
//   people (contractor, family rep, inspector) see the houses they joined, with
//   a role tag on the card.
// - Data loaded: useMe() (for the "Salaam, <first name>" greeting) and
//   useProjects() (list of projects with stage, progress, money summary if the
//   role may see money, and how many items are waiting).
// - What it renders: a phone-only top bar (logo, notifications, account), then
//   either loading skeletons, an error card, a "first project" prompt, or a
//   grid of ProjectCard links. Each card links to the project's landing page
//   for that person's role (landingFor from layout/nav.js).
// - Depends on: React Router's <Link>, lucide icons, shared house config and
//   feature flags, HouseSnapshot (static 3D image), our UI kit and format
//   helpers.

// <Link> navigates within the app without reloading.
import { Link } from 'react-router'
// Icon components.
import { Link2, Plus, UserRound } from 'lucide-react'
// Shared data/helpers: contract type labels, the list of build stages, and "Double storey"-style labels.
import { CONTRACT_TYPES, buildStages, storeyLabel } from '@shared/houseConfig.js'
// A picture of the house's 3D model at its current stage.
import { HouseSnapshot } from '../components/HouseSnapshot.jsx'
// featuresFor(contractType) says which features (inspections, payments, …) a project type has.
import { featuresFor } from '@shared/features.js'
// Logo.
import { Wordmark } from '../components/Logo.jsx'
// Bell icon with the notifications dropdown.
import { NotificationsMenu } from '../components/Notifications.jsx'
// Standard page container.
import { Page } from '../components/Page.jsx'
// UI kit components used here.
import { Button, Chip, ErrorState, IconButton, Meter, RoleTag, Skeleton } from '../components/ui/index.js'
// Page heading component.
import { PageTitle } from '../layout/PageHeader.jsx'
// Which sub-page a role should land on inside a project.
import { landingFor } from '../layout/nav.js'
// firstName pulls the first name out of a full name; formatPKR formats rupees.
import { firstName, formatPKR } from '../lib/format.js'
// Data hooks: current user and the user's projects.
import { useMe, useProjects } from '../lib/queries.js'

// Default export: the home page listing your houses.
export default function ProjectsPage() {
  // Rename data to me.
  const { data: me } = useMe()
  // Destructure several fields at once, renaming data to projects.
  const { data: projects, isLoading, error, refetch } = useProjects()

  return (
    // Fragment: returns several siblings without a wrapper element.
    <>
      {/* Phone-only top bar (lg:hidden hides it on large screens, where the sidebar shows these). */}
      <div className="mb-6 flex items-center justify-between lg:hidden">
        <Wordmark />
        <div className="flex items-center gap-2">
          <NotificationsMenu />
          {/* Round icon button that links to /settings. */}
          <IconButton icon={UserRound} label="Account" to="/settings" />
        </div>
      </div>
      {/* Error card with retry, if loading failed. */}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {/* While loading: two grey placeholder cards. */}
      {isLoading && (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {/* [0, 1].map(...) is a quick way to render something twice; the number is the key. */}
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[340px] rounded-card" />
          ))}
        </div>
      )}
      {/* Once projects have loaded: */}
      {projects && (
        <Page width="wide">
          <PageTitle
            // Greeting above the title if a first name is known (me?.name guards a missing user); undefined = no kicker.
            kicker={firstName(me?.name) ? `Salaam, ${firstName(me.name)}` : undefined}
            title="Your houses"
            // Text for the browser tab.
            documentTitle="Houses"
            // actions takes JSX: a solid "+" button linking to the new-project wizard.
            actions={<IconButton icon={Plus} label="Add a house" to="/projects/new" variant="solid" />}
          />
          {/* No projects yet → onboarding card; otherwise the grid. */}
          {projects.length === 0 ? (
            <FirstProject />
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {/* One <li> per project, keyed by id; data-reveal animates it in. */}
              {projects.map((p) => (
                <li key={p.id} data-reveal>
                  <ProjectCard project={p} />
                </li>
              ))}
            </ul>
          )}
        </Page>
      )}
    </>
  )
}

// One project card. ({ project: p }) destructures the `project` prop and renames it to p.
function ProjectCard({ project: p }) {
  // Feature flags for this contract type.
  const features = featuresFor(p.contractType)
  // Build the list of stages for this many floors, then pick the current one by index with [p.stageIndex].
  const stage = buildStages(p.floors, { inspections: features.inspections })[p.stageIndex]
  // Landing sub-page for this role ('' for the project home); { ...p, features } copies p and adds features.
  const landing = landingFor({ ...p, features })
  return (
    // The whole card is a link; nested template literal adds "/landing" only when landing isn't ''. "group" lets children react to hovering the card.
    <Link to={`/p/${p.id}${landing ? `/${landing}` : ''}`} className="card group flex h-full flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-pop">
      <div className="relative">
        {/* House image in a 16:10 box; it zooms slightly when the card is hovered (group-hover). */}
        <HouseSnapshot project={p} className="aspect-[16/10]" imgClassName="transition duration-700 group-hover:scale-[1.03]" />
        {/* Role badge for anyone who isn't the owner. */}
        {p.role !== 'OWNER' && <RoleTag role={p.role} className="absolute start-3 top-3" />}
        {/* "N waiting" chip when items are waiting. */}
        {p.waiting > 0 && (
          <Chip tone="waiting" className="absolute end-3 top-3 shadow-sm">
            {p.waiting} waiting
          </Chip>
        )}
      </div>
      {/* Card body; flex-1 fills the height so mt-auto below can push the meter down. */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className="title text-title leading-snug text-ink">{p.name}</p>
          {/* City · plot label (only the part before the first " · ", via .split(...)[0]) · storeys in lowercase. */}
          <p className="mt-1 text-meta text-ink-3">
            {p.city} · {p.plotLabel.split(' · ')[0]} · {storeyLabel(p.floors).toLowerCase()}
          </p>
        </div>
        {/* Progress block pinned to the bottom. */}
        <div className="mt-auto flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-meta">
            {/* "Complete", or the current stage name and its progress. */}
            <span className="font-semibold text-ink-2">{p.complete ? 'Complete' : `${stage.label} · ${p.stageProgress}%`}</span>
            <span className="num font-bold">{p.overall}% built</span>
          </div>
          {/* Progress bar with an accessible label. */}
          <Meter value={p.overall} size="sm" label={`${p.name}: ${p.overall}% built`} tone="ink" />
          {/* Money line only exists for roles allowed to see money. */}
          {p.money && (
            <p className="flex items-baseline justify-between text-meta">
              {/* Contract type label. */}
              <span className="text-ink-3">{CONTRACT_TYPES[p.contractType].label}</span>
              {/* Red bold when over budget. */}
              <span className={p.money.over ? 'font-bold text-danger-700' : 'text-ink-2'}>
                {/* Ternary across lines: "X over budget" or "spent of budget". */}
                {p.money.over
                  ? `${formatPKR(p.money.over, { compact: true })} over budget`
                  : `${formatPKR(p.money.spent, { compact: true })} of ${formatPKR(p.money.budget, { compact: true })}`}
              </span>
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}

// Onboarding card shown when the person has no projects yet.
function FirstProject() {
  return (
    <div data-reveal className="card flex flex-col items-start gap-4 p-8 sm:p-10">
      <h2 className="title text-display">Add your house</h2>
      <p className="max-w-md text-ink-2">Tell us the plot size, the floors and your budget. You'll see it in 3D and track every rupee against your own number.</p>
      {/* Button that links to the wizard, with a "+" icon. */}
      <Button variant="primary" icon={Plus} to="/projects/new">
        add a house
      </Button>
      {/* Hint for invited people, with a link icon. */}
      <p className="mt-2 flex items-start gap-2 text-meta text-ink-3">
        <Link2 size={16} className="mt-0.5 shrink-0" aria-hidden />
        Contractor or family member? Open the invitation link the owner sent you to join their project.
      </p>
    </div>
  )
}
