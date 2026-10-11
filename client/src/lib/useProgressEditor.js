// FILE: client/src/lib/useProgressEditor.js
//
// What it does: a custom React hook for editing the current stage's progress
// (0–100%) from the Today and Progress pages. The switches respond instantly
// (local state); the server is updated behind them, debounced and in order.
// It also offers "complete this stage" and "reopen the previous stage".
//
// Where it's used: the Today and Progress pages.
//
// Depends on: react hooks, sonner (toast messages), shared/features.js (which
// stages a contract type has), shared/houseConfig.js (the last stage index for
// a floor count) and lib/queries.js (useUpdateProgress mutation).

// Named imports of three React hooks.
import { useEffect, useRef, useState } from 'react'
// The toast helper from the sonner library (small pop-up messages).
import { toast } from 'sonner'
// Returns the list of stages (each with steps) for a project.
import { stagesFor } from '@shared/features.js'
// Index of the final stage for a given number of floors.
import { lastStageIndex } from '@shared/houseConfig.js'
// TanStack Query mutation hook that PATCHes the project's progress.
import { useUpdateProgress } from './queries.js'

/**
 * Local, instantly-responsive progress for the current stage, saved to the
 * server shortly after the last change. Saves run one after another, so two
 * quick taps can never land out of order and leave the server on the older value.
 */
// A custom hook: a function whose name starts with "use" and that calls other hooks.
export function useProgressEditor(project) {
  // The mutation object (has mutateAsync, isPending...).
  const update = useUpdateProgress(project.id)
  // useState(initial) returns [currentValue, setterFunction]; array destructuring names them.
  const [value, setValue] = useState(project.stageProgress)
  // The server value we last adopted, as a "stage:progress" string (template literal).
  const [seen, setSeen] = useState(`${project.stageIndex}:${project.stageProgress}`)
  // useRef holds a mutable value that survives re-renders: here the debounce timer id.
  const timer = useRef(null)
  // The tail of the save queue: a Promise that is already resolved to start.
  const chain = useRef(Promise.resolve())
  // Always points at the newest project prop, so delayed callbacks read fresh data.
  const latest = useRef(project)
  // Update it on every render.
  latest.current = project
  // When the server's value changes (a refetch, another device), adopt it
  // without an effect: setting state during render re-runs immediately.
  const key = `${project.stageIndex}:${project.stageProgress}`
  // Different from what we last saw: remember it and reset the local value.
  if (key !== seen) {
    setSeen(key)
    setValue(project.stageProgress)
  }
  // useEffect(fn, []) runs fn once after mount. fn here RETURNS another arrow
  // function (`() => clearTimeout(...)`), which React calls on unmount (cleanup),
  // so a pending save timer is cancelled when the page closes.
  useEffect(() => () => clearTimeout(timer.current), [])

  // Every save is chained onto the previous one's promise, so requests reach
  // the server in the order they were made even on a slow connection.
  const save = (body) => {
    // `.then(fn)` runs fn after the previous Promise settles and returns a new Promise.
    chain.current = chain.current.then(() =>
      // mutateAsync sends the request and returns a Promise; `.catch` handles failure
      // so the chain itself never breaks.
      update.mutateAsync(body).catch((err) => {
        // Put the switches back where the server has them.
        setValue(latest.current.stageProgress)
        // Show the error message in a red toast.
        toast.error(err.message)
      }),
    )
    // Return the Promise so callers can wait for this save.
    return chain.current
  }

  // Debounced: a run of quick taps becomes one save with the final value.
  // `delay = 300` is a default parameter in milliseconds.
  const set = (v, delay = 300) => {
    // Clamp v into 0..100.
    const next = Math.max(0, Math.min(100, v))
    // Update the UI immediately.
    setValue(next)
    // Cancel any save scheduled by a previous tap.
    clearTimeout(timer.current)
    // Schedule a fresh save after `delay` ms; store the timer id in the ref.
    timer.current = setTimeout(() => save({ stageIndex: latest.current.stageIndex, stageProgress: next }), delay)
  }

  // Index of the last stage for this house.
  const last = lastStageIndex(project.floors)
  // Mark the current stage done: on the last stage set 100%, otherwise move to
  // the next stage at 0%. `.then(onDone)` calls the caller's callback afterwards.
  const completeStage = (onDone) =>
    save(project.stageIndex === last ? { stageIndex: last, stageProgress: 100 } : { stageIndex: project.stageIndex + 1, stageProgress: 0 }).then(onDone)
  // Undo a completion.
  const reopenPrevious = () => {
    // The whole build was finished.
    if (project.stageIndex === last && project.stageProgress === 100) {
      // Back to just before the final step of the last stage.
      // `stagesFor(project)[last]` = the last stage object; `.steps` its step list.
      const steps = stagesFor(project)[last].steps
      // Second-to-last step's percentage (`steps[steps.length - 2].at`), or 0 if only one step.
      return save({ stageIndex: last, stageProgress: steps.length > 1 ? steps[steps.length - 2].at : 0 })
    }
    // Otherwise go back one stage (never below 0), shown as fully complete.
    return save({ stageIndex: Math.max(0, project.stageIndex - 1), stageProgress: 100 })
  }

  // The hook's public API, as an object. `value`, `set` etc. use shorthand properties.
  return { value, set, saving: update.isPending, completeStage, reopenPrevious, isLast: project.stageIndex === last }
}
