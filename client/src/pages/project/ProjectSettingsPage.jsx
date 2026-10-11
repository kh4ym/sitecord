// /p/:id/settings (owner). Details and budget, site pin, people and invitations,
// what inspectors have been granted, and archiving the project.
//
// FILE OVERVIEW
// What it does: the project owner's settings screen. It is split into small
//   section components, each rendered one under the other:
//     - Details  : edit name, area, city, budget, start date and target finish.
//     - SitePin  : drop or clear the map pin for the building site (photos are
//                  checked against this pin).
//     - People   : list of project members, with a "remove" button for each
//                  non-owner.
//     - Shares   : which inspectors currently have (or are asking for) access,
//                  with a "stop sharing" button. Only shown when the project has
//                  the "inspections" feature turned on.
//     - Invite   : create a one-time invite link for a new member and see/cancel
//                  invitations that are still waiting.
//     - Danger   : archive the whole project.
// Route: /p/:id/settings (the :id part of the URL is the project id). Links such
//   as /p/:id/settings#budget or #site scroll straight to that section.
// Who can see it: the project OWNER (the router/layout only offers it to them).
// Data it loads: the current project comes from useProjectContext() (already
//   loaded by the project layout). It additionally loads access requests and
//   pending invitations, and uses mutation hooks (update project, set/clear pin,
//   remove member, revoke access, invite, revoke invite, archive) from
//   lib/queries.js, which wrap TanStack Query.
// Depends on: React (hooks), React Router (useLocation, useNavigate), sonner
//   (toast pop-up messages), lucide-react (icons), shared permission and house
//   config constants, the UI kit in components/ui, i18n (translations), the
//   project context, date formatting helpers and the SitePinField map component.

// ES module import: pulls three named exports (React "hooks") out of the 'react' package.
import { useEffect, useRef, useState } from 'react'
// Named imports from React Router: useLocation reads the current URL, useNavigate lets code change pages.
import { useLocation, useNavigate } from 'react-router'
// `toast` shows small pop-up notifications (from the sonner library).
import { toast } from 'sonner'
// Icon components (each is a React component that draws an SVG icon).
import { Archive, Copy, Link2, Mail, Trash2 } from 'lucide-react'
// Shared constants (the '@shared' alias points at the shared folder used by client and server): labels for access scopes and roles.
import { ACCESS_SCOPES, ROLE_DESCRIPTIONS, ROLE_LABELS } from '@shared/permissions.js'
// City list, contract type info, and plotLabel(project) which builds a short "plot" label for a project.
import { CITIES, CONTRACT_TYPES, plotLabel } from '@shared/houseConfig.js'
// Page is the layout wrapper that gives every page consistent width and padding.
import { Page } from '../../components/Page.jsx'
// Many small reusable UI components, imported from the UI kit's index file in one line.
import { Avatar, Button, ConfirmDialog, Field, IconButton, Input, ListCard, ListRow, MoneyInput, Notice, RoleTag, SectionHead, Segmented, Select, StatusChip } from '../../components/ui/index.js'
// useI18n gives access to translations (t('key') returns the text in the user's language).
import { useI18n } from '../../i18n/I18nProvider.jsx'
// PageTitle renders the big heading at the top of the page.
import { PageTitle } from '../../layout/PageHeader.jsx'
// useProjectContext reads the current project (and the signed-in user, feature flags...) provided by the project layout.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Date helpers: formatDate gives "3 Oct 2026"-style text, timeAgo gives "2 hours ago"-style text.
import { formatDate, timeAgo } from '../../lib/format.js'
// Multi-line named import: custom hooks (each wraps a TanStack Query query or mutation that talks to the API).
import {
  // Loads the inspectors' access requests for this project.
  useAccessRequests,
  // Mutation that archives the project.
  useArchiveProject,
  // Mutation that removes the site pin.
  useClearSitePin,
  // Loads invitations that have not been accepted yet.
  useInvitations,
  // Mutation that creates a new invitation.
  useInvite,
  // Mutation that removes a member from the project.
  useRemoveMember,
  // Mutation that stops an inspector's access.
  useRevokeAccess,
  // Mutation that cancels a pending invitation.
  useRevokeInvite,
  // Mutation that saves the site pin.
  useSetSitePin,
  // Mutation that saves the project details.
  useUpdateProject,
} from '../../lib/queries.js'
// The map widget used to pick the site location.
import { SitePinField } from '../../components/SitePinField.jsx'

