// Neighborhood.jsx - draws the surrounding society (roads, neighbour houses,
// trees, cars, lamps) around the project house.
//
// Draws the surrounding society built by neighborhoodModel.js as instanced
// meshes, one per material layer, rising out of the ground as the blueprint
// turns to day.
//
// How it works: neighborhoodModel.js produces plain data - for each "layer"
// (plaster, glass, asphalt, leaves, ...) a list of axis-aligned boxes given by
// their min/max corners. This component turns each layer into a single
// THREE.InstancedMesh: one geometry + one material drawn many times with a
// different transform per copy, which is far cheaper for the GPU than thousands
// of separate meshes. The whole group scales up from the ground (y) as the
// build position `pos` moves past 1.0.
// Where it's used: rendered inside HouseScene.jsx's <Scene>.
// Dependencies: React hooks, @react-three/fiber (useFrame), three,
// ./textures.js (shared textures + triplanar mapping), ./util.js (smooth).

// React hooks: useEffect (side effects after render), useLayoutEffect (same, but before the browser paints),
// useMemo (cache a computed value), useRef (a mutable box that persists between renders).
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
// useFrame registers a callback that R3F runs on every animation frame.
import { useFrame } from '@react-three/fiber'
// `import * as THREE` gathers every export of the three.js library into one object named THREE.
import * as THREE from 'three'
// getTextures returns the shared canvas-drawn textures; triplanar patches a material to map them by world position.
import { getTextures, triplanar } from './textures.js'
// Smoothstep helper (0..1 S-curve between two thresholds).
import { smooth } from './util.js'

// Shared unit-size geometries (the shape data sent to the GPU), created once for the whole page.
// Each instance is then stretched to its real size by its own scale.
const GEO = {
  // A 1 x 1 x 1 m cube (width, height, depth).
  box: new THREE.BoxGeometry(1, 1, 1),
  // A cylinder: top radius 0.5, bottom radius 0.5, height 1, 14 sides around.
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  // An icosahedron (20-sided ball) of radius 0.5, subdivided once - a lumpy low-poly blob for bushes/tree crowns.
  blob: new THREE.IcosahedronGeometry(0.5, 1),
}

// A custom hook (a function starting with `use` that calls other hooks): builds the materials for every layer.
function useLayers() {
  // useMemo with an empty dependency array [] runs the builder only once per component instance.
  const layers = useMemo(() => {
    // The shared textures (plaster, wood, brick, grass, ...), drawn once on 2D canvases.
    const T = getTextures()
    // Shorthand: make a MeshStandardMaterial (physically based: reacts to light with roughness/metalness) from options `o`.
    const std = (o) => new THREE.MeshStandardMaterial(o)
    // Shorthand: a standard material with a texture applied triplanar-style at the given scale (repeats per metre).
    // The key (as a template literal) identifies the shader variant so three.js can reuse compiled programs.
    const tri = (o, map, scale, key) => triplanar(std(o), { map, scale, key: `hood-${key}` })
    // One leaf material shared by hedges and tree crowns; flatShading gives the faceted low-poly look.
    const leaves = std({ roughness: 0.9, flatShading: true })
    // shape, material, casts shadow
    // Each entry is an array [shape key in GEO, material, castShadow?]. roughness 0 = mirror-smooth, 1 = matte;
    // metalness 0..1; colours are CSS hex strings; scale like 1 / 2.5 means the texture repeats every 2.5 m.
    return {
      // Neighbour house walls: plaster texture, repeats every 2.5 m.
      plaster: ['box', tri({ roughness: 0.9 }, T.plaster, 1 / 2.5, 'plaster'), true],
      // Light grey window and roof trim.
      trim: ['box', std({ color: '#dcd9d3', roughness: 0.7 }), true],
      // Dark shiny window glass; envMapIntensity strengthens sky reflections. No shadow.
      glass: ['box', std({ color: '#26323e', roughness: 0.12, metalness: 0.7, envMapIntensity: 1.3 }), false],
      // Wooden doors and fences.
      wood: ['box', tri({ roughness: 0.6 }, T.wood, 1 / 1.1, 'wood'), true],
      // Brick boundary walls.
      brick: ['box', tri({ roughness: 0.9 }, T.brick, 1 / 1.2, 'brick'), true],
      // Dark metal gates and railings.
      metal: ['box', std({ color: '#2b3036', roughness: 0.35, metalness: 0.8 }), true],
      // Rooftop water tanks (cylinders).
      tank: ['cyl', std({ color: '#1d2733', roughness: 0.4 }), true],
      // Lawns.
      grass: ['box', tri({ roughness: 1 }, T.grass, 1 / 1.6, 'grass'), false],
      // Driveways (paving texture).
      drive: ['box', tri({ roughness: 0.9 }, T.paving, 1 / 1.6, 'drive'), false],
      // Bare soil patches (empty plots).
      soilPatch: ['box', tri({ roughness: 1 }, T.soil, 1 / 1.5, 'soil'), false],
      // Hedges: leafy blobs.
      hedge: ['blob', leaves, true],
      // Tree crowns: leafy blobs.
      leaves: ['blob', leaves, true],
      // Tree trunks: brown cylinders.
      trunk: ['cyl', std({ color: '#5b4633', roughness: 0.9 }), true],
      // Street-lamp poles: grey metal cylinders.
      pole: ['cyl', std({ color: '#8d939a', roughness: 0.4, metalness: 0.6 }), true],
      // Lamp heads: `emissive` makes them glow on their own regardless of lighting.
      lamp: ['box', std({ color: '#fffaf0', emissive: '#fff1c9', emissiveIntensity: 0.7 }), false],
      // Road surface; texture repeats every 6 m.
      asphalt: ['box', tri({ roughness: 0.95 }, T.asphalt, 1 / 6, 'asphalt'), false],
      // White road markings.
      marking: ['box', std({ color: '#f1f1ee', roughness: 0.6 }), false],
      // Footpath paving.
      paving: ['box', tri({ roughness: 0.9 }, T.paving, 1 / 1.2, 'paving'), false],
      // Kerbs: concrete texture tinted light grey.
      curb: ['box', tri({ roughness: 0.85, color: '#e4e2dc' }, T.concrete, 1 / 2, 'curb'), false],
      // Car bodies: glossy paint; the actual colour comes per instance (setColorAt).
      car: ['box', std({ roughness: 0.25, metalness: 0.55 }), true],
      // Car windows.
      carGlass: ['box', std({ color: '#161c22', roughness: 0.08, metalness: 0.7 }), false],
      // Tyres (simple dark boxes).
      tyre: ['box', std({ color: '#141516', roughness: 0.9 }), true],
    }
  }, [])
  // Materials are per scene; the geometries and textures are shared by every scene on the page.
  // The effect returns a cleanup arrow function (run on unmount) that disposes each material.
  // `([, m])` destructures each [shape, material, cast] array, skipping the first item, to get the material.
  useEffect(() => () => Object.values(layers).forEach(([, m]) => m.dispose()), [layers])
  return layers
}

