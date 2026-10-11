// FILE: components/HouseSnapshot.jsx — a still picture of the project's 3D house.
//
// What it does: shows the project's house at its current build position as an
// <img>, for the house cards and the Home hero. Pictures come from
// three/snapshots.js (drawn once on a hidden canvas, then cached) with an SVG
// silhouette placeholder while waiting (pulsing) or if drawing failed (still).
// Why: keeps three.js out of the main bundle until a picture is needed, and
// means a long list of houses doesn't need one live WebGL canvas each.
// Depends on: React hooks, shared/houseConfig.js (buildPosition), `cn`, and
// three/snapshots.js (cache lookup, render request, cache key).

// Named imports of two React hooks.
import { useEffect, useState } from 'react'
// Converts a stage index + progress into one number along the build timeline.
import { buildPosition } from '@shared/houseConfig.js'
// Class-name joiner.
import { cn } from '../lib/format.js'
// Snapshot helpers: read the cache, request a new render, and make a cache key.
import { cachedSnapshot, requestSnapshot, snapshotKey } from '../three/snapshots.js'

/**
 * The project's own 3D house as a still picture, at the stage it has reached.
 * Project cards and the Home hero use this instead of a live canvas: one
 * WebGL context draws every picture off-screen (three/snapshots.js) and the
 * result is cached, so a list of houses costs nothing to scroll.
 */
// Props: the `project` object, optional explicit `position`, camera `distance`,
// and class names for the outer box and the image.
export function HouseSnapshot({ project, position, distance, className, imgClassName }) {
  // Position is rounded to 0.1 so small progress changes reuse the cached picture.
  // `spec` describes exactly what to draw.
  const spec = {
    // Number of storeys.
    floors: project.floors,
    // Plot size preset.
    plotSize: project.plotSize,
    // `??` takes the left value unless it's null/undefined, then the right one.
    widthFt: project.plotWidthFt ?? project.widthFt,
    // Same fallback for depth.
    depthFt: project.plotDepthFt ?? project.depthFt,
    // Use the given position, or compute it from the stage (default stage 1,
    // progress 0); then *10, round, /10 rounds to one decimal place.
    position: Math.round((position ?? buildPosition(project.stageIndex ?? 1, project.stageProgress ?? 0)) * 10) / 10,
    // Shorthand property: same as `distance: distance`.
    distance,
  }
  // A string uniquely identifying this spec, used for caching.
  const key = snapshotKey(spec)
  // useState returns [value, setter]. Passing a function (lazy initialiser)
  // means it runs only on the first render: start with the cached URL if any.
  const [url, setUrl] = useState(() => cachedSnapshot(key))
  // Whether rendering the picture failed; starts false.
  const [failed, setFailed] = useState(false)
  // useEffect runs after render, and again whenever a value in its dependency
  // array (`[key]` below) changes. Used here to fetch the picture.
  useEffect(() => {
    // `let` (reassignable) flag so a late result after unmount is ignored.
    let live = true
    // Reset any previous failure.
    setFailed(false)
    // Check the cache again (the key may have changed).
    const hit = cachedSnapshot(key)
    // Cached: show it immediately and stop.
    if (hit) {
      setUrl(hit)
      return
    }
    // Not cached: clear the old picture so the silhouette shows.
    setUrl(null)
    // requestSnapshot returns a Promise; `.then(callback)` runs when it resolves
    // with the picture URL `u` (or a falsy value on failure).
    requestSnapshot(spec).then((u) => {
      // Component unmounted or key changed meanwhile: ignore the result.
      if (!live) return
      // Got a picture: store it.
      if (u) setUrl(u)
      // Otherwise mark as failed (stops the placeholder pulsing).
      else setFailed(true)
    })
    // The function returned from an effect is its "cleanup": React runs it
    // before the next effect run and on unmount.
    return () => {
      live = false
    }
    // Dependency array: rerun only when `key` changes. The comment tells ESLint
    // not to warn that `spec` is missing (key already captures everything in it).
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // Outer box: relative so the absolute SVG can fill it, clipped, with a pale
    // sky-like vertical gradient background.
    <div className={cn('relative overflow-hidden bg-gradient-to-b from-[#dce6f0] to-[#eef1f4]', className)}>
      {/* Ternary in JSX: picture if we have a URL, otherwise the placeholder. */}
      {url ? (
        // alt="" marks the image as decorative. It fades in and covers the box;
        // draggable={false} stops the browser's image drag ghost.
        <img src={url} alt="" className={cn('h-full w-full animate-fade-in object-cover', imgClassName)} draggable={false} />
      ) : (
        // Placeholder pulses while loading (`!failed` = not failed).
        <Silhouette floors={project.floors} pulse={!failed} />
      )}
    </div>
  )
}

/** A calm placeholder in the house's proportions while the picture is drawn. */
// Not exported: a private helper component used only in this file.
function Silhouette({ floors, pulse }) {
  // House height in SVG units: a base plus 14 per floor.
  const h = 22 + floors * 14
  return (
    // Inline SVG with a 160x100 coordinate system, stretched over the box.
    // `pulse && 'animate-pulse'` adds the class only when pulse is true (cn drops false).
    <svg viewBox="0 0 160 100" className={cn('absolute inset-0 h-full w-full', pulse && 'animate-pulse')} aria-hidden>
      {/* Ground strip along the bottom. */}
      <rect x="0" y="78" width="160" height="22" fill="#e3e1db" />
      {/* House body: its top is h units above the ground line; rx rounds the corners. */}
      <rect x="52" y={78 - h} width="56" height={h} rx="2" fill="#d9d6cf" />
      {/* Small block on the roof (e.g. a stair head / water tank). */}
      <rect x="92" y={78 - h - 8} width="14" height="8" fill="#d9d6cf" />
    </svg>
  )
}
