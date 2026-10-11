// HouseScene.jsx - the live, interactive 3D house.
//
// The live 3D house. <Scene> draws a built model at an animated build position
// (lights, ground, Elements, Workers, Neighborhood); <HouseScene> wraps it in a
// Canvas with orbit controls and a camera rig that re-frames when the plot
// changes. Also used headless by SnapshotRenderer.
//
// How it works:
//   - The model (from houseModel.js) is a list of boxes, each tagged with the
//     stage and slice of that stage during which it is built.
//   - useBuildPosition animates a number `pos` (e.g. 3.42 = stage 3, 42% done)
//     towards the `target` the page asks for. It lives in a ref, not React
//     state, so it can change 60 times a second without re-rendering React.
//   - Every frame, <Elements> scales each box along its growth axis according
//     to `pos`, and shows its blue blueprint outline while it is still to come.
//   - <Atmosphere> fades the sky, fog and ground from night-blue blueprint to
//     daylight as pos passes 1.0 - 1.3; <Neighborhood> and <Workers> also read pos.
//   - <HouseScene> adds the R3F <Canvas>, drei <OrbitControls> (drag to orbit,
//     wheel to zoom) and <CameraRig> (GSAP glide when the plot size changes),
//     and exposes resetView()/zoom() to parents through a ref.
// Exports: framing (camera placement), Scene (used by SnapshotRenderer), and
// the default HouseScene (loaded lazily by LazyHouseScene.jsx).
// Dependencies: React, @react-three/fiber, @react-three/drei, three (plus its
// RoomEnvironment example), ../lib/motion.js (gsap + reduced-motion check),
// ./textures.js, ./neighborhoodModel.js, ./Neighborhood.jsx, ./util.js, ./Workers.jsx.

// React APIs: forwardRef (lets a parent pass a ref into a function component), useEffect, useImperativeHandle
// (customise what that ref exposes), useMemo, useRef.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
// React Three Fiber: Canvas (the 3D viewport), useFrame (per-frame callback), useThree (access renderer state).
import { Canvas, useFrame, useThree } from '@react-three/fiber'
// drei is a helper library for R3F; OrbitControls lets the user rotate/zoom/pan the camera with the mouse.
import { OrbitControls } from '@react-three/drei'
// All of three.js as the THREE namespace.
import * as THREE from 'three'
// A ready-made virtual "room" scene from three's examples, used to generate soft reflections/lighting.
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
// gsap = the GSAP animation library; reduced() returns true if the user prefers reduced motion.
import { gsap, reduced } from '../lib/motion.js'
// Shared textures and the triplanar material patch.
import { getTextures, triplanar } from './textures.js'
// Generates the surrounding society data.
import { buildNeighborhood } from './neighborhoodModel.js'
// Default import (no braces): the component that draws that society.
import Neighborhood from './Neighborhood.jsx'
// Small maths/cleanup helpers.
import { clamp01, disposeAll, smooth } from './util.js'
// The animated site workers.
import Workers from './Workers.jsx'

/** Where the camera sits and looks for a model: across the street, a little to the right. */
// `distance = 1` is a default parameter (a zoom multiplier).
export function framing(model, distance = 1) {
  // Plot width, depth, overall height and plot centre z.
  const { w, d, h, cz } = model.bounds
  // A size measure for the scene: the larger plot side, times the zoom multiplier.
  const span = Math.max(w, d) * distance
  return {
    span,
    // Vector3(x, y, z): look at the plot centre, 20% of the way up the house.
    look: new THREE.Vector3(0, h * 0.2, cz),
    // Camera to the right (+x), above, and in front (+z, across the street).
    position: new THREE.Vector3(span * 0.85, h + span * 0.85, cz + span * 1.78),
  }
}

// Unit geometries shared by every element; each element is a scaled instance.
const GEO = {
  // 1 m cube.
  box: new THREE.BoxGeometry(1, 1, 1),
  // Cylinder radius 0.5 (1 m diameter), 1 m tall, 20 sides.
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  // Cone radius 0.5, 1 m tall, 24 sides (sand heap).
  cone: new THREE.ConeGeometry(0.5, 1, 24),
  // Low-poly ball (bushes, tree crowns).
  blob: new THREE.IcosahedronGeometry(0.5, 1),
}
// Outline geometries for the blueprint lines. EdgesGeometry keeps only the "hard" edges of a shape.
const EDGES = {
  box: new THREE.EdgesGeometry(GEO.box),
  // The 30 is a threshold angle (degrees): only edges between faces meeting at more than 30 degrees are kept,
  // so the cylinder's smooth sides don't produce lines.
  cyl: new THREE.EdgesGeometry(GEO.cyl, 30),
}
// Maps an axis letter to a vector component index (x = 0, y = 1, z = 2).
const AXIS = { x: 0, y: 1, z: 2 }

