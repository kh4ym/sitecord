// FILE: client/src/layout/AppShell.jsx
//
// What it does: the chrome (frame) around every signed-in page: the desktop
// sidebar (logo, notifications, navigation, language switch, user menu), the
// floating phone tab bar inside projects, the offline banner and a "skip to
// content" link for keyboard users.
//
// Where it's used: App.jsx (Shell, outside a project) and ProjectLayout
// (with the `inProject` prop).
//
// Data: the project navigation it draws comes from layout/nav.js via
// ProjectContext; badges come from the projects list, notifications and the
// outbox.
//
// Depends on: react (useRef), react-router (links and navigation hooks),
// lucide-react icons, shared components (logo, notifications, offline banner,
// UI kit), i18n, lib/format.js (cn), lib/motion.js (sliding pill), the outbox
// counts, lib/queries.js, lib/useSignOut.js, nav.js and ProjectContext.

// useRef gives a persistent box `{ current }`; when passed as `ref` to JSX, React puts the DOM node in it.
import { useRef } from 'react'
// Link = in-app link; NavLink = a Link that knows if it's active; useLocation = current URL;
// useNavigate = change page from code.
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
// Icon components.
import { Check, ChevronsUpDown, FolderPlus, Layers, Lock, LogOut, MoreHorizontal, UserRound } from 'lucide-react'
// The SiteCord logo text.
import { Wordmark } from '../components/Logo.jsx'
// The bell icon with a dropdown list.
import { NotificationsMenu } from '../components/Notifications.jsx'
// The "you're offline" strip.
import { OfflineBanner } from '../components/OfflineBanner.jsx'
// UI kit components: avatar circle, dropdown menu parts, role label, segmented switch.
import { Avatar, Menu, MenuItem, MenuLabel, MenuSeparator, RoleTag, Segmented } from '../components/ui/index.js'
// Translation hook.
import { useI18n } from '../i18n/I18nProvider.jsx'
// Class-name joiner.
import { cn } from '../lib/format.js'
// Animated highlight that slides to the active item.
import { useSlidingPill } from '../lib/motion.js'
// Pending / failed counts from the offline outbox.
import { useOutboxCounts } from '../lib/outbox/useOutbox.js'
// Data hooks.
import { useNotifications, useProjects } from '../lib/queries.js'
// Sign-out action with the outbox warning.
import { useSignOut } from '../lib/useSignOut.js'
// Is a destination the current page?
import { isActive } from './nav.js'
// Reads the current project's context.
import { useProjectContext } from './ProjectContext.jsx'

/**
 * Page frame: a slim sidebar on desktop; on phones a floating tab bar inside
 * projects, and nothing else (pages carry their own headers).
 */
// Exported function component. Props: `inProject` (boolean) and `children` (the page).
export function AppShell({ inProject, children }) {
  // Translation function `t(key)`.
  const { t } = useI18n()
  // JSX to render.
  return (
    // Full dynamic-viewport height wrapper.
    <div className="min-h-dvh">
      {/* Skip link: visually hidden (sr-only) until focused with Tab, then pinned top-start as a white pill. */}
      <a href="#main" className="sr-only z-50 rounded-full bg-white px-4 py-2 shadow-float focus:not-sr-only focus:fixed focus:start-3 focus:top-3">
        {/* `{t('shell.skip')}` inserts the translated text. */}
        {t('shell.skip')}
      </a>
      {/* Sidebar: fixed to the start edge, 256px wide, hidden on phones and shown as flex from the lg breakpoint. */}
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-[256px] flex-col border-e border-line bg-canvas lg:flex" aria-label={t('shell.sidebar')}>
        {/* Pass the prop down to the Sidebar component. */}
        <Sidebar inProject={inProject} />
      </aside>
      {/* On desktop, pad the content by the sidebar's width (ps = padding-start). */}
      <div className="lg:ps-[256px]">
        {/* Main content: centred, max 1100px, responsive padding; extra bottom padding when the tab bar shows (ternary inside cn). */}
        <main id="main" className={cn('mx-auto w-full max-w-[1100px] px-4 pt-5 sm:px-6 lg:px-10 lg:pt-9', inProject ? 'pb-tabbar lg:pb-16' : 'pb-16')}>
          {/* Shows only while offline. */}
          <OfflineBanner />
          {/* The page itself. */}
          {children}
        </main>
      </div>
      {/* Phone tab bar only inside a project (`&&` conditional rendering). */}
      {inProject && <TabBar />}
    </div>
  )
}

