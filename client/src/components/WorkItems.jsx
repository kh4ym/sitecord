// FILE: components/WorkItems.jsx — a construction stage's steps as switch rows.
//
// What it does: lists the steps of one stage (e.g. "Foundation": excavation,
// footing, plinth...). Each row shows the step name, a detail line (or "60%
// through" for the step in progress), an optional inspection status, and
// either an on/off switch (editable) or a read-only check circle. Switching a
// step on moves the stage's progress to that step's `at`; switching it off
// goes back to the previous step's `at`.
// Where it's used: shared by Today, Progress and the daily report.
// Depends on: lucide-react ShieldCheck icon, i18n (term/t and STEP_DETAILS
// descriptions), `cn`, and the ui Toggle.

// Shield icon used for the inspection status line.
import { ShieldCheck } from 'lucide-react'
// Translation hook (`term` translates construction terms, `t` UI strings).
import { useI18n } from '../i18n/I18nProvider.jsx'
// Step label -> short description text.
import { STEP_DETAILS } from '../i18n/strings.js'
// Class joiner.
import { cn } from '../lib/format.js'
// On/off switch.
import { Toggle } from './ui/index.js'

/**
 * A stage's steps as switch rows, the way the design does progress: switch a
 * step on when it's finished. Progress is one number per stage, so switching
 * step k on sets progress to that step's `at`; switching it off goes back to
 * the step before. Read-only rows show a check instead of a switch.
 * Used on Today, Progress and the daily report; `stage` is a shared/features
 * stage ({ label, steps: [{ label, at, inspect }] }), `inspections` the
 * plan's records for this stage.
 */
// Props: `stage`, current `progress` number, `editable` flag, `onChange(newProgress)`,
// `inspections` (default empty array), `showInspection` (default true), extra class.
export function WorkItems({ stage, progress, editable, onChange, inspections = [], showInspection = true, className }) {
  // Two translation functions from the i18n hook.
  const { term, t } = useI18n()
  return (
    // Card list with dividers.
    <ul className={cn('card divide-y divide-line', className)}>
      {/* Each step with its index `i`. */}
      {stage.steps.map((step, i) => {
        // Progress where this step starts: the previous step's `at`, or 0 for
        // the first step (index 0 is falsy).
        const from = i ? stage.steps[i - 1].at : 0
        // Finished when progress has reached this step's end.
        const done = progress >= step.at
        // In progress: not done, but past its start.
        const partial = !done && progress > from
        // Inspections recorded for this step.
        const checks = inspections.filter((x) => x.step === step.label)
        // The most recent one: .at(-1) reads the last array element (undefined if empty).
        const last = checks.at(-1)
        return (
          <li key={step.label} className="flex min-h-16 items-center gap-3 px-4 py-3">
            {/* Text column. */}
            <span className="min-w-0 flex-1">
              {/* Step name; darker when done. */}
              <span className={cn('block text-body font-semibold', done ? 'text-ink' : 'text-ink-2')}>{term(step.label)}</span>
              <span className="block truncate text-meta text-ink-3">
                {/* In progress: "N% through" where N is how far between `from`
                    and `at` progress is; otherwise the step's description. */}
                {partial ? t('step.through', { n: Math.round(((progress - from) / (step.at - from)) * 100) }) : STEP_DETAILS[step.label]}
              </span>
              {/* Inspection line: only if enabled, the step needs inspecting, and
                  it's done or has been inspected already. */}
              {showInspection && step.inspect && (done || last) && (
                // Colour: dark for a pass, amber for a failed inspection, grey when not yet inspected.
                <span className={cn('mt-1 flex items-center gap-1 text-2xs font-bold', last?.result === 'PASS' ? 'text-ink' : last ? 'text-warn-800' : 'text-ink-3')}>
                  <ShieldCheck size={12} aria-hidden />
                  {/* Matching message for each case. */}
                  {last?.result === 'PASS' ? t('step.inspected') : last ? t('step.needsFixes') : t('step.needsInspection')}
                </span>
              )}
            </span>
            {/* Editable: a switch. Turning on sets progress to this step's end;
                turning off sets it back to this step's start. */}
            {editable ? (
              <Toggle checked={done} label={term(step.label)} onChange={(on) => onChange(on ? step.at : from)} />
            ) : (
              // Read-only: a circle, filled black when done.
              <span
                className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-full border-[1.5px]', done ? 'border-ink bg-ink text-white' : 'border-line-strong')}
                // Spoken status ("done" / "not done").
                aria-label={done ? t('step.done') : t('step.notDone')}
              >
                {/* Inline SVG tick when done: a path drawn in the current text colour (white). */}
                {done && <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden><path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