// [blueprint colour, daylight colour] pairs that are blended as day comes.
const COLORS = {
  // Dark navy night sky -> pale blue day sky.
  sky: ['#0a1f3c', '#dce6f0'],
  // Ground and soil: blueprint blue -> white (white = no tint over the texture).
  ground: ['#16365e', '#ffffff'],
  soil: ['#16365e', '#ffffff'],
  // Blueprint line colour: bright cyan at night -> deeper blue in daylight.
  line: ['#8fd0ff', '#3a7bd5'],
}

// Custom hook: creates every material the house uses, keyed by the `mat` names in houseModel.js.
function useMaterials() {
  // Built once per component instance (empty dependency list).
  const mats = useMemo(() => {
    const T = getTextures()
    // Shorthand for a physically based standard material.
    const std = (o) => new THREE.MeshStandardMaterial(o)
    // Shorthand for a triplanar-textured standard material; optional map2 = texture to cross-fade to.
    const tri = (o, map, scale, key, map2) => triplanar(std(o), { map, map2, scale, key })
    return {
      // Brickwork; fades to plaster during finishing (map2 = plaster). Texture repeats every 1.2 m.
      brick: tri({ roughness: 0.92 }, T.brick, 1 / 1.2, 'brick', T.plaster),
      // RCC concrete; also plastered over during finishing.
      concrete: tri({ roughness: 0.85 }, T.concrete, 1 / 2.2, 'concrete', T.plaster),
      // Boundary wall, already plastered.
      boundary: tri({ roughness: 0.92 }, T.plaster, 1 / 2.5, 'boundary'),
      // Stacked bricks on site (never plastered).
      brickStack: tri({ roughness: 0.92 }, T.brick, 1 / 1.2, 'stack'),
      // Excavation soil.
      soil: tri({ roughness: 1 }, T.soil, 1 / 1.5, 'soil'),
      // Sand heap: soil texture tinted sandy yellow, finer scale.
      sand: tri({ roughness: 1, color: '#f3dca6' }, T.soil, 1 / 0.8, 'sand'),
      // The large ground plane: earth texture repeating every 9 m.
      ground: tri({ roughness: 1 }, T.earth, 1 / 9, 'ground'),
      // Lawn.
      grass: tri({ roughness: 1 }, T.grass, 1 / 1.6, 'grass'),
      // Driveway paving.
      paving: tri({ roughness: 0.9 }, T.paving, 1 / 1.6, 'paving'),
      // Wooden doors.
      door: tri({ roughness: 0.6 }, T.wood, 1 / 1.1, 'door'),
      // Scaffold planks: pale tinted wood.
      plank: tri({ roughness: 0.8, color: '#e8cfa4' }, T.wood, 1 / 1.5, 'plank'),
      // Bamboo poles: yellowish wood.
      bamboo: tri({ roughness: 0.6, color: '#f2d79c' }, T.wood, 1 / 0.8, 'bamboo'),
      // Window glass: very smooth, metallic (strong reflections), 75% opaque (`transparent` must be true for opacity to work).
      glass: std({ color: '#9cc3e0', roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.75, envMapIntensity: 1.6 }),
      // Black plastic water tank.
      tank: std({ color: '#1d2733', roughness: 0.35, metalness: 0.1 }),
      // Garden bushes, faceted low-poly look.
      bush: std({ color: '#4f8a3a', roughness: 0.9, flatShading: true }),
      // Tree trunk.
      trunk: std({ color: '#5b4633', roughness: 0.9 }),
      // Steel gate.
      gate: std({ color: '#2b333b', roughness: 0.3, metalness: 0.85 }),
      // Blueprint outline lines: LineBasicMaterial draws unlit lines of one colour, semi-transparent.
      line: new THREE.LineBasicMaterial({ color: COLORS.line[0], transparent: true, opacity: 0.9 }),
    }
  }, [])
  // Materials belong to this scene; geometries and textures are shared by every scene on the page.
  // Effect with a cleanup function that frees the materials when the scene unmounts.
  useEffect(() => () => disposeAll(mats), [mats])
  return mats
}