// ---------------------------------------------------------------- Sidebar

// Not exported: only used in this file.
function Sidebar({ inProject }) {
  // Translation plus the current language and its setter.
  const { t, locale, setLocale } = useI18n()
  return (
    // Full-height column.
    <div className="flex h-full min-h-0 flex-col">
      {/* Top row: logo on one side, notifications bell on the other. */}
      <div className="flex h-20 shrink-0 items-center justify-between ps-6 pe-4">
        {/* Logo links home; the aria-label template literal gives screen readers a full name. */}
        <Link to="/" className="rounded-md" aria-label={`SiteCord, ${t('shell.allHouses')}`}>
          <Wordmark />
        </Link>
        <NotificationsMenu />
      </div>
      {/* Ternary in JSX: project navigation inside a project, otherwise the home navigation. */}
      {inProject ? <ProjectNav /> : <HomeNav />}
      {/* Footer pinned to the bottom (mt-auto) with a top border: language switch and user menu. */}
      <div className="mt-auto flex shrink-0 flex-col gap-3 border-t border-line p-4">
        {/* Row: "Language" label and the switch. */}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-meta text-ink-3">{t('common.language')}</span>
          {/* A two-option segmented control. */}
          <Segmented
            // Small size.
            size="sm"
            // Accessible name for the group.
            label={t('common.language')}
            // Currently selected value ('en' or 'ur').
            value={locale}
            // Called with the new value when the user picks one.
            onChange={setLocale}
            // The options, as an array of objects inside a JSX expression.
            options={[
              { value: 'en', label: 'English' },
              { value: 'ur', label: 'اردو' },
            ]}
          />
        </div>
        {/* Avatar button with account and sign-out options. */}
        <UserMenu />
      </div>
    </div>
  )
}

// Navigation outside any project: the project list and the account page.
function HomeNav() {
  const { t } = useI18n()
  return (
    // <nav> landmark with an accessible label.
    <nav aria-label="Main" className="px-4 pt-2">
      {/* `end` (boolean prop) = active only on exactly "/"; `icon={Layers}` passes the component. */}
      <SideLink to="/" end icon={Layers}>
        {t('nav.projects')}
      </SideLink>
      {/* Account settings link. */}
      <SideLink to="/settings" icon={UserRound}>
        {t('nav.account')}
      </SideLink>
    </nav>
  )
}

