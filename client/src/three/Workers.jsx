// Workers.jsx - animated low-poly construction workers on the building site.
//
// Low-poly site workers animated in one frame loop; each appears when the
// level it works on opens up at the current build position.
//
// How it works: each worker is a small hierarchy of boxes and spheres (legs,
// vest/torso, arms, head, hard hat) built in JSX. Legs and arms are wrapped in
// <group>s positioned at the hip/shoulder so rotating the group swings the limb
// like a joint. A single useFrame loop then moves every worker: walkers pace
// back and forth along x, hammerers swing an arm, others stand and look around.
// The worker list (position, action, colours, the build range [from, to) in
// which they are visible) comes from houseModel.js.
// Where it's used: rendered inside HouseScene.jsx's <Scene>.
// Dependencies: React hooks, @react-three/fiber (useFrame), three, ./util.js (disposeAll).

// React hooks: useEffect for cleanup, useMemo for caching values between renders.
import { useEffect, useMemo } from 'react'
// useFrame: run a callback on every rendered frame.
import { useFrame } from '@react-three/fiber'
// The whole three.js library as the namespace object THREE.
import * as THREE from 'three'
// Helper that disposes every material in an object.
import { disposeAll } from './util.js'

// Low-poly site workers: hard hat, hi-vis vest, simple limb rigs. One frame
// loop animates all of them and pops each in or out as its level opens up.

// Shared geometries, created once at module load and reused by every worker.
// A 1 m unit cube; each body part scales it to size.
const BOX = new THREE.BoxGeometry(1, 1, 1)
// Head: a sphere of radius 0.115 m with 16 segments around and 12 from top to bottom.
const HEAD = new THREE.SphereGeometry(0.115, 16, 12)
// Hard hat dome: SphereGeometry(radius, widthSegs, heightSegs, phiStart, phiLength, thetaStart, thetaLength).
// phi 0..2*PI goes all the way around; theta 0..PI/2 covers only the top half, giving a dome.
const HAT = new THREE.SphereGeometry(0.145, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2)
// Hat brim: a very flat cylinder (radius 0.18 top and bottom, 0.02 m tall, 20 sides).
const BRIM = new THREE.CylinderGeometry(0.18, 0.18, 0.02, 20)

// Custom hook creating the worker materials once per scene and disposing them on unmount.
function useWorkerMaterials() {
  // Build the materials once ([] = no dependencies, never rebuilt).
  const mats = useMemo(() => {
    // Helper: a MeshStandardMaterial with a colour, roughness 0.75 by default, plus any `extra` options.
    // `...extra` spreads the extra object's properties in (and overrides roughness if it sets one);
    // spreading undefined is allowed and adds nothing.
    const m = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra })
    return {
      // Skin tone for heads and hands.
      skin: m('#b97b52'),
      // Blue shirt sleeves.
      shirt: m('#3d5a80'),
      // Dark trousers.
      pants: m('#2b2f36'),
      // Orange hi-vis vest; a little `emissive` glow keeps it bright in shadow.
      orange: m('#ff7a1a', { emissive: '#ff5a00', emissiveIntensity: 0.12 }),
      // Lime hi-vis vest.
      lime: m('#c6f432', { emissive: '#a0d000', emissiveIntensity: 0.1 }),
      // Yellow hard hat, shinier (lower roughness).
      yellow: m('#ffc928', { roughness: 0.35 }),
      // White hard hat.
      white: m('#f4f4f2', { roughness: 0.35 }),
      // Hammer: dark metal.
      tool: m('#3a3a3a', { metalness: 0.6, roughness: 0.4 }),
      // A carried brick.
      brick: m('#b4532a'),
    }
  }, [])
  // Cleanup on unmount: free the materials' GPU resources. `() => () => ...` = an effect that returns a cleanup.
  useEffect(() => () => disposeAll(mats), [mats])
  return mats
}

