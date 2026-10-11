// Demo personas. Fictional people; the .test domain never delivers email.
// The shared demo password is for local development only.
//
// What this file does: it defines the four fictional demo users (one per
// project role) and the shared sign-in constant they use in local development.
// Why it exists: so the demo seed (seed/demo.js), the smoke test and the
// sign-in page's demo buttons all agree on the same people.
// Depends on: nothing; it only exports constant data.

// `export const NAME = value` declares a constant and makes it importable.
export const DEMO_PASSWORD = 'sitecord-demo-2026'

// An object literal `{ KEY: value, ... }` mapping each role name to a person.
// Each person is itself an object with email, display name and a short title.
export const DEMO_PEOPLE = {
  // The project owner (the person paying for the build).
  OWNER: { email: 'ayesha@sitecord.test', name: 'Ayesha Khan', title: 'Owner · lives in Dubai' },
  // The building contractor.
  CONTRACTOR: { email: 'imran@sitecord.test', name: 'Imran Ali', title: 'Contractor · Imran Builders' },
  // The owner's local representative on site. Double quotes are used for this
  // string because it contains an apostrophe.
  LOCAL_REP: { email: 'bilal@sitecord.test', name: 'Bilal Khan', title: "Local representative · Ayesha's brother" },
  // The independent inspector.
  INSPECTOR: { email: 'sana@sitecord.test', name: 'Engr. Sana Malik', title: 'Independent inspector' },
}
