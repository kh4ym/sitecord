// npm run reset — wipe the local database and uploads, then reload demo data.
//
// What this file does: it is a command-line script (run via `npm run reset`)
// that deletes the local embedded database folder and the uploaded files
// folder, recreates the schema, and fills it with the demo project.
// Why it exists: to get a clean, known starting state during development.
// Who uses it: developers, through the npm script in server/package.json.
// Depends on: config.js (paths and DATABASE_URL), db/index.js (connect/close),
// db/migrate.js (creates tables) and seed/demo.js (inserts the demo data).
// Safety: it refuses to run against a real PostgreSQL server.

// Named import of `rmSync` (synchronous "remove file/folder") from Node's
// built-in file-system module; the `node:` prefix marks a built-in module.
import { rmSync } from 'node:fs'
// Import the app's configuration object.
import { config } from '../config.js'

// `if (value)` runs the block when the value is "truthy" (here: a non-empty URL).
if (config.databaseUrl) {
  // Write a message to the error output stream; `\n` is a newline character.
  process.stderr.write('Refusing to reset: DATABASE_URL points at a PostgreSQL server. Reset it yourself if you mean to.\n')
  // Stop the program with exit code 1 (non-zero means "failed").
  process.exit(1)
}
// Delete the data folder; the options object says: include sub-folders
// (`recursive: true`) and don't complain if it doesn't exist (`force: true`).
rmSync(config.dataDir, { recursive: true, force: true })
// Same for the uploads folder.
rmSync(config.uploadDir, { recursive: true, force: true })

// Dynamic import: `await import('path')` loads a module at this point at
// runtime (after the folders were deleted) instead of at file start. The
// result is the module object, destructured into the functions we need.
// Top-level `await` is allowed in ES modules.
const { connect, close } = await import('../db/index.js')
// Load the migration runner.
const { migrate } = await import('../db/migrate.js')
// Load the demo seeder.
const { seedDemo } = await import('./demo.js')
await connect() // open the database connection
await migrate() // create all tables
await seedDemo() // insert the demo project, people and records
await close() // close the connection so the process can exit
