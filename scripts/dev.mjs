// FILE: scripts/dev.mjs
// npm run dev — starts the API (http://localhost:4000) and the web app
// (http://localhost:5173) together, with prefixed logs. Ctrl+C stops both.
// Written in plain Node (no concurrently/npm-run-all) so the root needs no
// extra dependency: the API runs under `node --watch` so edits restart it,
// and Vite is launched from the client's node_modules. When either process
// exits the other is stopped too, so a crash is never half-noticed.
// The .mjs extension tells Node this file is an ES module (import/export).
// Depends only on Node built-ins (child_process, path, url).

// `spawn` starts another program as a child process. The 'node:' prefix
// marks a built-in Node module.
import { spawn } from 'node:child_process'
// Default import: `path` is the module's default export (path helpers).
import path from 'node:path'
// Converts a file:// URL into a normal file-system path.
import { fileURLToPath } from 'node:url'

// The repo root: `import.meta.url` is this file's URL; turn it into a path,
// take its folder (scripts/), then resolve '..' to go one folder up.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// process.execPath is the full path of the running node executable.
const node = process.execPath
// Array that collects every started child process so we can stop them all.
const procs = []

// Start one child: `name` labels its logs, `color` is an ANSI colour code,
// `args` are node's command-line arguments, `cwd` is the folder to run in.
function run(name, color, args, cwd) {
  // stdio: ignore the child's input, pipe its stdout and stderr back to us.
  const p = spawn(node, args, { cwd: path.join(root, cwd), stdio: ['ignore', 'pipe', 'pipe'] })
  // Template literal building a coloured "[name] " prefix; \x1b[..m are
  // terminal escape codes (set colour, then reset with 0).
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `
  // `for...of` loops over the values of an array: both output streams.
  for (const stream of [p.stdout, p.stderr]) {
    // `.on('data', fn)` registers an event listener called with each chunk.
    stream.on('data', (d) => {
      // Split the chunk into lines with a regex (/\r?\n/ = optional CR then
      // LF); print each non-blank line (`.trim()` strips spaces) with prefix.
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) process.stdout.write(prefix + line + '\n')
    })
  }
  // When this child exits, report its exit code and stop everything.
  p.on('exit', (code) => {
    process.stdout.write(`${prefix}exited (${code})\n`)
    stop()
  })
  procs.push(p) // `.push` appends to the end of the array
}

// Kill every child that is still running, then end this script.
function stop() {
  // `!p.killed` - only kill processes that have not already been killed.
  for (const p of procs) if (!p.killed) p.kill()
  process.exit() // exit the dev script itself
}

// API: node --watch restarts on edits; load server/.env if it exists. 36 = cyan.
run('api', '36', ['--watch', '--env-file-if-exists=.env', 'src/server.js'], 'server')
// Web: run Vite's CLI from the client folder. 35 = magenta.
run('web', '35', ['node_modules/vite/bin/vite.js'], 'client')
// SIGINT is Ctrl+C; SIGTERM is a polite "please stop" from the OS.
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
