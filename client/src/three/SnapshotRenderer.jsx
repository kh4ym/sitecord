// SnapshotRenderer.jsx - the off-screen picture taker for snapshots.js.
//
// Hidden 640x400 canvas that draws house pictures one job at a time for
// snapshots.js, and tears itself down after a few idle seconds to free the
// WebGL context.
//
// How it works: startRenderer() creates (on demand) a hidden <div> positioned
// far off-screen, mounts a separate React root into it with an R3F <Canvas>,
// and feeds it a queue of jobs. Each job renders the same <Scene> the live 3D
// view uses, waits a few frames for textures and shadows, then reads the canvas
// pixels out as a WebP data URL.
// Why: browsers limit how many WebGL contexts can exist at once, so all the
// project-card pictures share this single canvas instead of each having one.
// Where it's used: only imported dynamically by snapshots.js.
// Dependencies: React, react-dom/client (createRoot), @react-three/fiber,
// ./houseModel.js (buildHouseModel) and ./HouseScene.jsx (framing, Scene).

// Named imports of React hooks (functions starting with `use` that add state/effects to components).
import { useEffect, useMemo, useRef, useState } from 'react'
// createRoot mounts a brand-new, independent React tree into any DOM element.
import { createRoot } from 'react-dom/client'
// React Three Fiber (R3F): <Canvas> sets up a three.js renderer/scene/camera; useFrame runs code
// every animation frame; useThree reads the renderer state (camera, gl renderer, ...).
import { Canvas, useFrame, useThree } from '@react-three/fiber'
// Builds the list of house parts (boxes) for a given spec.
import { buildHouseModel } from './houseModel.js'
// framing() picks a camera position for a model; Scene draws the full lit, textured house.
import { framing, Scene } from './HouseScene.jsx'

// Milliseconds of idleness before the canvas is destroyed. `10_000` uses a numeric separator (= 10000).
const IDLE_MS = 10_000

/**
 * Returns render(spec) → Promise<image URL>. The hidden canvas that draws the
 * pictures starts on the first request and is torn down (freeing the WebGL
 * context) once it has been idle for a while. Throws when the device has no WebGL.
 */
export function startRenderer() {
  // A throwaway <canvas> element used only to test for WebGL support.
  const probe = document.createElement('canvas')
  // getContext returns null when unsupported; `||` tries WebGL 1 if WebGL 2 is missing.
  // `!(...)` is true when both failed, and `throw` raises an error that rejects the caller's promise.
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('No WebGL')

  // Jobs waiting to be drawn (an array used as a first-in, first-out queue).
  const queue = []
  // A Set of callback functions the mounted <Renderer> registers to hear "new job arrived".
  const listeners = new Set()
  // Holds the hidden div and React root while mounted, otherwise null.
  let mounted = null // { host, root }
  // The id of the idle timer from setTimeout, so it can be cancelled.
  let idle = null

  // Tear everything down - but only if mounted and no jobs are waiting.
  const stop = () => {
    if (!mounted || queue.length) return
    // Unmount the React tree (R3F disposes the WebGL renderer, freeing the context).
    mounted.root.unmount()
    // Remove the hidden div from the page.
    mounted.host.remove()
    mounted = null
  }
  // (Re)start the idle countdown: cancel any old timer, then schedule stop() after IDLE_MS.
  const touch = () => {
    clearTimeout(idle)
    idle = setTimeout(stop, IDLE_MS)
  }
  // Mount the hidden canvas if it isn't already.
  const start = () => {
    if (mounted) return
    // Create a <div> to host the canvas.
    const host = document.createElement('div')
    // Hide it from screen readers.
    host.setAttribute('aria-hidden', 'true')
    // Object.assign copies these style properties onto host.style: fixed far off-screen to the left,
    // a fixed 640x400 size, and ignoring the mouse.
    Object.assign(host.style, { position: 'fixed', left: '-10000px', top: '0', width: '640px', height: '400px', pointerEvents: 'none' })
    // Attach it to the page so the browser actually lays it out and the canvas has a size.
    document.body.appendChild(host)
    // Create a separate React root inside it.
    const root = createRoot(host)
    // Render the <Renderer> component, sharing the queue and listeners; it calls `touch` when idle.
    root.render(<Renderer queue={queue} listeners={listeners} onIdle={touch} />)
    // Shorthand object syntax: { host, root } means { host: host, root: root }.
    mounted = { host, root }
  }

  // The returned render function: spec in, Promise of an image URL out.
  return (spec) =>
    // `new Promise(executor)` creates a promise; we keep `resolve` so the job can finish it later.
    new Promise((resolve) => {
      // A job is arriving, so don't tear down.
      clearTimeout(idle)
      // Add the job. Math.random().toString(36) makes a random base-36 string; slice(2) drops the "0." prefix.
      queue.push({ id: Math.random().toString(36).slice(2), spec, resolve })
      // Make sure the canvas exists.
      start()
      // Notify the mounted Renderer (if any) that work is waiting; `l()` calls each listener.
      listeners.forEach((l) => l())
    })
}

