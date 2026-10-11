// FILE: client/src/i18n/I18nProvider.jsx
// Language for the whole app: English or Urdu. The signed-in person's choice
// is saved on their account (useUpdateMe); before sign-in, or offline, the
// last choice in localStorage applies. Mounted in main.jsx inside the Query
// provider, since it reads the session. Components use `useI18n()` for
// t(key, vars), term(english) and `rtl`.
// Uses React context: a provider component at the top of the tree hands one
// value to every component below, which reads it with a hook (useI18n).
// Depends on: strings.js (the dictionaries), lib/format.js (number/date
// locale) and lib/queries.js (the signed-in user and the save mutation).

// Named imports of React functions: createContext makes a context object;
// the use* functions are hooks (special functions only called inside components).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
// Tells the shared number/date formatter which language to use.
import { setFormatLocale } from '../lib/format.js'
// useMe reads the signed-in user; useUpdateMe saves changes to them.
import { useMe, useUpdateMe } from '../lib/queries.js'
// The translation dictionaries ('..' would go up a folder; './' is this folder).
import { STRINGS, URDU_TERMS } from './strings.js'

// The context object; `null` is the value seen by components outside any provider.
const I18nContext = createContext(null)

// Nastaliq is a large web font; it's only fetched once someone picks Urdu.
function loadUrduFont() {
  // Already added? Then stop (`return` with no value exits the function).
  if (document.getElementById('urdu-font')) return
  // Build a <link> element in JavaScript (the DOM API) and set its attributes.
  const link = document.createElement('link')
  link.id = 'urdu-font' // so the check above finds it next time
  link.rel = 'stylesheet' // it is a CSS file
  link.href = 'https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap'
  document.head.appendChild(link) // insert it into <head>, which starts the download
}

// Arrow function with a block body: read the saved language from the browser.
const readStored = () => {
  // try/catch because localStorage can throw (private mode, blocked storage).
  try {
    // Only 'ur' or 'en' are ever returned, whatever is stored.
    return localStorage.getItem('sitecord.locale') === 'ur' ? 'ur' : 'en'
  } catch {
    return 'en' // storage unavailable: default to English
  }
}

// The provider component. `{ children }` destructures the special `children`
// prop: whatever JSX is placed between <I18nProvider> and </I18nProvider>.
export function I18nProvider({ children }) {
  const me = useMe().data // the signed-in user, or undefined
  // Destructure `mutate` from the mutation hook and rename it saveLocale.
  const { mutate: saveLocale } = useUpdateMe()
  // useState returns [current value, setter]; array destructuring names them.
  // Passing the function `readStored` (not calling it) runs it only on first render.
  const [stored, setStored] = useState(readStored)
  // The account's language wins; `??` falls back to the stored one.
  const locale = me?.locale ?? stored
  const signedIn = !!me // `!!` turns any value into a true/false boolean

  // Set before the first paint, so dates and numbers never flash in the other language.
  setFormatLocale(locale)
  // Urdu flips the whole document to right-to-left. Layout uses logical
  // properties (start/end) throughout, so that one attribute mirrors it;
  // motion.js watches `dir` to re-place sliding pills.
  // useEffect(fn, [deps]) runs fn after render, and again whenever a value in
  // the dependency array changes (here: whenever `locale` changes).
  useEffect(() => {
    document.documentElement.lang = locale // <html lang="..">
    document.documentElement.dir = locale === 'ur' ? 'rtl' : 'ltr' // <html dir="..">
    if (locale === 'ur') loadUrduFont() // fetch the font only for Urdu
  }, [locale])

  // useCallback keeps the same function object between renders unless a
  // dependency changes, so components using it don't re-render needlessly.
  const setLocale = useCallback(
    // The callback itself: `next` is the new language code.
    (next) => {
      setStored(next) // update state, which re-renders with the new language
      // Remember the choice in the browser (may be blocked).
      try {
        localStorage.setItem('sitecord.locale', next)
      } catch {
        /* storage blocked */
      }
      // Signed in: also save it on the account (sent to the server).
      if (signedIn) saveLocale({ locale: next })
    },
    // Dependency array for useCallback.
    [signedIn, saveLocale],
  )

  // useMemo computes a value once and reuses it until a dependency changes;
  // a stable `value` means consumers only re-render when the language changes.
  const value = useMemo(() => {
    // The dictionary for this language, or English if it is unknown.
    const dict = STRINGS[locale] ?? STRINGS.en
    /** t('today.greeting', { name }). Missing keys fall back to English, then to the key itself (StatusChip relies on that). */
    const t = (key, vars) => {
      // Chained `??`: this language, else English, else the key text itself.
      let s = dict[key] ?? STRINGS.en[key] ?? key
      // Replace each {name} placeholder with its value; `replaceAll` swaps every
      // occurrence; the template literal builds the text "{name}".
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v)
      return s
    }
    /** Translate a domain term (stage, step, type) when in Urdu. */
    // Ternary with a nested `??`: Urdu term if known, else the English word.
    const term = (english) => (locale === 'ur' ? (URDU_TERMS[english] ?? english) : english)
    // The object every component receives from useI18n().
    return { locale, setLocale, t, term, rtl: locale === 'ur' }
  }, [locale, setLocale])

  // JSX: `<I18nContext.Provider value={value}>` makes `value` available to
  // every component inside; `{children}` renders the wrapped content.
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

// Custom hook: components call useI18n() to get { locale, setLocale, t, term, rtl }.
export const useI18n = () => useContext(I18nContext)