// Draws one layer: all its boxes as instances of one InstancedMesh.
function Layer({ items, shape, material, cast }) {
  // A ref will point at the three.js InstancedMesh object once React/R3F creates it.
  const ref = useRef()
  // useLayoutEffect runs synchronously after the mesh exists but before the frame is shown, so no flash of unplaced instances.
  useLayoutEffect(() => {
    // The actual THREE.InstancedMesh.
    const mesh = ref.current
    // Reusable scratch objects (avoid creating new ones per item):
    // Matrix4 = a 4x4 transform matrix (position + rotation + scale combined).
    const m = new THREE.Matrix4()
    // Quaternion = a rotation; new ones are the identity (no rotation), since all boxes are axis-aligned.
    const q = new THREE.Quaternion()
    // Vector3 for the centre position (x, y, z).
    const p = new THREE.Vector3()
    // Vector3 for the size/scale along each axis.
    const s = new THREE.Vector3()
    // A reusable THREE.Color.
    const c = new THREE.Color()
    // .some returns true if at least one item has a colour, i.e. this layer needs per-instance colours.
    const colored = items.some((it) => it.color)
    // forEach gives each item and its index i.
    items.forEach((it, i) => {
      // Centre of the box = midpoint of min and max on each axis (x width, y up, z depth).
      p.set((it.min[0] + it.max[0]) / 2, (it.min[1] + it.max[1]) / 2, (it.min[2] + it.max[2]) / 2)
      // Size = max - min on each axis; scaling the 1 m unit geometry by this gives the real size.
      s.set(it.max[0] - it.min[0], it.max[1] - it.min[1], it.max[2] - it.min[2])
      // compose builds the matrix from position, rotation and scale; setMatrixAt stores it for instance i.
      mesh.setMatrixAt(i, m.compose(p, q, s))
      // Per-instance colour (white = untinted when an item has none). c.set accepts a CSS colour string.
      if (colored) mesh.setColorAt(i, c.set(it.color ?? '#ffffff'))
    })
    // Tell three.js the matrix buffer changed so it re-uploads it to the GPU.
    mesh.instanceMatrix.needsUpdate = true
    // instanceColor only exists once setColorAt has been called; flag it for upload too.
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // Recompute the bounding sphere so frustum culling (skipping off-screen objects) covers all instances.
    mesh.computeBoundingSphere()
  }, [items])
  // R3F JSX: lowercase <instancedMesh> creates a THREE.InstancedMesh. `args` are the constructor arguments
  // (geometry, material, instance count). castShadow/receiveShadow control shadow casting/receiving.
  // dispose={null} stops R3F from disposing the shared geometry/material when this unmounts (we manage that).
  return <instancedMesh ref={ref} args={[GEO[shape], material, items.length]} castShadow={cast} receiveShadow dispose={null} />
}

/** The surrounding society. It rises out of the ground as the blueprint turns to day. */
// `data` is the output of neighborhoodModel.js; `pos` is a ref whose .current is the build position.
export default function Neighborhood({ data, pos }) {
  // The per-layer materials.
  const layers = useLayers()
  // Ref to the <group> holding every layer.
  const group = useRef()

  // Every frame, grow the neighbourhood with the build position.
  useFrame(() => {
    // The THREE.Group object.
    const g = group.current
    // 0 when pos <= 1.0, 1 when pos >= 1.35, smooth in between.
    const t = smooth(1.0, 1.35, pos.current)
    // Hide it completely when basically flat (saves drawing it).
    g.visible = t > 0.002
    // Stretch it vertically from the ground; never exactly 0 (a zero scale breaks the transform maths).
    g.scale.y = Math.max(0.001, t)
  })

  return (
    // <group> = THREE.Group, an empty container whose transform applies to its children. Starts hidden.
    <group ref={group} visible={false}>
      {/* Object.entries gives [key, value] pairs; .map turns each layer into a <Layer> element.
          `([key, items]) =>` destructures the pair in the arrow function's parameters. */}
      {Object.entries(data.layers).map(([key, items]) => {
        // Look up the shape/material/shadow settings for this layer name.
        const [shape, material, cast] = layers[key]
        // `key` is React's special prop for identifying list items between renders.
        return <Layer key={key} items={items} shape={shape} material={material} cast={cast} />
      })}
    </group>
  )
}