// The React component living inside the hidden root. Props are destructured in the parameter list.
function Renderer({ queue, listeners, onIdle }) {
  // useState returns [value, setter]; array destructuring names them `job` and `setJob`. Starts as null.
  const [job, setJob] = useState(null)
  // useEffect runs after render; the [queue, listeners] array means "rerun only if these change".
  useEffect(() => {
    // Take the next job only if none is in progress. setJob(fn) passes the current value to fn.
    // `a ?? b` returns a unless it is null/undefined; queue.shift() removes the first job (undefined if empty).
    const next = () => setJob((current) => current ?? queue.shift() ?? null)
    // Register so startRenderer can wake us up.
    listeners.add(next)
    // Pick up any job already waiting.
    next()
    // The returned function is the cleanup, run on unmount: unregister.
    return () => listeners.delete(next)
  }, [queue, listeners])
  // Called by <Shot> with the picture URL when it has finished.
  const done = (url) => {
    // Fulfil the caller's promise.
    job.resolve(url)
    // Move to the next job, if any.
    const following = queue.shift() ?? null
    setJob(following)
    // Queue empty: start the idle countdown.
    if (!following) onIdle()
  }
  return (
    // <Canvas> from R3F: `shadows` (boolean prop) enables shadow maps; dpr={1.5} renders at 1.5x pixel density;
    // gl={{...}} configures the WebGL renderer - preserveDrawingBuffer keeps the pixels readable for toDataURL,
    // antialias smooths edges; camera={{...}} sets field of view (degrees) and near/far clip distances (metres).
    // The double braces are a JS object literal inside a JSX expression.
    <Canvas shadows dpr={1.5} gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ fov: 36, near: 0.1, far: 2000 }} style={{ width: 640, height: 400 }}>
      {/* `job && <Shot/>` renders Shot only when there is a job. key={job.id} gives every job a fresh
          Shot component (a new key makes React unmount the old one and mount a new one). */}
      {job && <Shot key={job.id} spec={job.spec} onDone={done} />}
    </Canvas>
  )
}

// Draws one picture: builds the model, aims the camera, waits a few frames, captures the canvas.
function Shot({ spec, onDone }) {
  // useMemo caches the result of the function until `spec` changes, so the model isn't rebuilt every render.
  const model = useMemo(() => buildHouseModel(spec), [spec])
  // useThree(selector) reads one piece of R3F state: the active camera...
  const camera = useThree((s) => s.camera)
  // ...and the three.js WebGLRenderer (`gl`).
  const gl = useThree((s) => s.gl)
  // useRef holds a mutable value ({ current: 0 }) that survives re-renders without causing them.
  const frames = useRef(0)
  // Aim the camera once the model is known.
  useEffect(() => {
    // framing() returns a camera position and a look-at point (both THREE.Vector3); 0.92 is the default zoom.
    const { position, look } = framing(model, spec.distance ?? 0.92)
    // Vector3.copy sets this vector's x, y, z from another.
    camera.position.copy(position)
    // Far clipping plane: things further than 2000 m are not drawn.
    camera.far = 2000
    // Rotate the camera so it points at `look`.
    camera.lookAt(look)
    // Required after changing camera settings like `far` so the projection is recalculated.
    camera.updateProjectionMatrix()
  }, [camera, model, spec.distance])
  // useFrame's callback runs once per rendered frame (about 60 times a second).
  useFrame(() => {
    // Count frames drawn so far.
    frames.current += 1
    // A few frames lets textures upload and shadows settle before the picture.
    // gl.domElement is the <canvas>; toDataURL encodes its pixels as a WebP image at 86% quality.
    if (frames.current === 6) onDone(gl.domElement.toDataURL('image/webp', 0.86))
  })
  // Render the shared Scene: `instant` (boolean prop) skips animations, quality="thumb" uses cheaper settings.
  return <Scene model={model} target={spec.position} instant quality="thumb" />
}