// Sidebar navigation inside a project.
function ProjectNav() {
  const { t } = useI18n()
  // The project and its computed nav (tabs + more).
  const { project, nav } = useProjectContext()
  // Current path.
  const { pathname } = useLocation()
  // All projects (for badge counts and the switcher), renamed to `projects`.
  const { data: projects } = useProjects()
  // This project's summary row; `?.` because projects may still be loading.
  const summary = projects?.find((p) => p.id === project.id)
  // Outbox counts for this project.
  const outbox = useOutboxCounts(project.id)
  // Refs for the scrolling list and the highlight pill DOM nodes.
  const list = useRef(null)
  const pill = useRef(null)
  // The sidebar shows tabs and "more" as one scrolling list, so one pill
  // slides between both groups. The today badge is the outbox count.
  // Merge both arrays with spread, find the active one, take its key (or undefined).
  const active = [...nav.tabs, ...nav.more].find((d) => isActive(d, pathname))?.key
  // Animate the pill to the active item whenever `active` changes.
  useSlidingPill(list, pill, active)
  // A render helper: arrow function returning JSX for one destination `d`.
  const link = (d) => (
    <SideItem
      // `key` is React's identity for items in a list (must be unique among siblings).
      key={d.key}
      // The destination object.
      d={d}
      // Boolean: is this the active item?
      active={d.key === active}
      // Link target; adds "/<to>" only when `to` isn't empty.
      to={`/p/${project.id}${d.to ? `/${d.to}` : ''}`}
      // Badge count: the named summary count, or the outbox count for Today, else 0 (nested ternary).
      badge={d.badge ? summary?.[d.badge] : d.key === 'today' ? outbox.pending : 0}
    >
      {/* Translated label as children. */}
      {t(d.label)}
    </SideItem>
  )
  return (
    // `<>...</>` is a Fragment: groups siblings without adding a DOM element.
    <>
      {/* Dropdown to switch project; `projects ?? []` passes an empty list while loading. */}
      <ProjectSwitcher project={project} projects={projects ?? []} />
      {/* `ref={list}` stores this <nav> DOM node in list.current. Styled as a scrolling flexible column; `relative` anchors the pill. */}
      <nav aria-label="Project" ref={list} className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {/* The sliding pill: absolute at top-left, invisible until placed, white rounded with a shadow; ignores clicks. */}
        <span ref={pill} className="pointer-events-none absolute left-0 top-0 rounded-full bg-white opacity-0 shadow-card ring-1 ring-line" aria-hidden />
        {/* List rendering: `.map(link)` calls link(d) for each tab and renders the resulting array. */}
        <ul className="relative flex flex-col gap-0.5">{nav.tabs.map(link)}</ul>
        {/* Only show the "more" group if it has items. */}
        {nav.more.length > 0 && (
          <>
            {/* Small group heading. */}
            <p className="head mt-6 mb-2 px-3 text-ink-3">{t('nav.more')}</p>
            <ul className="relative flex flex-col gap-0.5">{nav.more.map(link)}</ul>
          </>
        )}
      </nav>
    </>
  )
}

