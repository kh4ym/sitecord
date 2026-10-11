// /settings. The person's own profile, language and password, and sign out.
//
// FILE OVERVIEW
// - Route: /settings  (inside the signed-in app shell).
// - Who sees it: any signed-in person; it is about their own account, not a
//   project. The route guard guarantees `me` exists, so the code reads me.name
//   directly without checking for undefined.
// - Sections (each is a small component further down this file):
//   1. header: avatar, name, email, member-since date
//   2. Profile: edit full name and mobile number (useUpdateMe mutation)
//   3. Language: switch the interface between English and Urdu (useI18n)
//   4. Password: change password (useChangePassword mutation)
//   5. SignOut: sign out of this device (useSignOut)
// - Data loaded: useMe() for the current user.
// - Depends on: React state, sonner toasts, lucide icons, Page/PageTitle
//   layout, our UI kit, the i18n provider, formatDate and lib/queries.js hooks.

// useState hook for remembering form values between renders.
import { useState } from 'react'
// toast pops up short success/error notifications.
import { toast } from 'sonner'
// Log-out icon component.
import { LogOut } from 'lucide-react'
// Page: the standard page container (width + reveal animations).
import { Page } from '../components/Page.jsx'
// UI kit components used on this page.
import { Avatar, Button, Field, Input, SectionHead, Segmented } from '../components/ui/index.js'
// useI18n gives t() (translate a key), the current locale and setLocale.
import { useI18n } from '../i18n/I18nProvider.jsx'
// PageTitle renders the page heading and sets the browser tab title.
import { PageTitle } from '../layout/PageHeader.jsx'
// Formats a date value into readable text.
import { formatDate } from '../lib/format.js'
// Data hooks: change password, current user, update the current user.
import { useChangePassword, useMe, useUpdateMe } from '../lib/queries.js'
// Custom hook returning { signOut, pending }.
import { useSignOut } from '../lib/useSignOut.js'

// Default export: the page component the router shows at /settings.
export default function AccountPage() {
  // Destructuring with rename: the query's data becomes `me`.
  const { data: me } = useMe()
  // Pull only the t (translate) function out of the i18n object.
  const { t } = useI18n()
  // JSX for the page.
  return (
    // width="narrow" is a string prop: a narrower content column.
    <Page width="narrow">
      {/* t('nav.account') looks up the translated "Account" text. */}
      <PageTitle title={t('nav.account')} />
      {/* Vertical stack of sections with large gaps. */}
      <div className="flex flex-col gap-9">
        {/* data-reveal marks this section for the page's fade-in animation. */}
        <section data-reveal className="flex items-center gap-4">
          {/* Avatar draws initials from the name; size is a number prop in pixels. */}
          <Avatar name={me.name} size={56} />
          {/* min-w-0 lets the text column shrink so `truncate` can add "…". */}
          <div className="min-w-0">
            <p className="truncate text-title font-bold">{me.name}</p>
            {/* Email plus the account creation date, formatted by formatDate(). */}
            <p className="truncate text-meta text-ink-3">
              {me.email} · since {formatDate(me.createdAt)}
            </p>
          </div>
        </section>
        {/* Each section is its own component; Profile receives me as a prop. */}
        <Profile me={me} />
        <Language />
        <Password />
        <SignOut />
      </div>
    </Page>
  )
}

// Profile section: { me } destructures the prop passed by AccountPage.
function Profile({ me }) {
  // Mutation hook: update.mutate(...), update.isPending, update.error.
  const update = useUpdateMe()
  // Form state starts from the saved values; ?? turns a missing phone (null/undefined) into ''.
  const [form, setForm] = useState({ name: me.name, phone: me.phone ?? '' })
  // Field errors from the server, or an empty object.
  const errors = update.error?.fieldErrors ?? {}
  // dirty is true when anything differs from what's saved (|| = "or"); used to enable the save button.
  const dirty = form.name !== me.name || form.phone !== (me.phone ?? '')
  return (
    <section data-reveal className="flex flex-col gap-3">
      {/* Section heading component. */}
      <SectionHead title="Profile" />
      <form
        // Card with a one-column grid, two columns from the sm breakpoint up.
        className="card grid gap-4 p-5 sm:grid-cols-2"
        // Inline submit handler.
        onSubmit={(e) => {
          // Don't reload the page.
          e.preventDefault()
          // Save; an empty phone becomes null (|| picks null when phone is ''). On success show a toast.
          update.mutate({ name: form.name, phone: form.phone || null }, { onSuccess: () => toast.success('Profile saved') })
        }}
      >
        {/* Controlled input: value from state, onChange copies form with name replaced (spread syntax). */}
        <Field label="Full name" error={errors.name}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
        </Field>
        {/* optional adds an "optional" marker; same controlled pattern for phone. */}
        <Field label="Mobile number" optional error={errors.phone}>
          <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
        </Field>
        {/* Spans both grid columns. */}
        <div className="sm:col-span-2">
          {/* Disabled until something changed; spinner while saving. */}
          <Button type="submit" variant="primary" disabled={!dirty} loading={update.isPending}>
            save
          </Button>
        </div>
      </form>
    </section>
  )
}

