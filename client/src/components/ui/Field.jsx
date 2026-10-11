// FILE: components/ui/Field.jsx — form controls.
//
// What it does: `Field` wraps a control with its label, hint and error, and
// provides the id and aria wiring through React context, so an
// Input/Textarea/Select placed inside it is labelled and described for screen
// readers without any extra props. MoneyInput (rupees typed with separators,
// stored as paisa), Stepper (number with -/+), Checkbox, OptionCards (big radio
// cards) and Segmented (pill radio row) are the app's specialised inputs.
// Where it's used: every form in the app (new purchase, payments, project
// setup, settings...). Re-exported from ui/index.js.
// Depends on: React (context, forwardRef, hooks), lucide-react icons, and
// lib/format.js (`amount` for lakh/crore wording, `cn` class joiner).

// createContext/useContext share data down the component tree without passing
// props; forwardRef passes a parent's ref to the real element; useId makes
// unique ids; useState holds local state.
import { createContext, forwardRef, useContext, useId, useState } from 'react'
// Icons: tick, dropdown arrow, minus and plus.
import { Check, ChevronDown, Minus, Plus } from 'lucide-react'
// amount(paisa) -> "1.79 crore"-style text; cn joins classes.
import { amount, cn } from '../../lib/format.js'

// A context object with default value null (used when there's no Field around a control).
const FieldContext = createContext(null)

/**
 * Label, control, hint and error wired together for screen readers.
 *   <Field label="Supplier" error={errors.supplier} hint="As written on the receipt"><Input /></Field>
 * With `group`, the field is a fieldset whose legend is the label, for a
 * row of pills, a stepper or any control that isn't one input.
 */
// Props: label text, hint, error message, required/optional markers, `group`
// flag, the control as `children`, extra class.
export function Field({ label, hint, error, required, optional, group, children, className }) {
  // Unique id for the control (e.g. ":r3:"); hint/error ids are derived from it.
  const id = useId()
  // Build the aria-describedby value: an array of ids (false entries when
  // there's no hint/error), filtered to drop falsy ones, joined with spaces;
  // `|| undefined` turns an empty string into "no attribute".
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  // Pick the HTML tag names as strings: grouped fields use <fieldset>/<legend>.
  const Wrap = group ? 'fieldset' : 'div'
  // ...otherwise <div>/<label>.
  const Label = group ? 'legend' : 'label'
  return (
    // Provider makes `value` available to any descendant calling
    // useContext(FieldContext). `value={{ ... }}`: outer braces = JS, inner = object.
    // `invalid: !!error` converts error to a true/false boolean.
    <FieldContext.Provider value={{ id, describedBy, invalid: !!error }}>
      {/* Column wrapper; a fieldset gets its browser default border/margin removed.
          A group puts aria-describedby on the fieldset itself. */}
      <Wrap className={cn('flex min-w-0 flex-col gap-1.5', group && 'm-0 border-0 p-0', className)} aria-describedby={group ? describedBy : undefined}>
        {/* The label, only when one was given. */}
        {label && (
          // A <label>'s htmlFor points at the control's id (legends don't take htmlFor).
          <Label htmlFor={group ? undefined : id} className={cn('text-meta font-semibold text-ink-2', group && 'mb-1.5 p-0')}>
            {label}
            {/* Visual red asterisk for required fields (hidden from screen readers). */}
            {required && <span className="ms-0.5 text-danger-700" aria-hidden>*</span>}
            {/* Grey "optional" note. */}
            {optional && <span className="ms-1.5 font-normal text-ink-3">optional</span>}
          </Label>
        )}
        {/* The control(s) the caller nested inside. */}
        {children}
        {/* Hint text, hidden while an error is shown. Its id matches describedBy. */}
        {hint && !error && (
          <p id={`${id}-hint`} className="text-meta text-ink-3">
            {hint}
          </p>
        )}
        {/* Error text; role="alert" makes screen readers announce it right away. */}
        {error && (
          <p id={`${id}-error`} className="text-meta font-semibold text-danger-700" role="alert">
            {error}
          </p>
        )}
      </Wrap>
    </FieldContext.Provider>
  )
}

