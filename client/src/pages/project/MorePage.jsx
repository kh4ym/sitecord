// =============================================================================
// MorePage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/more  (mainly used on phones, where the bottom tab bar only has
// room for a few tabs).
//
// What it shows: every project section that isn't already a tab for this role
// (with unread/waiting badges), the inspector's "shared with you" status, the
// latest notifications (phones only), a language switch (English / Urdu), a
// link to account settings, a link back to the projects list, and sign out.
//
// Who can see it: every project member. The "Shared with you" block only
// appears for inspectors on projects with inspections turned on.
//
// Data it loads: the project, the role's navigation list and feature flags come
// from ProjectContext; the projects list (for badge counts and the number of
// houses) comes from the useProjects query; the signed-in user comes from
// useSignOut.
//
// Depends on: lucide-react icons, the access/notification components, the UI
// kit, i18n, PageTitle, ProjectContext and the query hooks.
// =============================================================================

// Named imports of three icon components from lucide-react.
import { Layers, Lock, LogOut } from 'lucide-react'
// AccessRows lists what the owner has shared with an inspector.
import { AccessRows } from '../../components/access/AccessLocked.jsx'
// Page is the shared page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit pieces: avatar circle, icon tile, list card/row, section heading and a segmented (two-option) control.
import { Avatar, IconTile, ListCard, ListRow, SectionHead, Segmented } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// The notifications list component.
import { NotificationList } from '../../components/Notifications.jsx'
// Page heading block.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Reads the current project, navigation and features from the project layout.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// TanStack Query hook that fetches all of the user's projects.
import { useProjects } from '../../lib/queries.js'
// Hook giving the signed-in user (`me`) and a signOut function.
import { useSignOut } from '../../lib/useSignOut.js'

/** On phones: everything that isn't a tab, plus notifications, language and the account. */
// The page component, exported as the file's default export.
export default function MorePage() {
  // Object destructuring: pull project, nav (navigation lists for this role) and features out of the context.
  const { project, nav, features } = useProjectContext()
  // t translates keys; locale is the current language; setLocale changes it.
  const { t, locale, setLocale } = useI18n()
  // The current user and the sign-out function.
  const { me, signOut } = useSignOut()
  // Destructuring with rename: `data: projects` takes the `data` property and stores it in a variable called `projects`.
  const { data: projects } = useProjects()
  // Optional chaining `?.` (projects may still be loading); .find returns the first item where the arrow function returns true.
  const summary = projects?.find((p) => p.id === project.id)
  // Boolean: is the current user this project's inspector?
  const inspector = project.role === 'INSPECTOR'

  // The JSX the page renders.
  return (
    // Narrow page width suits a simple list.
    <Page width="narrow">
      {/* Title "More" with the project's name and city above it; the kicker is a template literal. */}
      <PageTitle title={t('nav.more')} kicker={`${project.name}, ${project.city}`} />
      {/* Vertical stack of sections with big gaps. */}
      <div className="flex flex-col gap-8">
        {/* `a && b && <X/>`: only renders for inspectors when inspections are on. */}
        {inspector && features.inspections && (
          // data-reveal opts this section into the scroll-reveal animation.
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title="Shared with you" />
            {/* A card containing the access rows as its children. */}
            <ListCard>
              <AccessRows />
            </ListCard>
            {/* Small grey explanatory text. */}
            <p className="px-1 text-meta text-ink-3">The owner decides what to share and for how long. Money is never shown to inspectors.</p>
          </section>
        )}

        {/* Only show the Project section if there are extra destinations. */}
        {nav.more.length > 0 && (
          <section data-reveal className="flex flex-col gap-3">
            <SectionHead title="Project" />
            <ListCard>
              {/* .map with a block body `{ ... }`: it needs an explicit `return` because it does work first. */}
              {nav.more.map((d) => {
                // If the destination has a badge key, look up that count on the summary (`summary?.[key]` is optional chaining with brackets); otherwise 0.
                const badge = d.badge ? summary?.[d.badge] : 0
                return (
                  <ListRow
                    // Unique key for React's list tracking.
                    key={d.key}
                    // Link target, e.g. /p/12/budget.
                    to={`/p/${project.id}/${d.to}`}
                    // Leading icon: a lock if the section is locked for this user, otherwise its own icon.
                    leading={<IconTile icon={d.locked ? Lock : d.icon} size="sm" />}
                    // Translated label.
                    title={t(d.label)}
                    // Explain locked sections; undefined shows no subtitle.
                    subtitle={d.locked ? 'Shared on request' : undefined}
                    // A round accent-coloured count bubble when the badge is above zero, else nothing (null).
                    trailing={badge > 0 ? <span className="num grid h-6 min-w-6 place-items-center rounded-full bg-accent-600 px-1.5 text-2xs font-bold text-white">{badge}</span> : null}
                    // Boolean prop shorthand: same as chevron={true}; shows a ">" arrow.
                    chevron
                  />
                )
              })}
            </ListCard>
          </section>
        )}

        {/* Latest notifications; `lg:hidden` hides this on large screens, which show notifications elsewhere. */}
        <section data-reveal className="card overflow-hidden lg:hidden">
          {/* Number prop in braces: show at most 6. */}
          <NotificationList limit={6} />
        </section>

        {/* The "You" section: account, projects, language, sign out. */}
        <section data-reveal className="flex flex-col gap-3">
          <SectionHead title="You" />
          <ListCard>
            {/* Account row only once `me` has loaded; links to /settings with an avatar, name and email. */}
            {me && <ListRow to="/settings" leading={<Avatar name={me.name} size={36} />} title={me.name} subtitle={me.email} chevron />}
            {/* Link back to all projects; subtitle shows "N houses" only if there is more than one. */}
            <ListRow to="/" leading={<IconTile icon={Layers} size="sm" />} title={t('nav.projects')} subtitle={projects?.length > 1 ? `${projects.length} houses` : undefined} chevron />
            {/* A hand-built list item (li) for the language switch, laid out as label on the left and control on the right. */}
            <li className="flex min-h-16 items-center justify-between gap-3 px-4 py-3">
              {/* Visible label "Language". */}
              <span className="text-body font-semibold">{t('common.language')}</span>
              {/* Two-option switch for the language. */}
              <Segmented
                // Small size.
                size="sm"
                // Accessible label.
                label={t('common.language')}
                // Controlled value: the current locale...
                value={locale}
                // ...changing it calls setLocale with 'en' or 'ur'.
                onChange={setLocale}
                // Array literal of option objects.
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ur', label: 'اردو' },
                ]}
              />
            </li>
            {/* Sign-out row: an onClick instead of a link, with a red ("danger") icon. */}
            <ListRow onClick={signOut} leading={<IconTile icon={LogOut} size="sm" tone="danger" />} title={t('common.signOut')} />
          </ListCard>
        </section>
        {/* Small centred footer line. */}
        <p className="px-1 text-center text-2xs font-semibold text-ink-4">SiteCord · Your house, on the record</p>
      </div>
    </Page>
  )
}
