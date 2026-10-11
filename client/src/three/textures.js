// textures.js - procedural surface textures and the triplanar shader patch.
//
// Procedural, tileable surface textures drawn on canvas at startup, so the
// app ships no image assets. Each texture tiles seamlessly in both directions.
//
// What it does:
//   - getTextures(): draws brick, plaster, concrete, soil, earth, grass, wood,
//     paving and asphalt onto off-screen 2D <canvas> elements (once per page)
//     and wraps each in a THREE.CanvasTexture that the GPU can sample.
//   - triplanar(material, opts): patches a three.js material's shader so the
//     texture is projected by world position instead of the mesh's UVs. Every
//     house part is a stretched unit box, so this keeps bricks brick-sized.
// Where it's used: HouseScene.jsx (house materials) and Neighborhood.jsx.
// Dependencies: three, ./util.js (rng for repeatable randomness), the browser's
// canvas 2D drawing API.

// The whole three.js library as the namespace object THREE.
import * as THREE from 'three'
// Seeded random number generator, so textures look identical on every load.
import { rng } from './util.js'

// Creates a square canvas of `size` px, lets `draw(ctx, size)` paint on it, and returns a texture.
function make(size, draw) {
  // An in-memory <canvas> element (never added to the page).
  const canvas = document.createElement('canvas')
  // Chained assignment: height = size, then width = that same value.
  canvas.width = canvas.height = size
  // The 2D drawing context: the object with fillRect, arc, lineTo, etc.
  const ctx = canvas.getContext('2d')
  // Run the caller's drawing function (a callback) on it.
  draw(ctx, size)
  // CanvasTexture: a three.js texture whose image is the canvas.
  const tex = new THREE.CanvasTexture(canvas)
  // wrapS/wrapT = horizontal/vertical wrapping; RepeatWrapping tiles the image endlessly.
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  // The canvas colours are sRGB (normal screen colours); tell three.js so lighting maths stay correct.
  tex.colorSpace = THREE.SRGBColorSpace
  // Anisotropic filtering keeps the texture sharp when viewed at a glancing angle (e.g. the ground).
  tex.anisotropy = 8
  return tex
}

/** Per-pixel grain: shifts every pixel's brightness by ±amount. */
function grain(ctx, size, amount, seed) {
  // A seeded random function.
  const r = rng(seed)
  // Read back all the pixels drawn so far as an ImageData object.
  const img = ctx.getImageData(0, 0, size, size)
  // img.data is a flat Uint8ClampedArray: [R, G, B, A, R, G, B, A, ...], values clamped to 0..255.
  const d = img.data
  // A classic for loop: start i at 0, keep going while i < length, step 4 at a time (one pixel per step).
  for (let i = 0; i < d.length; i += 4) {
    // Random offset between -amount/2 and +amount/2.
    const n = (r() - 0.5) * amount
    // Add it to red, green and blue (alpha d[i + 3] untouched), keeping the hue but changing brightness.
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  // Write the modified pixels back onto the canvas at (0, 0).
  ctx.putImageData(img, 0, 0)
}

/** Soft blotches drawn with wrap-around so the tile stays seamless. */
function blotches(ctx, size, count, color, maxR, seed) {
  const r = rng(seed)
  // Draw `count` blotches.
  for (let i = 0; i < count; i++) {
    // Random centre anywhere on the tile.
    const x = r() * size
    const y = r() * size
    // Random radius between 30% and 100% of maxR.
    const rad = maxR * (0.3 + r() * 0.7)
    // `for...of` loops over array values. Drawing each blotch 9 times, shifted by a tile width/height
    // in every direction, means a blotch crossing an edge reappears on the opposite edge: seamless tiling.
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        // A radial gradient from radius 0 to `rad` around the (shifted) centre.
        const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad)
        // Colour at the centre...
        g.addColorStop(0, color)
        // ...fading to fully transparent at the edge.
        g.addColorStop(1, 'rgba(0,0,0,0)')
        // Use the gradient as the fill "paint".
        ctx.fillStyle = g
        // Fill the square that contains the circle (outside the radius it is transparent).
        ctx.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2)
      }
    }
  }
}