// One worker figure. `refs` is a plain object where this component stores its three.js parts for animation.
function Worker({ spec, mats, refs }) {
  // A function returning a "callback ref": React calls (el) => ... with the three.js object once created,
  // and we save it as refs[key] (e.g. refs.root, refs.legL). This is a function that returns a function (currying).
  const part = (key) => (el) => (refs[key] = el)
  return (
    // The worker's root group: placed at spec.pos [x, y, z], turned by spec.rot radians about the vertical axis.
    // `rotation-y` is an R3F dashed prop: it sets the nested property object.rotation.y. Hidden until animated in.
    <group ref={part('root')} position={spec.pos} rotation-y={spec.rot} visible={false}>
      {/* Two legs: map over [-1, 1] for left (-1) and right (+1). `(s) => (...)` returns JSX directly. */}
      {[-1, 1].map((s) => (
        // Hip joint group, 0.1 m left/right of centre, 0.85 m up. The ternary picks the ref name.
        <group key={s} ref={part(s < 0 ? 'legL' : 'legR')} position={[s * 0.1, 0.85, 0]}>
          {/* The leg box hangs down from the hip (centre 0.425 m below), so rotating the group swings it.
              geometry/material props reuse shared objects; castShadow makes it throw a shadow;
              dispose={null} stops R3F disposing the shared geometry/material on unmount. */}
          <mesh geometry={BOX} material={mats.pants} scale={[0.15, 0.85, 0.17]} position={[0, -0.425, 0]} castShadow dispose={null} />
        </group>
      ))}
      {/* Torso / hi-vis vest; `mats[spec.vest]` uses bracket notation to pick the material named by spec.vest ('orange' or 'lime'). */}
      <mesh geometry={BOX} material={mats[spec.vest]} scale={[0.44, 0.62, 0.26]} position={[0, 1.16, 0]} castShadow dispose={null} />
      {/* Two arms, with shoulder joints 0.29 m either side at 1.43 m height. */}
      {[-1, 1].map((s) => (
        // Shoulder joint group: rotating it about x swings the arm forward/back.
        <group key={s} ref={part(s < 0 ? 'armL' : 'armR')} position={[s * 0.29, 1.43, 0]}>
          {/* Sleeve hanging down from the shoulder. */}
          <mesh geometry={BOX} material={mats.shirt} scale={[0.12, 0.58, 0.13]} position={[0, -0.27, 0]} castShadow dispose={null} />
          {/* Hand: a small skin-coloured cube at the end of the arm. */}
          <mesh geometry={BOX} material={mats.skin} scale={[0.1, 0.1, 0.1]} position={[0, -0.6, 0]} dispose={null} />
          {/* Right arm (s > 0) of a hammering worker also holds a hammer. `a && b` renders b only if a is true. */}
          {s > 0 && spec.action === 'hammer' && (
            // `<>...</>` is a Fragment: groups siblings without adding an extra object to the scene.
            <>
              {/* Hammer handle, pointing forward (+z) from the hand. */}
              <mesh geometry={BOX} material={mats.tool} scale={[0.04, 0.04, 0.32]} position={[0, -0.62, 0.14]} dispose={null} />
              {/* Hammer head at the end of the handle. */}
              <mesh geometry={BOX} material={mats.tool} scale={[0.07, 0.13, 0.07]} position={[0, -0.62, 0.3]} dispose={null} />
            </>
          )}
        </group>
      ))}
      {/* Carrying workers hold a brick in front of the chest (+z is forward). */}
      {spec.action === 'carry' && (
        <mesh geometry={BOX} material={mats.brick} scale={[0.36, 0.16, 0.22]} position={[0, 1.08, 0.36]} castShadow dispose={null} />
      )}
      {/* Head, 1.6 m up. */}
      <mesh geometry={HEAD} material={mats.skin} position={[0, 1.6, 0]} castShadow dispose={null} />
      {/* Hard hat dome, slightly squashed vertically (scale y 0.85), colour from spec.helmet. */}
      <mesh geometry={HAT} material={mats[spec.helmet]} position={[0, 1.64, 0]} scale={[1, 0.85, 1]} castShadow dispose={null} />
      {/* Hat brim, nudged slightly forward. */}
      <mesh geometry={BRIM} material={mats[spec.helmet]} position={[0, 1.645, 0.02]} dispose={null} />
    </group>
  )
}

