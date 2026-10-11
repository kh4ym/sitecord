// FILE: client/src/lib/image.js
//
// What it does: two browser helpers.
//   1. compressImage(file): photos from phones are often 4–12 MB. Shrink them
//      before upload (max 1800 px on the long edge, JPEG quality 0.84) so
//      reports work on slow connections. PDFs, GIFs and small images are sent
//      as they are.
//   2. currentPosition(): a one-shot GPS read for the site pin, which never
//      blocks for long (the camera screen watches the position instead).
//
// Where it's used: EvidenceUploader and the Today page's quick photo.
//
// Depends on: browser APIs only (createImageBitmap, <canvas>, File, geolocation).

// Module-level constants: the longest side in pixels, and JPEG quality (0..1).
const MAX_EDGE = 1800
const QUALITY = 0.84

// `export async function`: returns a Promise; resolves to a File (smaller, or the original).
export async function compressImage(file) {
  // Leave the file untouched if it isn't an image, is a GIF (would lose animation),
  // or is already under 600 KB (600 * 1024 bytes). `||` means "or".
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 600 * 1024) return file
  // Any failure below (unsupported format, out of memory) falls back to the original.
  try {
    // Decode the image into a bitmap; 'from-image' honours the phone's EXIF rotation.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    // Shrink factor so the longest edge is MAX_EDGE; Math.min(1, ...) never enlarges.
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    // Create an off-screen <canvas> element (never added to the page).
    const canvas = document.createElement('canvas')
    // Set the canvas size in whole pixels.
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    // Get the 2D drawing context and paint the bitmap scaled to fill the canvas.
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    // Free the bitmap's memory. `?.()` calls close only if the browser supports it.
    bitmap.close?.()
    // canvas.toBlob uses a callback; wrapping it in a Promise lets us `await` it.
    // Passing `resolve` directly as the callback resolves with the Blob (or null).
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
    // If encoding failed or didn't save space, keep the original.
    if (!blob || blob.size >= file.size) return file
    // Wrap the Blob as a File: regex `/\.\w+$/` strips the old extension, then '.jpg'
    // is added with `+` string concatenation. Keep the original modified time.
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified })
  // `catch {` with no variable: we don't need to inspect the error.
  } catch {
    // Fall back to uploading the original file.
    return file
  }
}

/** Best-effort location with its accuracy, never blocking for long. */
// `timeout = 6000` default parameter (milliseconds); the second parameter is an
// options object destructured to `precise`, defaulting to false; `= {}` lets it be omitted.
export function currentPosition(timeout = 6000, { precise = false } = {}) {
  // Return a Promise that always resolves (to a position or null), never rejects.
  return new Promise((resolve) => {
    // Browser has no geolocation API: resolve null straight away. `return` stops here.
    if (!navigator.geolocation) return resolve(null)
    // Safety net: setTimeout runs the arrow function after `timeout` ms; it returns an id.
    const timer = setTimeout(() => resolve(null), timeout)
    // Ask the browser once for the position: success callback, error callback, options.
    navigator.geolocation.getCurrentPosition(
      // Success: `p` is a GeolocationPosition.
      (p) => {
        // Cancel the safety-net timer.
        clearTimeout(timer)
        // Resolve with a small object; accuracy is in metres, rounded.
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) })
      },
      // Failure (permission denied, no signal): also resolve null.
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      // Options: precise mode refuses cached fixes (maximumAge 0) and asks for GPS-level
      // accuracy; otherwise a fix up to 60 s old is fine. `timeout` is shorthand for timeout: timeout.
      { maximumAge: precise ? 0 : 60000, timeout, enableHighAccuracy: precise },
    )
  })
}