// Draws every texture. Called once, lazily, by getTextures().
function createTextures() {
  // 512 px = 1.2 m of 9-inch brickwork: 14 courses, 5 bricks per course.
  // make(size, callback): the arrow function receives the context and size (named `s`).
  const brick = make(512, (ctx, s) => {
    const r = rng(7)
    // Mortar colour as the background...
    ctx.fillStyle = '#c9baa5'
    // ...filling the whole tile.
    ctx.fillRect(0, 0, s, s)
    // Number of brick rows (courses) and bricks per row.
    const rows = 14
    const per = 5
    // Height and width of one brick slot in pixels.
    const h = s / rows
    const w = s / per
    for (let row = 0; row < rows; row++) {
      // Odd rows shift by half a brick (stretcher bond). `row % 2` is 1 (truthy) for odd rows.
      const off = row % 2 ? w / 2 : 0
      // Start at -1 so the shifted rows have no gap at the left edge.
      for (let i = -1; i < per; i++) {
        // Random brightness factor 0.82..1.12 so each brick differs.
        const shade = 0.82 + r() * 0.3
        // Math.round gives whole-number colour channels for a reddish brick.
        const red = Math.round(168 * shade)
        const green = Math.round(78 * shade + r() * 10)
        const blue = Math.round(46 * shade)
        // Template literal builds a CSS colour string like "rgb(150,70,41)".
        ctx.fillStyle = `rgb(${red},${green},${blue})`
        // The brick, inset 2 px on each side so mortar lines show between bricks.
        ctx.fillRect(i * w + off + 2, row * h + 2, w - 4, h - 4)
        // Darker burnt edge on some bricks.
        // About 25% of bricks (r() < 0.25) get a dark translucent strip along their bottom.
        if (r() < 0.25) {
          ctx.fillStyle = 'rgba(60,20,10,0.18)'
          ctx.fillRect(i * w + off + 2, row * h + h - 7, w - 4, 5)
        }
      }
    }
    // Add fine noise over everything.
    grain(ctx, s, 26, 11)
  })

  // Off-white wall plaster: flat base, faint warm stains and lighter patches, light grain.
  const plaster = make(512, (ctx, s) => {
    ctx.fillStyle = '#f1ece3'
    ctx.fillRect(0, 0, s, s)
    // rgba(...) colour with alpha (opacity) 0.025 - very faint.
    blotches(ctx, s, 26, 'rgba(160,140,110,0.025)', 140, 3)
    blotches(ctx, s, 30, 'rgba(255,255,255,0.06)', 90, 4)
    grain(ctx, s, 9, 5)
  })

  // Grey cast concrete (frame columns, slabs, kerbs).
  const concrete = make(512, (ctx, s) => {
    const r = rng(21)
    ctx.fillStyle = '#b2b5b8'
    ctx.fillRect(0, 0, s, s)
    // Darker and lighter patches.
    blotches(ctx, s, 30, 'rgba(70,75,80,0.10)', 120, 22)
    blotches(ctx, s, 20, 'rgba(255,255,255,0.12)', 100, 23)
    // Formwork joints and tiny air pores.
    // A 2 px horizontal line across the middle: a shuttering joint.
    ctx.fillStyle = 'rgba(60,64,70,0.18)'
    ctx.fillRect(0, s / 2, s, 2)
    // 260 small dark dots.
    for (let i = 0; i < 260; i++) {
      // Random opacity 0.2..0.5 inserted into the colour string.
      ctx.fillStyle = `rgba(50,50,55,${0.2 + r() * 0.3})`
      // Start a new path (shape outline).
      ctx.beginPath()
      // arc(x, y, radius, startAngle, endAngle): a full circle is 0 to 2*PI radians.
      ctx.arc(r() * s, r() * s, 0.6 + r() * 1.6, 0, Math.PI * 2)
      // Fill the circle.
      ctx.fill()
    }
    grain(ctx, s, 22, 24)
  })

  // Brown dug soil (excavation, empty plots).
  const soil = make(256, (ctx, s) => {
    const r = rng(31)
    ctx.fillStyle = '#8c6c4b'
    ctx.fillRect(0, 0, s, s)
    blotches(ctx, s, 24, 'rgba(60,40,25,0.25)', 60, 32)
    // 300 tiny pebbles/specks, half light, half dark (ternary picks the colour).
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(200,170,130,0.5)' : 'rgba(50,35,20,0.5)'
      ctx.fillRect(r() * s, r() * s, 1 + r() * 2.5, 1 + r() * 2.5)
    }
    grain(ctx, s, 40, 33)
  })

  // Pale sandy earth (the site ground).
  const earth = make(512, (ctx, s) => {
    const r = rng(41)
    ctx.fillStyle = '#c9bea6'
    ctx.fillRect(0, 0, s, s)
    // Brownish and slightly greenish patches.
    blotches(ctx, s, 40, 'rgba(140,120,85,0.07)', 150, 42)
    blotches(ctx, s, 26, 'rgba(120,140,80,0.05)', 90, 43)
    // 500 small specks.
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(255,250,235,0.3)' : 'rgba(90,75,50,0.2)'
      ctx.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2)
    }
    grain(ctx, s, 18, 44)
  })

  // Lawn: green base covered with thousands of short blade strokes.
  const grass = make(256, (ctx, s) => {
    const r = rng(51)
    ctx.fillStyle = '#5f9a45'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 2600; i++) {
      // Random blade root position and length (3..9 px).
      const x = r() * s
      const y = r() * s
      const l = 3 + r() * 6
      // strokeStyle = line colour: a light or dark green with random opacity.
      ctx.strokeStyle = r() < 0.5 ? `rgba(140,200,90,${0.3 + r() * 0.4})` : `rgba(40,90,30,${0.3 + r() * 0.4})`
      // Line thickness in pixels.
      ctx.lineWidth = 1
      ctx.beginPath()
      // Move the pen to the blade root without drawing...
      ctx.moveTo(x, y)
      // ...then a line upward (canvas y grows downward, so y - l is up) with a slight random lean.
      ctx.lineTo(x + (r() - 0.5) * 3, y - l)
      // Draw the line.
      ctx.stroke()
    }
  })

  // Wood: brown base with 70 wavy vertical grain lines.
  const wood = make(256, (ctx, s) => {
    const r = rng(61)
    ctx.fillStyle = '#7a5434'
    ctx.fillRect(0, 0, s, s)
    for (let i = 0; i < 70; i++) {
      // Horizontal position of this grain line.
      const x = r() * s
      // Dark or light grain, random opacity.
      ctx.strokeStyle = r() < 0.5 ? `rgba(40,22,10,${0.15 + r() * 0.25})` : `rgba(180,130,85,${0.12 + r() * 0.2})`
      // Random thickness 0.6..2.6 px.
      ctx.lineWidth = 0.6 + r() * 2
      ctx.beginPath()
      // Single-statement loop (no braces): step down the tile 8 px at a time, adding points that wiggle
      // sideways by a sine wave. Exactly 2 full waves over the tile height so the top and bottom match (seamless).
      for (let y = 0; y <= s; y += 8) ctx.lineTo(x + Math.sin((y / s) * Math.PI * 2 * 2 + i) * 3, y)
      ctx.stroke()
    }
    grain(ctx, s, 14, 62)
  })

  // Paving slabs: a 4 x 4 grid of light stone tiles with dark joints.
  const paving = make(256, (ctx, s) => {
    const r = rng(71)
    // Joint colour background.
    ctx.fillStyle = '#9c968b'
    ctx.fillRect(0, 0, s, s)
    // Tiles per side and tile size in px.
    const n = 4
    const t = s / n
    // Nested loops over columns i and rows j.
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        // A random light grey level 196..220 per slab.
        const v = 196 + Math.round(r() * 24)
        // Warm it slightly by lowering green and blue.
        ctx.fillStyle = `rgb(${v},${v - 6},${v - 16})`
        // The slab, inset 2 px to leave joints.
        ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4)
      }
    }
    grain(ctx, s, 16, 72)
  })

  // Asphalt road: dark grey with patches and lots of light/dark aggregate specks.
  const asphalt = make(512, (ctx, s) => {
    const r = rng(81)
    ctx.fillStyle = '#4a4d52'
    ctx.fillRect(0, 0, s, s)
    blotches(ctx, s, 30, 'rgba(25,27,30,0.12)', 120, 82)
    blotches(ctx, s, 14, 'rgba(160,160,160,0.05)', 160, 83)
    for (let i = 0; i < 2600; i++) {
      ctx.fillStyle = r() < 0.5 ? `rgba(170,170,170,${0.15 + r() * 0.25})` : `rgba(20,20,22,${0.2 + r() * 0.3})`
      ctx.fillRect(r() * s, r() * s, 1 + r() * 1.8, 1 + r() * 1.8)
    }
    grain(ctx, s, 22, 84)
  })

  // Shorthand object: { brick } means { brick: brick }, etc.
  return { brick, plaster, concrete, soil, earth, grass, wood, paving, asphalt }
}