/** Soft image-based lighting without downloading an HDR. */
// A component that renders nothing visible but configures the scene's environment lighting.
function Environment() {
  // useThree() with no selector returns the whole R3F state; destructure the renderer (gl) and scene.
  const { gl, scene } = useThree()
  useEffect(() => {
    // PMREMGenerator turns a scene/image into a pre-filtered environment map (blurred versions for
    // different roughness levels) that standard materials use for reflections and ambient light.
    const pmrem = new THREE.PMREMGenerator(gl)
    // Render the virtual RoomEnvironment into it (0.04 = blur amount); .texture is the result.
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    // Every standard material in the scene now picks up this lighting.
    scene.environment = env
    // Tone it down so it doesn't overpower the sun.
    scene.environmentIntensity = 0.55
    // Cleanup: remove and free the environment map and generator.
    return () => {
      scene.environment = null
      env.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])
  // Returning null renders nothing.
  return null
}

/**
 * Animates the displayed build position towards `target`. On mount and on
 * replay it starts from zero so the house draws itself, then builds up.
 * With `loop`, it keeps rebuilding the house as a showcase.
 */
function useBuildPosition(target, replayKey, loop, pace, instant) {
  // The current position, in a ref so per-frame changes don't trigger React re-renders.
  // Starts at the target when instant or the user prefers reduced motion; otherwise at 0 (blueprint).
  const pos = useRef(instant || reduced() ? target : 0)
  // Whether we are replaying (steady pace) rather than easing to a new target.
  const replaying = useRef(loop)
  // Seconds spent waiting at the end before a looped rebuild restarts.
  const hold = useRef(0)
  // Whenever replayKey changes (the parent bumps it to request a replay), restart from 0.
  useEffect(() => {
    if (replayKey > 0) {
      pos.current = 0
      replaying.current = true
    }
  }, [replayKey])
  // Per-frame update. `_` ignores the first argument (R3F state); dt = seconds since the last frame.
  useFrame((_, dt) => {
    // Cap dt at 0.1 s so a stalled tab doesn't jump the animation forward.
    dt = Math.min(dt, 0.1)
    // Instant mode: always sit exactly on the target.
    if (instant) {
      pos.current = target
      return
    }
    // Remaining distance (may be negative when going backwards).
    const d = target - pos.current
    // Close enough: snap onto the target.
    if (Math.abs(d) < 0.0005) {
      pos.current = target
      // In loop mode wait 3 seconds, then start again from 0.
      if (loop) {
        hold.current += dt
        if (hold.current > 3) {
          hold.current = 0
          pos.current = 0
        }
      // Not looping: the replay is over.
      } else replaying.current = false
      return
    }
    // Replays run at a steady pace; normal changes ease in quickly.
    // Replay: `pace` stages per second. Otherwise an exponential ease (1 - e^(-3 dt) of the remaining gap per frame),
    // but never slower than 0.15 stages per second.
    const step = replaying.current ? pace * dt : Math.max(Math.abs(d) * (1 - Math.exp(-dt * 3)), 0.15 * dt)
    // Move towards the target (Math.sign gives -1, 0 or 1) without overshooting it.
    pos.current += Math.sign(d) * Math.min(Math.abs(d), step)
  })
  // The ref is returned so children can read pos.current each frame.
  return pos
}

// Sky colour, fog, the ground plane (with a hole for the foundation pit) and the blueprint grid.
function Atmosphere({ model, mats, pos, extent }) {
  // Foundation pit dimensions from the model.
  const { pit } = model.bounds
  // Big plots get a bigger ground and push the haze back, so they never wash out.
  // S = ground plane size in metres: at least 600, or big enough to cover the neighbourhood.
  const S = Math.max(600, extent * 2.3)
  // Larger plot side.
  const span = Math.max(model.bounds.w, model.bounds.d)
  // Ref to the grid helper.
  const gridRef = useRef()
  // Reusable colour objects and a Fog, created once. Fog(color, near, far): objects fade into the colour
  // from `near` metres to fully hidden at `far`.
  const c = useMemo(() => ({ sky: new THREE.Color(), tmp: new THREE.Color(), fog: new THREE.Fog('#000', 55, 230) }), [])
  // Push the fog further out for big plots.
  useEffect(() => {
    c.fog.near = Math.max(55, span * 1.6)
    c.fog.far = Math.max(230, span * 6)
  }, [c, span])

  // Ground plane with a hole where the foundation pit is dug.
  // Four rectangles (in x/z) around the pit: behind, in front, left, right.
  const slabs = useMemo(() => {
    // Half the ground size.
    const h = S / 2
    return [
      { min: [-h, -h], max: [h, -pit.z] },
      { min: [-h, pit.z], max: [h, h] },
      { min: [-h, -pit.z], max: [-pit.x, pit.z] },
      { min: [pit.x, -pit.z], max: [h, pit.z] },
    ]
  }, [pit, S])

  // Each frame, blend night -> day. R3F passes its state; destructure `scene`.
  useFrame(({ scene }) => {
    // 0 during the blueprint, 1 once pos >= 1.3.
    const day = smooth(1.0, 1.3, pos.current)
    // Color.set sets from a CSS string; .lerp(other, t) blends towards `other` by t (linear interpolation).
    // Methods return the colour itself, so calls can be chained.
    c.sky.set(COLORS.sky[0]).lerp(c.tmp.set(COLORS.sky[1]), day)
    // The scene's background colour.
    scene.background = c.sky
    // Fog matches the sky so distant objects fade into it.
    c.fog.color.copy(c.sky)
    scene.fog = c.fog
    // Tint the ground and pit-soil materials from blueprint blue to white (untinted).
    mats.ground.color.set(COLORS.ground[0]).lerp(c.tmp.set(COLORS.ground[1]), day)
    mats.soil.color.set(COLORS.soil[0]).lerp(c.tmp.set(COLORS.soil[1]), day)
    // Fade the grid from 0.5 to 0.08 opacity as day comes.
    const g = gridRef.current
    if (g) g.material.opacity = 0.5 - 0.42 * day
  })

  return (
    <group>
      {/* One flat box per ground slab: centred between min and max, 0.1 m thick with its top at y = 0. */}
      {slabs.map((s, i) => (
        <mesh
          key={i}
          material={mats.ground}
          // receiveShadow: shadows from the house fall on it.
          receiveShadow
          // Centre position [x, y, z] of the slab.
          position={[(s.min[0] + s.max[0]) / 2, -0.05, (s.min[1] + s.max[1]) / 2]}
          // Scale the unit cube to the slab's size.
          scale={[s.max[0] - s.min[0], 0.1, s.max[1] - s.min[1]]}
          geometry={GEO.box}
          // Don't let R3F dispose the shared geometry/material on unmount.
          dispose={null}
        />
      ))}
      {/* Pit floor, visible once excavation removes the soil cover. */}
      <mesh material={mats.soil} receiveShadow geometry={GEO.box} position={[0, -pit.depth - 0.05, 0]} scale={[pit.x * 2, 0.1, pit.z * 2]} dispose={null} />
      {/* <gridHelper> = THREE.GridHelper: args = [size 240 m, 240 divisions (1 m squares), centre-line colour, grid colour].
          Dashed props like material-opacity set nested properties (gridHelper.material.opacity); a dashed prop with
          no value means true. depthWrite={false} keeps the see-through grid from hiding things drawn after it. */}
      <gridHelper ref={gridRef} args={[240, 240, '#5aa0e0', '#3f7fc0']} position={[0, 0.01, 0]} material-transparent material-opacity={0.5} material-depthWrite={false} />
    </group>
  )
}

// The house itself: one mesh (and one outline) per model element, animated every frame.
function Elements({ model, mats, pos, showBlueprint }) {
  // Arrays of the three.js objects, filled by callback refs below (index = element index).
  const meshes = useRef([])
  const lines = useRef([])
  // Two scratch colours for blending.
  const tmp = useMemo(() => ({ a: new THREE.Color(), b: new THREE.Color() }), [])

  useFrame(() => {
    // Current build position.
    const p = pos.current
    // Night -> day blend (0..1).
    const day = smooth(1.0, 1.3, p)
    // Plastering progress: 0 -> 1 over the first half of the finishing stage.
    const finish = smooth(0, 0.5, p - model.finishStage)

    // Cross-fade brick and concrete textures to plaster (the triplanar shader's uMix uniform).
    mats.brick.userData.uniforms.uMix.value = finish
    mats.concrete.userData.uniforms.uMix.value = finish
    // Blend the outline colour from night cyan to day blue and make it fainter in daylight.
    mats.line.color.copy(tmp.a.set(COLORS.line[0])).lerp(tmp.b.set(COLORS.line[1]), day)
    mats.line.opacity = 0.9 - 0.45 * day

    // Update every element.
    model.elements.forEach((e, i) => {
      // How built this element is: 0 before (stage + start), 1 after (stage + end), linear in between.
      const raw = clamp01((p - e.stage - e.start) / (e.end - e.start))
      // Inverted elements (the excavation soil) shrink instead of grow.
      let fill = e.invert ? 1 - raw : raw
      // Elements with a removal window (scaffolding, material stock) shrink away again during it. `*=` multiplies in place.
      if (e.outStage != null) fill *= 1 - clamp01((p - e.outStage - e.outStart) / (e.outEnd - e.outStart))
      // The mesh for this element (may be undefined before it mounts).
      const m = meshes.current[i]
      if (m) {
        // Only draw if it has any size.
        m.visible = fill > 0.001
        if (m.visible) {
          // Index of the axis it grows along.
          const ax = AXIS[e.grow]
          // Full size on all axes...
          m.scale.set(e.size[0], e.size[1], e.size[2])
          // ...then shrink the growth axis to the filled fraction (setComponent(index, value) sets x, y or z by index).
          m.scale.setComponent(ax, e.size[ax] * fill)
          // Reset the mesh offset inside its group (the group sits at the element centre)...
          m.position.set(0, 0, 0)
          // ...and shift it so it grows from one end (bottom/left/back) rather than from the middle.
          m.position.setComponent(ax, -e.size[ax] / 2 + (e.size[ax] * fill) / 2)
        }
      }
      // The outline for this element (absent for noGhost elements).
      const l = lines.current[i]
      if (l) {
        // Outline is drawn during the blueprint stage, then remains as a ghost
        // of everything still to be built.
        // Shown once the blueprint has reached it, until the element is fully built; after the blueprint
        // stage only if showBlueprint is on.
        l.visible = p >= e.bp && raw < 1 && (showBlueprint || p < 1)
      }
    })
  })

  // A component can return an array of elements. Each element becomes a group at its centre.
  return model.elements.map((e, i) => (
    <group key={e.key} position={e.center}>
      <mesh
        // Callback ref: store this mesh at index i.
        ref={(el) => (meshes.current[i] = el)}
        // Shared unit geometry for its shape, and its named material.
        geometry={GEO[e.shape]}
        material={mats[e.mat]}
        // `!` negates: cast shadows unless the element says noShadow.
        castShadow={!e.noShadow}
        receiveShadow
        // Hidden until the frame loop decides otherwise.
        visible={false}
        dispose={null}
      />
      {/* The blueprint outline, unless the element opts out. <lineSegments> = THREE.LineSegments
          (draws pairs of points as separate lines); scale makes the unit edges match the element size. */}
      {!e.noGhost && (
        <lineSegments
          ref={(el) => (lines.current[i] = el)}
          geometry={EDGES[e.shape]}
          material={mats.line}
          scale={e.size}
          visible={false}
          dispose={null}
        />
      )}
    </group>
  ))
}

/** Reports the animated build position to React in 0.02 steps, plus where it settles. */
function ProgressReporter({ pos, onProgress }) {
  // The last value sent to onProgress, and the value seen on the previous frame.
  const reported = useRef(-1)
  const prev = useRef(-1)
  useFrame(() => {
    const p = pos.current
    // The position didn't change since last frame, so the animation has settled.
    const settled = p === prev.current
    prev.current = p
    // Report when it has moved at least 0.02, or when it settled on a value not yet reported
    // (so the final value is always delivered). Throttling avoids re-rendering the page every frame.
    if (Math.abs(p - reported.current) >= 0.02 || (settled && p !== reported.current)) {
      reported.current = p
      onProgress(p)
    }
  })
  return null
}

// Shadow-map resolution (pixels per side) per quality level: bigger = sharper shadows but more GPU work.
const SHADOW_MAP = { full: 4096, preview: 2048, thumb: 2048 }

// The full scene (no canvas). Props are destructured with defaults, e.g. replayKey = 0.
export function Scene({ model, target, replayKey = 0, showBlueprint = true, loop = false, pace = 0.9, onProgress, instant = false, quality = 'full' }) {
  // Materials for this scene.
  const mats = useMaterials()
  // The animated build position ref.
  const pos = useBuildPosition(target, replayKey, loop, pace, instant)
  // The neighbourhood data, rebuilt only when the plot size changes (geometryKey).
  const hood = useMemo(() => buildNeighborhood(model.geometry), [model.geometryKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const { w, d } = model.bounds
  // Shadows cover the plot plus its immediate neighbours.
  const span = Math.max(w, d) * 1.6
  // Shadow map size; `??` falls back to 4096 for an unknown quality value.
  const map = SHADOW_MAP[quality] ?? 4096
  return (
    // A Fragment (<>...</>) returns several children without a wrapper object.
    <>
      {/* Soft reflected environment lighting. */}
      <Environment />
      {/* hemisphereLight: sky colour from above, ground colour from below, intensity 0.55 (args = constructor args). */}
      <hemisphereLight args={['#ffffff', '#b8a888', 0.55]} />
      {/* The sun: a directionalLight casting parallel rays and shadows. */}
      <directionalLight
        // Changing the key remounts the light when the shadow size changes (shadow maps can't be resized live).
        key={`${map}:${Math.round(span)}`}
        // Placed up and to the right-front; it shines towards the origin.
        position={[span * 0.8, span * 1.5, span * 0.9]}
        intensity={2.4}
        // Warm sunlight colour.
        color="#fff4e2"
        castShadow
        // Dashed props set nested fields: shadow-mapSize -> light.shadow.mapSize (resolution).
        shadow-mapSize={[map, map]}
        // The shadow camera is orthographic; these set the box (in metres) that receives shadows.
        shadow-camera-left={-span}
        shadow-camera-right={span}
        shadow-camera-top={span}
        shadow-camera-bottom={-span}
        // Small offsets that prevent "shadow acne" (stripy self-shadowing artefacts).
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* Sky, fog, ground and grid. */}
      <Atmosphere model={model} mats={mats} pos={pos} extent={hood.extent} />
      {/* The house elements; the key forces a fresh mount when the plot size or floor count changes. */}
      <Elements key={`${model.geometryKey}:${model.stageCount}`} model={model} mats={mats} pos={pos} showBlueprint={showBlueprint} />
      {/* The surrounding society. */}
      <Neighborhood data={hood} pos={pos} />
      {/* Site workers, also remounted when the model changes. */}
      <Workers key={`w-${model.geometryKey}:${model.stageCount}`} workers={model.workers} pos={pos} />
      {/* Only report progress if the parent asked for it. */}
      {onProgress && <ProgressReporter pos={pos} onProgress={onProgress} />}
    </>
  )
}

/**
 * Frames the plot. On the first frame it jumps there; when the plot changes
 * size afterwards it glides, keeping the viewer's angle, and stops if they
 * start dragging. The R3F camera prop only applies at mount, hence this.
 */
function CameraRig({ model, distance }) {
  // The active camera and the default controls (registered by <OrbitControls makeDefault>).
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  // Is this the first framing?
  const first = useRef(true)
  // Plot bounds used as effect dependencies.
  const { w, d, h, cz } = model.bounds
  useEffect(() => {
    // Controls not ready yet.
    if (!controls) return
    // Ideal look-at point and camera position.
    const { look, position } = framing(model, distance)
    // First time (or reduced motion): jump straight there.
    if (first.current || reduced()) {
      first.current = false
      camera.position.copy(position)
      // OrbitControls orbit around controls.target.
      controls.target.copy(look)
      // Apply the change.
      controls.update()
      // Remember this as the view reset() returns to.
      controls.saveState()
      return
    }
    // Keep the viewer's current viewing direction: the unit vector from target to camera
    // (clone() copies so the original isn't modified; sub subtracts; normalize scales to length 1).
    const dir = camera.position.clone().sub(controls.target).normalize()
    // New camera position: new look point plus that direction times the ideal distance.
    const to = look.clone().add(dir.multiplyScalar(position.distanceTo(look)))
    // A GSAP timeline groups tweens; onUpdate refreshes the controls each tick, onComplete saves the new reset view.
    const tl = gsap.timeline({ onUpdate: () => controls.update(), onComplete: () => controls.saveState() })
    // Tween the camera's x/y/z to `to` over 0.9 s with an ease-in-out curve; the final 0 = start at time 0.
    tl.to(camera.position, { x: to.x, y: to.y, z: to.z, duration: 0.9, ease: 'power2.inOut' }, 0)
    // At the same time, tween the orbit target to the new look point.
    tl.to(controls.target, { x: look.x, y: look.y, z: look.z, duration: 0.9, ease: 'power2.inOut' }, 0)
    // Stop the glide if the user starts dragging.
    const stop = () => tl.kill()
    controls.addEventListener('start', stop)
    // Cleanup: kill the animation and remove the listener.
    return () => {
      tl.kill()
      controls.removeEventListener('start', stop)
    }
  }, [controls, w, d, h, cz, distance]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

/**
 * Interactive 3D view of a house at a build position (stage units).
 * Exposes `resetView()` through the ref.
 */
// forwardRef(fn) passes the parent's ref as the second argument; the named function expression helps debugging.
const HouseScene = forwardRef(function HouseScene(
  // Props destructured with defaults (autoRotate, onProgress have none, so they may be undefined).
  { model, target, replayKey = 0, showBlueprint = true, autoRotate, loop = false, pace = 0.9, onProgress, interactive = true, wheelZoom = true, distance = 1, quality = 'full', paused = false },
  ref,
) {
  // Ref to the OrbitControls instance.
  const controls = useRef()
  // Looking in from across the street, slightly to the right, so the road,
  // the front yard and the facade all read at once.
  const { span, position } = framing(model, distance)
  // Defines the object the parent's ref receives.
  useImperativeHandle(
    ref,
    () => ({
      // Restore the saved view. `?.` skips the call if controls aren't ready.
      resetView: () => controls.current?.reset(),
      /** Move the camera towards (f < 1) or away from (f > 1) the target. */
      zoom: (f) => {
        const c = controls.current
        if (!c) return
        // Vector from the orbit target to the camera (c.object is the camera).
        const offset = c.object.position.clone().sub(c.target)
        // New distance, clamped between the controls' min and max distance.
        const len = Math.min(c.maxDistance, Math.max(c.minDistance, offset.length() * f))
        // Camera = target + offset resized to the new length.
        c.object.position.copy(c.target).add(offset.setLength(len))
        c.update()
      },
    }),
    // Empty deps: the handle is created once (it reads controls.current lazily).
    [],
  )

  return (
    <Canvas
      // Enable shadow rendering.
      shadows
      // Device pixel ratio range: up to 2x on sharp screens for full quality, 1.5x otherwise.
      dpr={quality === 'full' ? [1, 2] : [1, 1.5]}
      // 'never' stops rendering entirely while paused (saves battery); 'always' renders every frame.
      frameloop={paused ? 'never' : 'always'}
      // Initial camera: position as a plain [x, y, z] array, 36 degree field of view, far plane scaled with the plot.
      camera={{ position: position.toArray(), fov: 36, near: 0.1, far: Math.max(900, span * 12) }}
      // WebGL renderer options.
      gl={{ antialias: true }}
    >
      {/* The scene contents. */}
      <Scene model={model} target={target} replayKey={replayKey} showBlueprint={showBlueprint} loop={loop} pace={pace} onProgress={onProgress} quality={quality} />
      {/* Positions the camera when the plot changes. */}
      <CameraRig model={model} distance={distance} />
      {/* Mouse/touch camera controls. */}
      <OrbitControls
        ref={controls}
        // Register as the default controls so useThree((s) => s.controls) finds them.
        makeDefault
        // Smooth, inertial movement.
        enableDamping
        // Wheel zoom and panning only when interactive.
        enableZoom={interactive && wheelZoom}
        enablePan={interactive}
        // Slowly spin around the house if requested.
        autoRotate={autoRotate}
        autoRotateSpeed={0.6}
        // How close/far the camera may get (metres).
        minDistance={6}
        maxDistance={span * 4}
        // Don't let the camera go below the ground (just under 90 degrees from straight up).
        maxPolarAngle={Math.PI / 2.08}
      />
    </Canvas>
  )
})

// Default export, used by LazyHouseScene's lazy import.
export default HouseScene