// One sidebar row in a project.
function SideItem({ d, to, active, badge, children }) {
  // Pick which icon component to render; capitalised name so JSX treats it as a component.
  const Icon = d.locked ? Lock : d.icon
  return (
    <li>
      <Link
        // Destination path.
        to={to}
        // data-active is what useSlidingPill looks for.
        data-active={active}
        // Tells screen readers this is the current page; `undefined` omits the attribute.
        aria-current={active ? 'page' : undefined}
        // 44px-tall rounded row with icon + text; bold dark when active, lighter with hover darkening otherwise.
        className={cn('relative z-[1] flex h-11 items-center gap-3 rounded-full px-3.5 text-body transition-colors', active ? 'font-bold text-ink' : 'font-semibold text-ink-2 hover:text-ink')}
      >
        {/* The icon; darker and slightly thicker strokes when active. */}
        <Icon size={19} className={cn('shrink-0', active ? 'text-ink' : 'text-ink-3')} aria-hidden strokeWidth={active ? 2.2 : 1.9} />
        {/* Label: fills the row, truncates with "…", lower-cased with a capital first letter. */}
        <span className="min-w-0 flex-1 truncate lowercase first-letter:uppercase">{children}</span>
        {/* Count badge (blue circle with white number) when above zero. */}
        {badge > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-accent-600 px-1.5 text-2xs font-bold text-white">{badge}</span>}
      </Link>
    </li>
  )
}

// A sidebar link outside a project. `icon: Icon` renames the prop to a capitalised variable.
function SideLink({ to, end, icon: Icon, children }) {
  return (
    <NavLink
      to={to}
      // Match the path exactly when true.
      end={end}
      // NavLink accepts a function for className; it receives { isActive }, renamed here to `on`.
      // Active: white pill with shadow and bold text; inactive: lighter text.
      className={({ isActive: on }) =>
        cn('flex h-11 items-center gap-3 rounded-full px-3.5 text-body transition', on ? 'bg-white font-bold text-ink shadow-card ring-1 ring-line' : 'font-semibold text-ink-2 hover:text-ink')
      }
    >
      <Icon size={19} className="shrink-0 text-ink-3" aria-hidden />
      {children}
    </NavLink>
  )
}

// Dropdown at the top of the project sidebar to jump to another project.
function ProjectSwitcher({ project, projects }) {
  const { t } = useI18n()
  // Function to change page.
  const navigate = useNavigate()
  return (
    <div className="px-4">
      <Menu
        // Align the dropdown to the start edge of the trigger.
        align="start"
        // Fixed menu width.
        className="w-[224px]"
        // The button that opens the menu, passed as a JSX prop.
        trigger={
          // Full-width white bordered tile showing the current project.
          <button className="flex w-full items-center gap-3 rounded-tile border border-line bg-white px-3.5 py-3 text-start transition hover:border-line-strong">
            {/* Text column. */}
            <span className="min-w-0 flex-1">
              {/* Project name, bold, truncated. */}
              <span className="block truncate text-body font-bold text-ink">{project.name}</span>
              {/* Second line: city and (for non-owners) the role tag. */}
              <span className="mt-1 flex items-center gap-1.5 text-meta text-ink-3">
                <span className="truncate">{project.city}</span>
                {project.role !== 'OWNER' && <RoleTag role={project.role} />}
              </span>
            </span>
            {/* Up/down chevrons hint that this opens a menu. */}
            <ChevronsUpDown size={16} className="shrink-0 text-ink-3" aria-hidden />
          </button>
        }
      >
        {/* Menu heading. */}
        <MenuLabel>{t('shell.yourHouses')}</MenuLabel>
        {/* One item per project; `(p) => ( … )` returns JSX; `key` identifies each. onSelect is an arrow so navigate runs only on click. */}
        {projects.map((p) => (
          <MenuItem key={p.id} onSelect={() => navigate(`/p/${p.id}`)} description={`${p.city} · ${t('shell.built', { n: p.overall })}`}>
            <span className="flex items-center gap-2">
              {p.name}
              {/* A tick next to the current project. */}
              {p.id === project.id && <Check size={14} className="text-accent-600" aria-label={t('shell.current')} />}
            </span>
          </MenuItem>
        ))}
        {/* Divider line. */}
        <MenuSeparator />
        {/* Go to the project list. */}
        <MenuItem icon={Layers} onSelect={() => navigate('/')}>
          {t('shell.allHouses')}
        </MenuItem>
        {/* Start a new project. */}
        <MenuItem icon={FolderPlus} onSelect={() => navigate('/projects/new')}>
          {t('shell.addHouse')}
        </MenuItem>
      </Menu>
    </div>
  )
}

// The avatar button at the bottom of the sidebar.
function UserMenu() {
  const { t } = useI18n()
  const navigate = useNavigate()
  // Current user and the sign-out action.
  const { me, signOut } = useSignOut()
  // Returning null renders nothing (e.g. before the user has loaded).
  if (!me) return null
  return (
    <Menu
      align="start"
      // Open upwards, since the button is at the bottom of the screen.
      side="top"
      trigger={
        // Full-width round button that turns white on hover.
        <button className="flex w-full items-center gap-3 rounded-full px-1.5 py-1.5 text-start transition hover:bg-white">
          {/* Initials circle. */}
          <Avatar name={me.name} size={36} />
          {/* Name and email, each truncated. */}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-meta font-bold">{me.name}</span>
            <span className="block truncate text-2xs text-ink-3">{me.email}</span>
          </span>
          <ChevronsUpDown size={16} className="shrink-0 text-ink-3" aria-hidden />
        </button>
      }
    >
      {/* Account page. */}
      <MenuItem icon={UserRound} onSelect={() => navigate('/settings')}>
        {t('nav.account')}
      </MenuItem>
      {/* Project list. */}
      <MenuItem icon={Layers} onSelect={() => navigate('/')}>
        {t('shell.allHouses')}
      </MenuItem>
      <MenuSeparator />
      {/* Sign out: the function reference is passed directly as the handler. */}
      <MenuItem icon={LogOut} onSelect={signOut}>
        {t('common.signOut')}
      </MenuItem>
    </Menu>
  )
}

// ---------------------------------------------------------------- Tab bar

/** Floating tab bar on phones: the role's main tabs plus "more". */
function TabBar() {
  const { t } = useI18n()
  // Project and nav from context.
  const { project, nav } = useProjectContext()
  // Current path.
  const { pathname } = useLocation()
  // Projects list (for badge counts).
  const { data: projects } = useProjects()
  // Notifications (for the unread dot on "more"), renamed to `notes`.
  const { data: notes } = useNotifications()
  // Outbox counts.
  const outbox = useOutboxCounts(project.id)
  // This project's summary.
  const summary = projects?.find((p) => p.id === project.id)
  // Refs for the <ul> and the pill.
  const bar = useRef(null)
  const pill = useRef(null)
  // Any project page that isn't one of the tabs lights up "more", since that's
  // where it was reached from.
  // True if the section is literally "more", or if no tab matches (`.some` = any match)
  // and there is a section at all (`!= null` excludes undefined).
  const onMore = pathname.split('/')[3] === 'more' || (!nav.tabs.some((d) => isActive(d, pathname)) && pathname.split('/')[3] != null)
  // Key of the active tab.
  const active = onMore ? 'more' : nav.tabs.find((d) => isActive(d, pathname))?.key
  // Slide the pill to it.
  useSlidingPill(bar, pill, active)
  // Base URL for this project.
  const base = `/p/${project.id}`
  // The role's tabs plus a fixed "more" tab at the end.
  const items = [...nav.tabs, { key: 'more', to: 'more', label: 'nav.more', icon: MoreHorizontal }]
  return (
    // Fixed near the bottom (above the iPhone home indicator via env(safe-area-inset-bottom)); hidden on desktop (lg:hidden).
    <nav aria-label={t('shell.tabs')} className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 lg:hidden">
      {/* The floating bar: rounded, translucent white with blur and shadow; tabs spread across a row. */}
      <ul ref={bar} className="relative mx-auto flex max-w-md items-stretch justify-between rounded-bar border border-line/70 bg-white/95 p-1.5 shadow-float backdrop-blur-md">
        {/* The sliding grey highlight behind the active tab. */}
        <span ref={pill} className="pointer-events-none absolute left-0 top-0 rounded-[1rem] bg-sunken opacity-0" aria-hidden />
        {/* `.map` with a block-bodied arrow: compute values, then `return` the JSX. */}
        {items.map((d) => {
          // Is this the active tab?
          const on = d.key === active
          // Lock icon for locked items, else the item's own icon.
          const Icon = d.locked ? Lock : d.icon
          // Badge: named summary count / outbox count for today / unread notifications for more / none.
          const badge = d.badge ? summary?.[d.badge] : d.key === 'today' ? outbox.pending : d.key === 'more' ? notes?.unread : 0
          return (
            // One equal-width cell; `key` for React's list tracking.
            <li key={d.key} className="relative z-[1] flex-1">
              <Link
                // Path for this tab (nested template literal).
                to={`${base}${d.to ? `/${d.to}` : ''}`}
                // Marker for the sliding pill.
                data-active={on}
                // Current-page hint for screen readers.
                aria-current={on ? 'page' : undefined}
                // 56px-tall column (icon over label), bold dark when active.
                className={cn('flex h-14 flex-col items-center justify-center gap-1 rounded-[1rem] text-2xs transition-colors', on ? 'font-bold text-ink' : 'font-semibold text-ink-3')}
              >
                {/* Wrapper so the badge can be positioned over the icon. */}
                <span className="relative">
                  <Icon size={21} aria-hidden strokeWidth={on ? 2.2 : 1.8} />
                  {/* Show a badge when there's a count; then choose dot vs number with a ternary. */}
                  {badge > 0 &&
                    (d.key === 'more' ? (
                      // Unread notifications: just a dot (the list is on the More page).
                      <span className="absolute -end-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent-600 ring-2 ring-white">
                        {/* Text only screen readers hear. */}
                        <span className="sr-only">{t('notifications.unread', { n: badge })}</span>
                      </span>
                    ) : (
                      // A number badge: red when an outbox item failed, otherwise blue.
                      <span
                        className={cn(
                          'absolute -end-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white',
                          d.key === 'today' && outbox.failed ? 'bg-danger-500' : 'bg-accent-600',
                        )}
                      >
                        {/* Cap the display at "9+". */}
                        {badge > 9 ? '9+' : badge}
                      </span>
                    ))}
                </span>
                {/* Tab label, truncated, lower-case. */}
                <span className="max-w-full truncate px-1 lowercase">{t(d.label)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
