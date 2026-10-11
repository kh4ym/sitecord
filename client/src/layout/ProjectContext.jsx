// FILE: client/src/layout/ProjectContext.jsx
//
// What it does: defines the React context every project page reads: the
// project, the signed-in person, can(action), the contract's features and the
// computed nav. React "context" is a way to pass a value to every component
// below a provider without threading it through props at each level.
//
// Where it's used: the value is built once in ProjectLayout and provided with
// <ProjectContext.Provider>; pages and components read it with
// useProjectContext().
//
// Depends on: react (createContext, useContext).

// createContext makes a context object; useContext reads the nearest provider's value.
import { createContext, useContext } from 'react'

/**
 * The current project and the viewer's place on it:
 * { project, pid, role, me, can(action), features, nav, landing }
 * Provided by layout/ProjectLayout.jsx; read by every project page and by
 * components that need permissions (DecisionActions, QuestionThread, the
 * evidence components, AppShell's project navigation).
 */
// `null` is the default value seen by components with no provider above them.
export const ProjectContext = createContext(null)

// A custom hook that reads the context and fails loudly if used outside a project page.
export function useProjectContext() {
  // The value from the nearest <ProjectContext.Provider>, or null.
  const ctx = useContext(ProjectContext)
  // `throw new Error(...)` stops rendering with a clear message (caught by an ErrorBoundary).
  if (!ctx) throw new Error('useProjectContext must be used inside a project page')
  // Hand the context value back.
  return ctx
}