/** The owner's project settings: details and budget, site pin, people, inspector shares, archive. */
// `export default function` declares a React component (a function that returns JSX) and makes it this file's main export.
export default function ProjectSettingsPage() {
  // Object destructuring: take the `project` and `features` properties out of the object returned by the hook.
  const { project, features } = useProjectContext()
  // Destructure the translate function `t` from the i18n hook.
  const { t } = useI18n()
  // `hash` is the part of the URL after '#', e.g. '#budget' (empty string if there is none).
  const { hash } = useLocation()
  // Links like /settings#budget land on that section.
  // useEffect(callback, deps) runs the arrow function after React has drawn the page, and again whenever a value in the deps array changes.
  useEffect(() => {
    // Early return: if there is no hash, do nothing.
    if (!hash) return
    // hash.slice(1) drops the leading '#'; getElementById finds the element with that id on the page.
    const el = document.getElementById(hash.slice(1))
    // If no element has that id, stop.
    if (!el) return
    // Scroll the browser so the element is vertically centred.
    el.scrollIntoView({ block: 'center' })
    // Optional chaining `?.`: find the first <input> inside; only call focus() if one was found. preventScroll stops a second jump.
    el.querySelector('input')?.focus({ preventScroll: true })
    // Dependency array: re-run this effect only when `hash` changes.
  }, [hash])
  // A component returns JSX: HTML-like syntax that compiles to React elements. The parentheses let it span several lines.
  return (
    // Page wrapper; `width="narrow"` is a prop (an argument passed to a component, written like an HTML attribute).
    <Page width="narrow">
      {/* Page heading. Curly braces {} put a JavaScript expression inside JSX. The kicker uses a template literal (backticks) with ${...} placeholders; `?.` guards against an unknown contract type. */}
      <PageTitle title={t('nav.settings')} kicker={`${plotLabel(project)} · ${CONTRACT_TYPES[project.contractType]?.label.toLowerCase()}`} />
      {/* A vertical column (Tailwind flexbox classes) with a big gap between sections. `className` is JSX's name for the HTML class attribute. */}
      <div className="flex flex-col gap-9">
        {/* Each section is its own component defined further down in this file. Self-closing tags `<X />` have no children. */}
        <Details />
        <SitePin />
        <People />
        {/* Short-circuit `&&`: if features.inspections is truthy, render <Shares />; otherwise render nothing. */}
        {features.inspections && <Shares />}
        <Invite />
        <Danger />
      </div>
    </Page>
  )
}