// Language section: switch the app between English and Urdu.
function Language() {
  // Destructure three values from the i18n hook.
  const { t, locale, setLocale } = useI18n()
  return (
    <section data-reveal className="flex flex-col gap-3">
      <SectionHead title={t('common.language')} />
      {/* Card: stacked on phones, side by side on wider screens. */}
      <div className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-meta text-ink-3">Field screens, navigation and statuses are in Urdu too.</p>
        {/* Segmented = a pill-shaped toggle between a few options. */}
        <Segmented
          // Accessible name for the control.
          label={t('common.language')}
          // Currently selected option ('en' or 'ur').
          value={locale}
          // Called with the newly chosen value v.
          onChange={(v) => {
            // Switch the language for the whole app.
            setLocale(v)
            // Ternary: confirmation toast in the newly chosen language.
            toast.success(v === 'ur' ? 'زبان اردو کر دی گئی' : 'Language set to English')
          }}
          // options is an array of { value, label } objects (double braces aren't needed here: [ ] is the array literal).
          options={[
            { value: 'en', label: 'English' },
            { value: 'ur', label: 'اردو' },
          ]}
        />
      </div>
    </section>
  )
}

// Password section: change your password.
function Password() {
  // Mutation hook for the password change.
  const change = useChangePassword()
  // Two fields: current password and the new one (named next).
  const [form, setForm] = useState({ current: '', next: '' })
  // Field errors from the server, or {}.
  const errors = change.error?.fieldErrors ?? {}
  return (
    <section data-reveal className="flex flex-col gap-3">
      <SectionHead title="Password" />
      <form
        // Card with a responsive two-column grid.
        className="card grid gap-4 p-5 sm:grid-cols-2"
        onSubmit={(e) => {
          // Stop the browser's own form submission.
          e.preventDefault()
          // Send { current, next } to the server.
          change.mutate(form, {
            // Runs only if the change succeeded.
            onSuccess: () => {
              // Clear both inputs.
              setForm({ current: '', next: '' })
              // Confirm with a toast.
              toast.success('Password changed')
            },
          })
        }}
      >
        {/* error: the field error if any; otherwise (??) a general error message, but only when there is an error and it isn't about the new password (&& chain returns the last value or false). */}
        <Field label="Current password" error={errors.current ?? (change.error && !errors.next && change.error.message)}>
          {/* Controlled password input for the current password. */}
          <Input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
        </Field>
        {/* hint is helper text under the label. */}
        <Field label="New password" hint="At least 8 characters" error={errors.next}>
          {/* Controlled input for the new password. */}
          <Input type="password" autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
        </Field>
        {/* Explanatory note spanning both columns. */}
        <p className="text-meta text-ink-3 sm:col-span-2">Changing it signs you out on your other devices.</p>
        <div className="sm:col-span-2">
          {/* Disabled unless both fields have something typed. */}
          <Button type="submit" disabled={!form.current || !form.next} loading={change.isPending}>
            change password
          </Button>
        </div>
      </form>
    </section>
  )
}

// Sign-out section.
function SignOut() {
  // Translation function.
  const { t } = useI18n()
  // signOut = function to call, pending = true while signing out.
  const { signOut, pending } = useSignOut()
  return (
    // A single card row: text on the left, button on the right.
    <section data-reveal className="card flex items-center justify-between gap-3 px-5 py-4">
      <p className="text-meta text-ink-3">Sign out of SiteCord on this device.</p>
      {/* onClick={signOut} passes the function itself; icon={LogOut} passes the icon component. */}
      <Button variant="danger-text" icon={LogOut} loading={pending} onClick={signOut}>
        {/* Translated "Sign out", lowercased to match the button style. */}
        {t('common.signOut').toLowerCase()}
      </Button>
    </section>
  )
}