// Module-level cache of the texture set (null until first requested).
let shared = null
/** Textures are created once and shared by every scene on the page. */
// `??=` assigns createTextures() only when `shared` is still null; the parenthesised expression's
// value (the texture set) is what the arrow function returns.
export const getTextures = () => (shared ??= createTextures())

/**
 * Triplanar mapping: sample the texture by world position, projected along the
 * dominant face normal. Every element is a stretched unit box, so ordinary UVs
 * would smear; world-space projection keeps bricks brick-sized at any scale.
 * Optional `map2` + uniform `uMix` cross-fades to a second texture (brick → plaster).
 */
// The second parameter is destructured from an options object; `scale = 1` is a default value.
export function triplanar(material, { map, map2, scale = 1, key }) {
  // Shader "uniforms": values passed from JavaScript to the GPU program, same for every pixel.
  // Each is wrapped in { value } so changing .value later updates the shader without recompiling.
  const uniforms = {
    // The main texture.
    tMap: { value: map },
    // The second texture to fade to; falls back to the main one if none was given.
    tMap2: { value: map2 ?? map },
    // Texture repeats per metre.
    uScale: { value: scale },
    // Blend amount between tMap (0) and tMap2 (1).
    uMix: { value: 0 },
  }
  // userData is a free-form object on every three.js object; store the uniforms so other code
  // (HouseScene) can animate uMix later.
  material.userData.uniforms = uniforms
  // three.js caches compiled shader programs; this key makes each triplanar variant its own program.
  material.customProgramCacheKey = () => `triplanar-${key}`
  // onBeforeCompile is a hook three.js calls with the shader source just before compiling it on the GPU,
  // letting us edit the GLSL (shader language) text with string replacements.
  material.onBeforeCompile = (shader) => {
    // Make our uniforms available to the shader.
    Object.assign(shader.uniforms, uniforms)
    // Vertex shader (runs per corner of each triangle). Two string .replace() calls, chained:
    // 1) after the `#include <common>` chunk, declare two `varying`s - values passed from the vertex
    //    shader to the fragment shader: the world position (vTriPos) and world normal (vTriNormal).
    // 2) after `#include <worldpos_vertex>`, compute them: take the vertex position (`transformed`) and
    //    normal (`objectNormal`); if this is an InstancedMesh (USE_INSTANCING defined) apply the per-instance
    //    matrix first; then apply modelMatrix (object -> world) and normalise the normal to length 1.
    // `\n` in the normal string is a newline character.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 triLocal = vec4(transformed, 1.0);
vec3 triN = objectNormal;
#ifdef USE_INSTANCING
triLocal = instanceMatrix * triLocal;
triN = mat3(instanceMatrix) * triN;
#endif
vTriPos = (modelMatrix * triLocal).xyz;
vTriNormal = normalize(mat3(modelMatrix) * triN);`,
      )
    // Fragment shader (runs per pixel). Two more replacements:
    // 1) after `#include <common>`, declare the uniforms and varyings and a helper `triSample(t)` which:
    //    raises the absolute normal to the 4th power and normalises it so the blend weights favour the
    //    dominant axis; scales the world position by uScale; then samples the texture three times -
    //    projected on the zy plane (faces pointing along x), xz (top/bottom faces) and xy (front/back) -
    //    and adds them weighted by those normal weights.
    // 2) replace the standard `#include <map_fragment>` (normal UV texturing) with a line multiplying the
    //    surface colour by a mix() of the two textures, blended by uMix.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tMap;
uniform sampler2D tMap2;
uniform float uScale;
uniform float uMix;
varying vec3 vTriPos;
varying vec3 vTriNormal;
vec4 triSample(sampler2D t) {
  vec3 n = pow(abs(normalize(vTriNormal)), vec3(4.0));
  n /= (n.x + n.y + n.z);
  vec3 p = vTriPos * uScale;
  return texture2D(t, p.zy) * n.x + texture2D(t, p.xz) * n.y + texture2D(t, p.xy) * n.z;
}`,
      )
      .replace(
        '#include <map_fragment>',
        'diffuseColor *= mix(triSample(tMap), triSample(tMap2), uMix);',
      )
  }
  // Return the same (now patched) material so calls can be chained/nested.
  return material
}