// A custom hook (name starts with "use"): reads the surrounding Field's context
// and returns the id/aria props a control should have. Explicit props win.
function useFieldProps(props) {
  // The Field's context value, or null when not inside a Field.
  const ctx = useContext(FieldContext)
  // Return an object of props.
  return {
    // Explicit id prop, else the Field's id (`?.` because ctx may be null).
    id: props.id ?? ctx?.id,
    // Quoted keys because they contain dashes; bracket access reads them.
    'aria-describedby': props['aria-describedby'] ?? ctx?.describedBy,
    // `|| undefined` so a false "invalid" doesn't render aria-invalid="false".
    'aria-invalid': props['aria-invalid'] ?? (ctx?.invalid || undefined),
  }
}

// Text input. forwardRef so parents can focus it. Props: extra class, optional
// `prefix` (e.g. "Rs") and `suffix` text drawn inside the box, rest in `props`.
export const Input = forwardRef(function Input({ className, prefix, suffix, ...props }, ref) {
  // id/aria wiring from the surrounding Field.
  const field = useFieldProps(props)
  // With prefix or suffix: wrap in a relative box and overlay the extra text.
  if (prefix || suffix) {
    return (
      <div className="relative flex items-center">
        {/* Prefix pinned at the start edge; ignores clicks so they reach the input. */}
        {prefix && <span className="pointer-events-none absolute start-3.5 text-body font-semibold text-ink-3">{prefix}</span>}
        {/* Spreads: caller props first, then Field wiring (later spreads win).
            Extra start/end padding makes room for the prefix/suffix. */}
        <input ref={ref} {...props} {...field} className={cn('field-input', prefix && 'ps-11', suffix && 'pe-28', className)} />
        {/* Suffix pinned at the end edge. */}
        {suffix && <span className="pointer-events-none absolute end-3.5 text-meta text-ink-3">{suffix}</span>}
      </div>
    )
  }
  // Plain input with the shared `field-input` styling.
  return <input ref={ref} {...props} {...field} className={cn('field-input', className)} />
})

// Multi-line text box; `rows` defaults to 3 and the user can resize vertically.
export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...props }, ref) {
  // id/aria wiring.
  const field = useFieldProps(props)
  // Single JSX element returned directly.
  return <textarea ref={ref} rows={rows} {...props} {...field} className={cn('field-input resize-y', className)} />
})

// Native dropdown with a custom arrow. `children` are the <option> elements.
export const Select = forwardRef(function Select({ className, children, ...props }, ref) {
  // id/aria wiring.
  const field = useFieldProps(props)
  return (
    // Relative so the arrow icon can be positioned over the select.
    <div className="relative">
      {/* appearance-none hides the browser's own arrow; pe-10 leaves room for ours. */}
      <select ref={ref} {...props} {...field} className={cn('field-input appearance-none pe-10', className)}>
        {children}
      </select>
      {/* Our arrow, vertically centred at the end edge, click-through. */}
      <ChevronDown size={18} className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
    </div>
  )
})

// Arrow function: format rupees with Pakistani digit grouping (e.g. 1,79,00,000).
const grouped = (rupees) => rupees.toLocaleString('en-PK')

/**
 * Rupee amount typed with thousands separators, stored as paisa. Large
 * amounts also read out in lakh/crore beside the field ("1.79 crore").
 *   <MoneyInput value={paisa} onChange={setPaisa} />
 */
// Props: `value` in paisa (1 rupee = 100 paisa), `onChange(paisa)`,
// placeholder '0', `words` (show lakh/crore suffix, default true), rest props.
export function MoneyInput({ value, onChange, placeholder = '0', words = true, className, ...props }) {
  // The text is local state so the caret and partial decimals ("12.") survive
  // re-renders; it's only replaced when the parent's paisa value changes to
  // something that doesn't match what's typed (a reset, a preset).
  // Initial text: grouped rupees if a value exists, else empty.
  const [text, setText] = useState(value != null && value !== '' ? grouped(value / 100) : '')
  // Remember the last value we saw so we can detect outside changes.
  const [last, setLast] = useState(value)
  // During render: if the parent's value changed since last time...
  if (value !== last) {
    // ...record it...
    setLast(value)
    // ...work out what the text should be...
    const next = value != null && value !== '' ? grouped(value / 100) : ''
    // ...and replace the text only if the digits differ (commas removed with a
    // regex replace: /,/g matches every comma).
    if (next.replace(/,/g, '') !== text.replace(/,/g, '')) setText(next)
  }
  // For 1 lakh rupees or more (100000 * 100 paisa), show the compact wording; else null.
  const compact = words && value >= 100000 * 100 ? amount(value) : null
  return (
    // Built on Input above.
    <Input
      // Pass through other props first so the ones below take priority.
      {...props}
      className={className}
      // Phones show a numeric keypad with a decimal point.
      inputMode="decimal"
      // "Rs" drawn at the start of the box.
      prefix="Rs"
      // Lakh/crore wording at the end (null hides it).
      suffix={compact}
      placeholder={placeholder}
      // Controlled: shows our local text.
      value={text}
      // On every keystroke:
      onChange={(e) => {
        // Keep only digits and dots (regex: anything NOT \d or . is removed).
        const raw = e.target.value.replace(/[^\d.]/g, '')
        // Array destructuring of split('.'): part before and after the dot.
        const [whole, dec] = raw.split('.')
        // Re-group the whole part and keep at most 2 decimal digits if a dot was typed.
        const formatted = whole ? Number(whole).toLocaleString('en-PK') + (dec !== undefined ? `.${dec.slice(0, 2)}` : '') : ''
        // Show the formatted text.
        setText(formatted)
        // Convert to whole paisa (null when empty).
        const paisa = raw ? Math.round(Number(raw) * 100) : null
        // Remember it so the "value changed" check above doesn't overwrite our text.
        setLast(paisa)
        // Tell the parent.
        onChange(paisa)
      }}
    />
  )
}