// All workers. `workers` is the array of worker specs; `pos` is a ref holding the current build position.
export default function Workers({ workers, pos }) {
  // Shared materials.
  const mats = useWorkerMaterials()
  // One "rig" object per worker: s = current pop-in scale (0..1); Worker fills in root/legL/armR... via refs.
  // `() => ({ s: 0 })` - parentheses around braces make the arrow return an object literal.
  const rigs = useMemo(() => workers.map(() => ({ s: 0 })), [workers])

  // Per-frame animation. R3F passes the state object (destructured to get `clock`) and dt = seconds since last frame.
  useFrame(({ clock }, dt) => {
    // Current build position.
    const p = pos.current
    // Seconds since the scene started.
    const time = clock.elapsedTime
    workers.forEach((w, i) => {
      // This worker's rig (scene objects + pop scale).
      const r = rigs[i]
      // Not mounted yet: skip (return inside forEach just moves on to the next worker).
      if (!r.root) return
      // Target scale: 1 if the build position is inside [w.from, w.to), else 0.
      const want = p >= w.from && p < w.to ? 1 : 0
      // Ease towards the target: move a fraction of the remaining gap each frame (frame-rate independent via dt).
      r.s += (want - r.s) * Math.min(1, dt * 7)
      // Practically gone: hide and stop.
      if (r.s < 0.01) {
        r.root.visible = false
        return
      }
      r.root.visible = true
      // Slight overshoot when popping in.
      // sin(s * PI) peaks at s = 0.5, adding up to 15% extra size mid-way, giving a little bounce.
      const pop = r.s * (1 + 0.15 * Math.sin(r.s * Math.PI))
      // setScalar sets x, y and z scale to the same value.
      r.root.scale.setScalar(pop)

      // Each worker's own animation clock: individual speed plus a phase offset so they aren't in sync.
      const t = time * w.speed + w.phase
      // Limb angles (radians) for this frame; `let` because they are set in the branches below.
      let leg = 0
      let armL = 0
      let armR = 0
      // `||` = logical OR. Walking and carrying workers pace back and forth.
      if (w.action === 'walk' || w.action === 'carry') {
        // Array destructuring: the x range they walk between.
        const [x0, x1] = w.range
        // Length of the walk (never 0, to avoid dividing by zero below).
        const len = Math.max(0.01, x1 - x0)
        // `%` is the remainder operator: d loops 0 .. 2*len, one full there-and-back trip.
        const d = (t * 0.9) % (2 * len)
        // First half of the loop = walking forward (+x).
        const forward = d < len
        // Position along x: going out from x0, or coming back from x1.
        r.root.position.x = forward ? x0 + d : x1 - (d - len)
        // Direction to face: +90 degrees (PI/2 radians) when heading +x, -90 when heading back.
        const face = forward ? Math.PI / 2 : -Math.PI / 2
        // Turn smoothly towards that direction rather than snapping.
        r.root.rotation.y += (face - r.root.rotation.y) * Math.min(1, dt * 8)
        // Legs swing with a sine wave (±0.5 rad).
        leg = Math.sin(t * 9) * 0.5
        // Carrying: both arms held forward; walking: arms swing opposite to the legs.
        armL = w.action === 'carry' ? -1.1 : -leg * 0.8
        armR = w.action === 'carry' ? -1.1 : leg * 0.8
      } else if (w.action === 'hammer') {
        // Right arm raised and chopping up and down.
        armR = -1.5 + Math.sin(t * 7) * 0.7
        // Left arm steady, slightly forward.
        armL = -0.5
        // A tiny bounce with each strike (only the positive half of the sine).
        r.root.position.y = w.pos[1] + Math.max(0, Math.sin(t * 7)) * 0.02
      } else {
        // Standing/inspecting: slowly turn the body left and right.
        r.root.rotation.y = w.rot + Math.sin(t * 0.5) * 0.5
        // Relaxed left arm.
        armL = -0.25
        // Right arm raised as if holding a clipboard, with a gentle sway.
        armR = -0.9 + Math.sin(t * 0.8) * 0.1
      }
      // Apply the angles: rotation about x swings a limb forward/back. Legs move in opposite directions.
      r.legL.rotation.x = leg
      r.legR.rotation.x = -leg
      r.armL.rotation.x = armL
      r.armR.rotation.x = armR
    })
  })

  // A component may return an array of elements; each needs a unique `key` (the index is fine here, the list is fixed).
  return workers.map((w, i) => <Worker key={i} spec={w} mats={mats} refs={rigs[i]} />)
}