// The "Details" form: name, area, city, budget and dates.
function Details() {
  // Get the current project from context.
  const { project } = useProjectContext()
  // Mutation hook: `update.mutate(data)` sends the changes to the server; it also exposes `isPending` and `error`.
  const update = useUpdateProject(project.id)
  // The starting form values. `??` (nullish coalescing) uses '' when the left side is null or undefined, so inputs never get null.
  const initial = { name: project.name, address: project.address ?? '', city: project.city, budgetPaisa: project.budgetPaisa, startDate: project.startDate ?? '', plannedEndDate: project.plannedEndDate ?? '' }
  // useState returns [currentValue, setterFunction]; array destructuring names them `form` and `setForm`.
  const [form, setForm] = useState(initial)
  // A "curried" arrow function: set('name') returns a new function (v) => ... that updates one field.
  // setForm((f) => ...) uses the previous state f; `{ ...f, [k]: value }` copies f (spread) and overwrites the key named by k (computed property name).
  // `v?.target ? v.target.value : v` is a ternary: if v is an input event, take the input's text, otherwise v is already the value.
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v?.target ? v.target.value : v }))
  // "Dirty" = something changed. Comparing JSON strings is a quick way to compare two plain objects by content.
  const dirty = JSON.stringify(form) !== JSON.stringify(initial)
  // Per-field errors from the server (e.g. { name: 'Required' }), or an empty object if there are none.
  const errors = update.error?.fieldErrors ?? {}
  return (
    // `data-reveal` is a marker attribute (used by the page's reveal animation); the classes stack children with a small gap.
    <section data-reveal className="flex flex-col gap-3">
      {/* Small section heading. */}
      <SectionHead title="Details" />
      {/* A real <form> so pressing Enter submits it. */}
      <form
        // Card look; a 2-column grid on screens wider than the `sm` breakpoint.
        className="card grid gap-4 p-5 sm:grid-cols-2"
        // Event handler prop: React calls this arrow function with the submit event `e`.
        onSubmit={(e) => {
          // Stop the browser's default behaviour (reloading the page on form submit).
          e.preventDefault()
          // Send the form. Spread copies all fields, then empty date strings are turned into null with `||` (use right side when left is falsy).
          // The second argument is an options object: onSuccess runs when the server confirms, here showing a "Saved" toast.
          update.mutate({ ...form, startDate: form.startDate || null, plannedEndDate: form.plannedEndDate || null }, { onSuccess: () => toast.success('Saved') })
        }}
      >
        {/* Field = label + error message wrapper. `error={errors.name}` shows the server's message for this field, if any. */}
        <Field label="Name" error={errors.name} className="sm:col-span-2">
          {/* Controlled input: its value comes from state, and onChange writes the new text back into state. */}
          <Input value={form.name} onChange={set('name')} />
        </Field>
        {/* Area / society text field. */}
        <Field label="Area or society" error={errors.address}>
          <Input value={form.address} onChange={set('address')} />
        </Field>
        {/* City drop-down. */}
        <Field label="City" error={errors.city}>
          {/* Controlled <select>. */}
          <Select value={form.city} onChange={set('city')}>
            {/* new Set([...]) removes duplicates; `[...set]` spreads it back into an array so we can .map() it. The current city is listed first in case it is not in CITIES. */}
            {/* .map turns each city string `c` into an <option>; React needs a unique `key` on each item in a list. */}
            {[...new Set([form.city, ...CITIES])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        {/* id="budget" makes /settings#budget scroll here; scroll-mt-24 leaves room above for the sticky header. */}
        <div id="budget" className="scroll-mt-24 sm:col-span-2">
          {/* Budget field with a hint line under it. */}
          <Field label="Your budget" error={errors.budgetPaisa} hint="Spending is tracked against this. Changing it is recorded in the history.">
            {/* MoneyInput gives a number (in paisa) or undefined; `v ?? 0` turns "empty" into 0. set('budgetPaisa') returns a function which is called immediately with that value. */}
            <MoneyInput value={form.budgetPaisa} onChange={(v) => set('budgetPaisa')(v ?? 0)} />
          </Field>
        </div>
        {/* Start date picker (the browser's built-in date input). */}
        <Field label="Start date">
          <Input type="date" value={form.startDate} onChange={set('startDate')} />
        </Field>
        {/* `optional` on its own is a boolean prop, the same as optional={true}. */}
        <Field label="Target finish" optional>
          <Input type="date" value={form.plannedEndDate} onChange={set('plannedEndDate')} />
        </Field>
        {/* Show a general error box only when there is an error AND it was not about a specific field. Object.keys(errors).length counts field errors; `!` flips 0 to true. */}
        {update.error && !Object.keys(errors).length && <Notice tone="error" className="sm:col-span-2">{update.error.message}</Notice>}
        {/* Save button row, spanning both grid columns. */}
        <div className="sm:col-span-2">
          {/* type="submit" triggers the form's onSubmit. Disabled until something changed; shows a spinner while the request is in flight. */}
          <Button type="submit" variant="primary" disabled={!dirty} loading={update.isPending}>
            save changes
          </Button>
        </div>
      </form>
    </section>
  )
}

// The "Site location" section: a map pin for where the house is being built.
function SitePin() {
  // Current project from context.
  const { project } = useProjectContext()
  // Mutation to save a pin.
  const setPin = useSetSitePin(project.id)
  // Mutation to remove the pin.
  const clearPin = useClearSitePin(project.id)
  // Ternary: if the project has a latitude (`!= null` is true for anything except null/undefined), build a { lat, lng } object, otherwise null.
  const pin = project.siteLat != null ? { lat: project.siteLat, lng: project.siteLng } : null
  return (
    // id="site" lets links like #site scroll here.
    <section id="site" data-reveal className="flex scroll-mt-24 flex-col gap-3">
      {/* `meta` shows "set <date>" when a pin exists; `undefined` means "no meta" (the prop is simply left out). */}
      <SectionHead title="Site location" meta={project.siteSetAt ? `set ${formatDate(project.siteSetAt)}` : undefined} />
      {/* The map component. Props are passed on separate lines below. */}
      <SitePinField
        // The current pin (or null).
        pin={pin}
        // Called with the new pin, or with nothing when the user clears it.
        onChange={(next) =>
          // Ternary used as a statement: if there is a new pin, save it...
          next
            // ...with mutate(variables, { onSuccess, onError }): success shows a toast, failure shows the error message.
            ? setPin.mutate(next, { onSuccess: () => toast.success('Site pinned. Photo distances were updated.'), onError: (err) => toast.error(err.message) })
            // ...otherwise remove it. `undefined` = this mutation needs no variables. toast(...) is a neutral (non-green) toast.
            : clearPin.mutate(undefined, { onSuccess: () => toast('Pin removed') })
        }
      />
      {/* Explanatory small grey text. */}
      <p className="px-1 text-meta text-ink-3">Photos are checked against this pin. A site visit can only be verified within 300 m of it.</p>
    </section>
  )
}

// The "People" section: everyone on the project, with a remove button.
function People() {
  // `me` is the signed-in user.
  const { project, me } = useProjectContext()
  // Mutation that removes a member.
  const remove = useRemoveMember(project.id)
  // The member we are asking "remove this person?" about; null means the dialog is closed.
  const [target, setTarget] = useState(null)
  return (
    <section data-reveal className="flex flex-col gap-3">
      {/* Template literal turns the member count (a number) into a string. */}
      <SectionHead title="People" meta={`${project.members.length}`} />
      {/* A card containing rows. */}
      <ListCard>
        {/* List rendering: .map turns each member `m` into a <ListRow>; the arrow uses ( ) to return JSX directly. */}
        {project.members.map((m) => (
          <ListRow
            // Unique key so React can track each row.
            key={m.id}
            // A JSX element can itself be passed as a prop value.
            leading={<Avatar name={m.name} size={40} />}
            // Name, plus ' (you)' when this row is the signed-in user. `me?.id` guards against me being missing.
            title={`${m.name}${m.id === me?.id ? ' (you)' : ''}`}
            // With an email: "email · joined <date>", otherwise just "joined <date>".
            subtitle={m.email ? `${m.email} · joined ${formatDate(m.joinedAt)}` : `joined ${formatDate(m.joinedAt)}`}
            // Right-hand side of the row.
            trailing={
              <span className="flex items-center gap-1.5">
                {/* Coloured role label. */}
                <RoleTag role={m.role} />
                {/* Owners cannot be removed, so the trash button only shows for other roles. onClick stores this member as the target, which opens the dialog. */}
                {m.role !== 'OWNER' && <IconButton icon={Trash2} size="sm" label={`Remove ${m.name}`} onClick={() => setTarget(m)} variant="ghost" />}
              </span>
            }
          />
        ))}
      </ListCard>
      {/* "Are you sure?" dialog. */}
      <ConfirmDialog
        // `!!target` converts the object/null into true/false: open when a target is set.
        open={!!target}
        // When the dialog asks to close (o === false), clear the target. `!o && ...` only runs the right side if o is false.
        onOpenChange={(o) => !o && setTarget(null)}
        // `target?.name`: safe even when target is null.
        title={`Remove ${target?.name}?`}
        description="They lose access straight away. Everything they submitted stays on the record."
        confirmLabel="remove"
        // Red "danger" styling.
        tone="danger"
        // Spinner while the request runs.
        loading={remove.isPending}
        // Error text if the request failed.
        error={remove.error?.message}
        // Comma operator inside ( ): runs the toast, then setTarget(null) (closes the dialog), all as one expression.
        onConfirm={() => remove.mutate(target.id, { onSuccess: () => (toast.success(`${target.name} removed`), setTarget(null)) })}
      />
    </section>
  )
}

/** What the owner is sharing with inspectors right now, with a way to stop. */
function Shares() {
  // Current project.
  const { project } = useProjectContext()
  // Query hook: requests.data is the list once loaded (undefined while loading).
  const requests = useAccessRequests(project.id)
  // Mutation to stop an inspector's access.
  const revoke = useRevokeAccess(project.id)
  // The share being confirmed in the dialog (null = closed).
  const [target, setTarget] = useState(null)
  // `?? []` gives an empty array while loading; .filter keeps only shares that are live or still waiting for an answer.
  const active = (requests.data ?? []).filter((r) => r.state === 'ACTIVE' || r.state === 'PENDING')
  // Returning null from a component renders nothing: hide the section when there are no shares.
  if (!active.length) return null
  return (
    <section data-reveal className="flex flex-col gap-3">
      {/* .some() is true if at least one item matches. When there are pending requests, the heading gets a link to the approvals page; otherwise no action (undefined). */}
      <SectionHead title="Shared with inspectors" action={active.some((r) => r.state === 'PENDING') ? { to: `/p/${project.id}/approvals?filter=access`, label: 'answer requests' } : undefined} />
      <ListCard>
        {/* One row per share. */}
        {active.map((r) => (
          <ListRow
            // Unique key.
            key={r.id}
            // e.g. "Full record · Ali". `?.label` guards against an unknown scope.
            title={`${ACCESS_SCOPES[r.scope]?.label} · ${r.userName}`}
            // Active shares show their end date; pending ones show how long ago they were asked.
            subtitle={r.state === 'ACTIVE' ? `Until ${formatDate(r.expiresAt)}` : `Asked ${timeAgo(r.requestedAt)}`}
            // Ternary returning JSX: a "stop sharing" button for active shares, a "pending" chip otherwise.
            trailing={
              r.state === 'ACTIVE' ? (
                // type="button" stops it acting as a form submit button; clicking opens the confirm dialog for this share.
                <button type="button" onClick={() => setTarget(r)} className="text-meta font-semibold text-danger-700 hover:underline">
                  stop sharing
                </button>
              ) : (
                // Status pill showing "pending".
                <StatusChip kind="access" status="PENDING" />
              )
            }
          />
        ))}
      </ListCard>
      {/* Confirmation before stopping a share. */}
      <ConfirmDialog
        // Open while a target is chosen.
        open={!!target}
        // Clear the target when the dialog closes.
        onOpenChange={(o) => !o && setTarget(null)}
        // Chained optional access: target?.scope may be undefined, then ?.label guards the lookup.
        title={`Stop sharing the ${ACCESS_SCOPES[target?.scope]?.label.toLowerCase()}?`}
        description={`${target?.userName} won't see it any more. They can ask again.`}
        confirmLabel="stop sharing"
        tone="danger"
        loading={revoke.isPending}
        error={revoke.error?.message}
        // On success: toast, then close the dialog (comma operator runs both).
        onConfirm={() => revoke.mutate(target.id, { onSuccess: () => (toast.success('Sharing stopped'), setTarget(null)) })}
      />
    </section>
  )
}

// The "Invite someone" section: make a one-time invite link, and list invitations still waiting.
function Invite() {
  // Project and its feature flags.
  const { project, features } = useProjectContext()
  // Which roles the owner may invite; falls back to a default list when the feature flags do not say.
  const roles = features.inviteRoles ?? ['CONTRACTOR', 'SUPERVISOR', 'LOCAL_REP', 'INSPECTOR']
  // Query: invitations not yet accepted.
  const invitations = useInvitations(project.id)
  // Mutation: create an invitation.
  const invite = useInvite(project.id)
  // Mutation: cancel an invitation.
  const revoke = useRevokeInvite(project.id)
  // Form state: the email typed so far and the chosen role (the first allowed role by default).
  const [form, setForm] = useState({ email: '', role: roles[0] })
  // The link just created ({ url, email, role }) or null before one is made.
  const [link, setLink] = useState(null)
  // useRef creates a box ({ current }) that survives re-renders; here it will point at the link <input> element.
  const linkRef = useRef(null)
  // Field errors from the server, or {}.
  const errors = invite.error?.fieldErrors ?? {}
  // Copy the link to the clipboard. writeText returns a Promise; .then runs the toast once the copy has worked.
  const copy = () => navigator.clipboard.writeText(link.url).then(() => toast.success('Link copied'))
  return (
    <section data-reveal className="flex flex-col gap-3">
      <SectionHead title="Invite someone" />
      <form
        // Card with stacked fields.
        className="card flex flex-col gap-4 p-5"
        // Submit handler.
        onSubmit={(e) => {
          // No page reload.
          e.preventDefault()
          // Send the form; the options object handles success.
          invite.mutate(form, {
            // Destructuring in the parameter list: the server response is an object, we only need its `token`.
            onSuccess: ({ token }) => {
              // Build the full invite URL from the site's own origin (e.g. https://example.com) and remember who it is for.
              setLink({ url: `${window.location.origin}/invite/${token}`, email: form.email, role: form.role })
              // Clear the email box but keep the chosen role.
              setForm({ email: '', role: form.role })
              // After 50 ms (so the input has been drawn), select its text so it is easy to copy. `?.` in case it is not there.
              setTimeout(() => linkRef.current?.select(), 50)
            },
          })
        }}
      >
        {/* Only offer a role picker if there is more than one role to choose from. `&& (...)` renders the bracketed JSX when true. */}
        {roles.length > 1 && (
          // `group` marks the field as a group of controls rather than a single input.
          <Field label="As" group>
            {/* Segmented control (row of toggle buttons). `{ ...form, role }` is shorthand for { ...form, role: role }. options maps each role to { value, label }. */}
            <Segmented label="Role" size="sm" value={form.role} onChange={(role) => setForm({ ...form, role })} options={roles.map((r) => ({ value: r, label: ROLE_LABELS[r].toLowerCase() }))} />
          </Field>
        )}
        {/* One-line description of what the chosen role can do. */}
        <p className="-mt-2 text-meta text-ink-3">{ROLE_DESCRIPTIONS[form.role]}</p>
        {/* Email error: the field error if there is one, otherwise (??) the general error message when the request failed for another reason. */}
        <Field label="Their email" error={errors.email ?? (invite.error && !errors.email && invite.error.message)}>
          {/* Controlled email input; the handler copies the form and replaces just `email`. */}
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
        </Field>
        {/* Submit button; disabled while the email box is empty. `self-start` stops it stretching full width. */}
        <Button type="submit" variant="primary" icon={Link2} loading={invite.isPending} disabled={!form.email} className="self-start">
          create invite link
        </Button>
        {/* After a link has been created, show it in a highlighted box. */}
        {link && (
          <div className="rounded-tile bg-accent-50 p-4">
            {/* Who the link is for, with the role in brackets. */}
            <p className="text-body font-semibold">
              For {link.email} ({ROLE_LABELS[link.role].toLowerCase()})
            </p>
            {/* Instructions. */}
            <p className="mt-0.5 text-meta text-ink-2">Send it on WhatsApp or email. It works once, for 14 days, and can't be shown again.</p>
            {/* The link and a copy button side by side. */}
            <div className="mt-3 flex gap-2">
              {/* ref={linkRef} connects linkRef.current to this input. readOnly: user cannot type. Clicking/focusing selects all the text. */}
              <Input ref={linkRef} readOnly value={link.url} onFocus={(e) => e.target.select()} className="font-mono text-meta" aria-label="Invitation link" />
              {/* Passing the function `copy` itself (not calling it) as the click handler. */}
              <Button icon={Copy} onClick={copy}>
                copy
              </Button>
            </div>
          </div>
        )}
      </form>
      {/* Only show the waiting list when the data has loaded (`?.`) and has at least one item. */}
      {invitations.data?.length > 0 && (
        <ListCard label="Invitations waiting">
          {/* One row per invitation. */}
          {invitations.data.map((i) => (
            <ListRow
              // Unique key.
              key={i.id}
              // Envelope icon; aria-hidden hides decorative icons from screen readers.
              leading={<Mail size={17} className="text-ink-3" aria-hidden />}
              // The invited email address.
              title={i.email}
              // e.g. "Contractor · sent 2 days ago".
              subtitle={`${ROLE_LABELS[i.role]} · sent ${timeAgo(i.createdAt)}`}
              // A "cancel" text button on the right.
              trailing={
                <button
                  // Plain button, not a form submit.
                  type="button"
                  // Prevent double clicks while a cancel is already running.
                  disabled={revoke.isPending}
                  // Cancel this invitation and show a toast when done.
                  onClick={() => revoke.mutate(i.id, { onSuccess: () => toast.success('Invitation cancelled') })}
                  // Small grey text that turns red on hover.
                  className="text-meta font-semibold text-ink-3 hover:text-danger-700"
                >
                  cancel
                </button>
              }
            />
          ))}
        </ListCard>
      )}
    </section>
  )
}

// The "Archive this house" danger zone at the bottom.
function Danger() {
  // Current project.
  const { project } = useProjectContext()
  // Mutation that archives the project.
  const archive = useArchiveProject(project.id)
  // navigate('/path') changes page in code.
  const navigate = useNavigate()
  // Whether the confirm dialog is open (boolean state, starts closed).
  const [open, setOpen] = useState(false)
  return (
    // A card: stacked on phones, a single row with space between on wider screens.
    <section data-reveal className="card flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      {/* Title and explanation. */}
      <div>
        <p className="text-body font-semibold">Archive this house</p>
        <p className="text-meta text-ink-3">It leaves everyone's list. The record and its history are kept.</p>
      </div>
      {/* Red text button that opens the dialog. */}
      <Button variant="danger-text" icon={Archive} onClick={() => setOpen(true)}>
        archive
      </Button>
      {/* Confirmation dialog. */}
      <ConfirmDialog
        // Controlled by the `open` state.
        open={open}
        // Passing the setter directly: the dialog calls setOpen(false) when it closes.
        onOpenChange={setOpen}
        title={`Archive ${project.name}?`}
        description="Members will no longer see it. This can't be undone from the app yet."
        confirmLabel="archive"
        tone="danger"
        loading={archive.isPending}
        error={archive.error?.message}
        // Arrow function whose body is a single expression spread over several lines.
        onConfirm={() =>
          // Awaited: the archived project stops loading, which unmounts this page.
          // mutateAsync() returns a Promise. .then(onFulfilled, onRejected): on success toast and go to the home page '/';
          // on failure do nothing here (the empty arrow `() => {}`), because the dialog already shows archive.error.
          archive.mutateAsync().then(
            () => (toast.success('Archived'), navigate('/')),
            () => {},
          )
        }
      />
    </section>
  )
}