/** A number with − / + buttons, for floors, workers and plot sizes. */
// Props with defaults: min 0, max 999, step 1, inputMode 'numeric'; `label`
// for accessible names and `unit` text shown inside the box.
export function Stepper({ value, onChange, min = 0, max = 999, step = 1, label, unit, className, inputMode = 'numeric' }) {
  // Field wiring from context (no explicit props, hence the empty object).
  const field = useFieldProps({})
  // Helper: clamp v between min and max, then report it.
  const set = (v) => onChange(Math.min(max, Math.max(min, v)))
  // Shared class string for both round -/+ buttons.
  const btn = 'grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-line-strong active:scale-95 disabled:opacity-35'
  return (
    // Row: minus button, number box, plus button.
    <div className={cn('flex items-center gap-2', className)}>
      {/* Minus: subtract `step` (`|| 0` treats empty/NaN as 0); disabled at the
          minimum. aria-label like "Less floors"; .trim() drops the trailing
          space when there's no label (`label ?? ''`). */}
      <button type="button" className={btn} onClick={() => set((Number(value) || 0) - step)} disabled={Number(value) <= min} aria-label={`Less ${label ?? ''}`.trim()}>
        <Minus size={18} aria-hidden />
      </button>
      {/* Number box takes the remaining width. */}
      <div className="relative min-w-0 flex-1">
        <input
          // Field id/aria wiring.
          {...field}
          // Which phone keyboard to show.
          inputMode={inputMode}
          // Controlled value; `?? ''` avoids passing null/undefined.
          value={value ?? ''}
          aria-label={label}
          // Allow free typing: strip non-numeric characters, '' stays '' (so
          // the box can be empty while typing), anything else becomes a Number.
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.]/g, '')
            onChange(raw === '' ? '' : Number(raw))
          }}
          // On leaving the box, clamp the value (or fall back to min if invalid),
          // unless it's empty.
          onBlur={() => value !== '' && set(Number(value) || min)}
          // Big bold centred number with tabular digits.
          className="field-input num text-center text-title font-bold"
        />
        {/* Optional unit (e.g. "ft") inside the box at the end edge. */}
        {unit && <span className="pointer-events-none absolute end-3.5 top-1/2 -translate-y-1/2 text-meta text-ink-3">{unit}</span>}
      </div>
      {/* Plus: mirror of the minus button, disabled at the maximum. */}
      <button type="button" className={btn} onClick={() => set((Number(value) || 0) + step)} disabled={Number(value) >= max} aria-label={`More ${label ?? ''}`.trim()}>
        <Plus size={18} aria-hidden />
      </button>
    </div>
  )
}

