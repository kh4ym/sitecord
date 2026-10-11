// Catch-all route: a plain "nothing here" card with a way back.
//
// FILE OVERVIEW
// - Route: "*" (any URL that matches no other route). It is used twice in the
//   router: once at the top level, and once inside a project (/p/:projectId/*)
//   with the prop inProject set, so the button can lead back to that house.
// - Who sees it: anyone who follows a bad or outdated link.
// - Data: none loaded. It reads :projectId from the URL (if there is one) and
//   sets the browser tab title.
// - Depends on: React's useEffect, React Router's useParams, a lucide icon and
//   our UI kit's Button + EmptyState.

// useEffect runs side effects (like changing document.title) after rendering.
import { useEffect } from 'react'
// useParams reads named parts of the current URL, like :projectId.
import { useParams } from 'react-router'
// "Map pin crossed out" icon.
import { MapPinOff } from 'lucide-react'
// UI kit components.
import { Button, EmptyState } from '../components/ui/index.js'

// Default export; { inProject } destructures the boolean prop from the router.
export default function NotFoundPage({ inProject }) {
  // projectId is undefined when we're not under /p/:projectId.
  const { projectId } = useParams()
  // Effect that sets the browser tab title.
  useEffect(() => {
    document.title = 'Not found · SiteCord'
    // Empty dependency array [] = run once, after the first render.
  }, [])
  return (
    // Centred, narrow column with vertical padding.
    <div className="mx-auto max-w-lg py-16">
      <div className="card">
        {/* EmptyState shows an icon, title, description and an action. */}
        <EmptyState
          // The icon component itself is passed as a prop.
          icon={MapPinOff}
          title="This page doesn't exist"
          description="The link may be old, or the page may have moved."
          // action receives a JSX element as its value.
          action={
            // Ternary + &&: inside a project with a known id, link to that house (template literal); otherwise go home.
            <Button variant="primary" to={inProject && projectId ? `/p/${projectId}` : '/'}>
              {/* Button text chosen by a ternary. */}
              {inProject ? 'back to the house' : 'go to your houses'}
            </Button>
          }
        />
      </div>
    </div>
  )
}