// Custom-styled checkbox with label and optional description.
export function Checkbox({ checked, onChange, label, description, disabled, className }) {
  // Unique id linking label and input.
  const id = useId()
  return (
    // The whole thing is a <label>, so clicking anywhere toggles the checkbox.
    <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-3', disabled && 'cursor-not-allowed opacity-60', className)}>
      <span className="relative mt-0.5 flex">
        {/* The real checkbox, visually hidden (sr-only) but still focusable and
            announced. `peer` lets the sibling below style itself from its state.
            onChange reports e.target.checked (true/false). */}
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {/* The visible box: black when the peer is checked, focus ring when the
            peer has keyboard focus. */}
        <span className="grid h-[22px] w-[22px] place-items-center rounded-[7px] border-[1.5px] border-line-input bg-white transition peer-checked:border-ink peer-checked:bg-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent-600 peer-focus-visible:ring-offset-2">
          {/* White tick, only visible when checked. */}
          <Check size={14} strokeWidth={3} className={cn('text-white', checked ? 'opacity-100' : 'opacity-0')} aria-hidden />
        </span>
      </span>
      {/* Text column. */}
      <span className="flex flex-col">
        <span className="text-body font-semibold text-ink">{label}</span>
        {/* Optional second line. */}
        {description && <span className="text-meta text-ink-3">{description}</span>}
      </span>
    </label>
  )
}

/**
 * Large selectable options (radio semantics), for choices that need a description.
 *   <OptionCards value={v} onChange={setV} options={[{ value, label, description, icon }]} />
 */
// Props: selected `value`, `onChange`, `options`, number of `columns` (default
// 2), an optional radio `name`, and an accessible group `label`.
export function OptionCards({ value, onChange, options, columns = 2, name, label }) {
  // Fallback radio group name so the radios belong together.
  const group = useId()
  return (
    // Radio group grid; column count from a chained ternary (1, 2, 3 or 4 on wider screens).
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2.5', columns === 3 ? 'sm:grid-cols-3' : columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : columns === 1 ? '' : 'sm:grid-cols-2')}>
      {/* One card per option. */}
      {options.map((o) => {
        // Is this the chosen option?
        const active = o.value === value
        // Copy to a capitalised variable so it can be a JSX tag.
        const Icon = o.icon
        return (
          // Each card is a <label> so clicking it selects the hidden radio inside.
          <label
            key={o.value}
            // White rounded card; black border + ring when active.
            className={cn(
              'relative flex cursor-pointer gap-3 rounded-tile border bg-white p-4 transition',
              active ? 'border-ink ring-1 ring-ink' : 'border-line hover:border-line-strong',
            )}
          >
            {/* Hidden real radio input (sr-only, `peer` for focus styling below). */}
            <input type="radio" name={name ?? group} value={o.value} checked={active} onChange={() => onChange(o.value)} className="peer sr-only" />
            {/* Optional round icon; black when active. */}
            {Icon && (
              <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full transition', active ? 'bg-ink text-white' : 'bg-sunken text-ink-2')}>
                <Icon size={19} aria-hidden />
              </span>
            )}
            {/* Title and description. */}
            <span className="min-w-0 flex-1">
              <span className="block text-body font-bold text-ink">{o.label}</span>
              {o.description && <span className="mt-0.5 block text-meta leading-snug text-ink-3">{o.description}</span>}
            </span>
            {/* Visual radio circle at the end; filled black with a tick when active. */}
            <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] transition', active ? 'border-ink bg-ink' : 'border-line-input')} aria-hidden>
              {active && <Check size={12} strokeWidth={3.2} className="text-white" />}
            </span>
            {/* Overlay that draws a focus ring around the whole card when the hidden radio has keyboard focus. */}
            <span className="pointer-events-none absolute inset-0 rounded-tile peer-focus-visible:ring-2 peer-focus-visible:ring-accent-600 peer-focus-visible:ring-offset-2" aria-hidden />
          </label>
        )
      })}
    </div>
  )
}

/** Compact single choice: a row of pills (selected = black). */
// Props: `value`, `onChange`, `options`, accessible `label`, `size` default 'md', extra class.
export function Segmented({ value, onChange, options, label, size = 'md', className }) {
  return (
    // Wrapping row of pills acting as a radio group.
    <div role="radiogroup" aria-label={label} className={cn('inline-flex flex-wrap gap-1.5', className)}>
      {options.map((o) => {
        // Selected?
        const active = o.value === value
        return (
          <button
            // List key.
            key={o.value}
            type="button"
            // Behaves as a radio option for assistive tech.
            role="radio"
            aria-checked={active}
            // Report this option when clicked.
            onClick={() => onChange(o.value)}
            // Pill styling; size variant; black when active, outlined white otherwise.
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-full border font-semibold whitespace-nowrap transition active:scale-[0.97]',
              size === 'sm' ? 'h-8 px-3 text-meta' : 'h-10 px-4 text-body',
              active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink hover:border-line-strong',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
