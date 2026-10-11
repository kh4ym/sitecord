// FILE: components/ui/Button.jsx — buttons and icon buttons.
//
// What it does: `Button` is SiteCord's pill-shaped button. One component covers
// a real <button>, a React Router <Link> (pass `to`) and a plain <a> (pass
// `href`), so call sites don't branch on what a pill does. It also handles a
// loading spinner, leading/trailing icons, sizes and colour variants.
// `IconButton` is the round icon-only button (bell, people, back, more) with an
// optional little number badge.
// Where it's used: almost every page and dialog. Re-exported from ui/index.js.
// Depends on: React's forwardRef, react-router's Link, a lucide-react spinner
// icon and `cn` (class-name joiner).

// forwardRef lets a parent pass a `ref` through this component to the real DOM
// element inside (needed e.g. by Radix `asChild` triggers and focus handling).
import { forwardRef } from 'react'
// Router link component: navigates inside the app without a full page reload.
import { Link } from 'react-router'
// Circular spinner icon shown while `loading`.
import { LoaderCircle } from 'lucide-react'
// Joins class strings, ignoring false/undefined values.
import { cn } from '../../lib/format.js'

// primary: the one main action on a page (black). accent: the blue "take me
// to the site" action (verify, pay). secondary: outlined. soft: white card-like.
// danger/danger-text: destructive. text: a plain link-looking button.
// Lookup object: variant name -> Tailwind classes (colours plus hover/active states).
const VARIANTS = {
  // Black fill, white text; slightly lighter on hover, pure black when pressed.
  primary: 'bg-ink text-white hover:bg-[#2a2a2a] active:bg-black',
  // Brand accent fill with a coloured shadow; darker on hover/press.
  accent: 'bg-accent-600 text-white shadow-accent hover:bg-accent-700 active:bg-accent-800',
  // Dark outline, transparent fill, faint tint on hover/press.
  secondary: 'border border-ink/80 bg-transparent text-ink hover:bg-ink/[0.04] active:bg-ink/[0.08]',
  // White with a light border that darkens on hover.
  soft: 'bg-white text-ink border border-line hover:border-line-strong',
  // Solid red.
  danger: 'bg-danger-700 text-white hover:bg-[#9b1c13]',
  // Red text only. The key is quoted because it contains a dash.
  'danger-text': 'text-danger-700 hover:bg-danger-50',
  // Looks like a link: accent text, underline on hover.
  text: 'text-accent-700 hover:text-accent-800 underline-offset-4 hover:underline',
}

// Size name -> height, gap between icon and text, horizontal padding, font size.
const SIZES = {
  // Small: 36px tall.
  sm: 'h-9 gap-1.5 px-3.5 text-meta',
  // Medium (default): 44px tall, a comfortable touch target.
  md: 'h-11 gap-2 px-5 text-body',
  // Large: 56px tall.
  lg: 'h-14 gap-2.5 px-6 text-title',
}

/**
 * Pill buttons. Labels are written in lowercase in the copy ("approve",
 * "ask a question"), matching the design.
 *   <Button variant="primary" block icon={Plus}>add purchase</Button>
 * Pass `to` for a router link or `href` for a plain link. A disabled link
 * renders as plain text, so it can't be followed from the keyboard either.
 */
// forwardRef(function Name(props, ref) {...}) wraps a component so it receives
// the parent's `ref` as a second argument. A named function expression is used
// so React dev tools show "Button".
export const Button = forwardRef(function Button(
  // First parameter: the props object, destructured. Defaults: variant
  // 'secondary', size 'md', type 'button' (so it never accidentally submits a
  // form). `icon: Icon` / `iconRight: IconRight` rename props to capitalised
  // names usable as JSX tags. `...props` collects everything else (onClick, aria-*, ...).
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, disabled, to, href, block, className, children, type = 'button', ...props },
  // Second parameter: the forwarded ref.
  ref,
) {
  // Build the full class string once, shared by every element type below.
  const classes = cn(
    // Base: inline flex pill, centred content, semibold, no wrapping, animated
    // colour/scale transitions, unselectable text, shrinks slightly when pressed.
    'inline-flex shrink-0 items-center justify-center rounded-full font-semibold whitespace-nowrap transition-[background-color,color,border-color,transform] select-none active:scale-[0.98]',
    // Faded and unclickable when disabled (real `disabled` or aria-disabled).
    'disabled:pointer-events-none disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40',
    // Colour classes for the chosen variant (bracket lookup by variable).
    VARIANTS[variant],
    // Text variant has no height/padding and no press shrink; others use SIZES.
    variant === 'text' ? 'h-auto px-0 active:scale-100' : SIZES[size],
    // `block && 'w-full'`: full width only when `block` is true.
    block && 'w-full',
    // Caller's extra classes last so they can override.
    className,
  )
  // Nested ternary choosing icon pixel size from the button size.
  const iconSize = size === 'lg' ? 20 : size === 'sm' ? 16 : 18
  // JSX can be stored in a variable. `<>...</>` is a Fragment: groups several
  // elements without adding an extra DOM element.
  const content = (
    <>
      {/* Loading: spinning loader icon. Otherwise `Icon && <Icon/>` shows the
          leading icon only if one was passed. */}
      {loading ? <LoaderCircle size={iconSize} className="animate-spin" aria-hidden /> : Icon && <Icon size={iconSize} aria-hidden strokeWidth={2} />}
      {/* The button label. */}
      {children}
      {/* Optional trailing icon; `rtl:-scale-x-100` mirrors it in right-to-left languages (e.g. Urdu). */}
      {IconRight && <IconRight size={iconSize} aria-hidden strokeWidth={2} className="rtl:-scale-x-100" />}
    </>
  )
  // A disabled link: render a non-interactive <span> that looks disabled.
  // `||` means "or", `&&` means "and".
  if ((to || href) && disabled) {
    return (
      // aria-disabled tells assistive tech it's disabled; {...props} spreads the rest of the props on.
      <span ref={ref} className={classes} aria-disabled="true" {...props}>
        {content}
      </span>
    )
  }
  // In-app destination: render a router Link.
  if (to) {
    return (
      <Link ref={ref} to={to} className={classes} {...props}>
        {content}
      </Link>
    )
  }
  // External/plain URL: render an ordinary anchor.
  if (href) {
    return (
      <a ref={ref} href={href} className={classes} {...props}>
        {content}
      </a>
    )
  }
  // Default: a real <button>. It's disabled while loading too. aria-busy is
  // set to true while loading; `loading || undefined` removes the attribute
  // entirely when not loading (undefined attributes aren't rendered).
  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {content}
    </button>
  )
})

/**
 * Round icon button with a hairline ring (bell, people, back, more), or
 * black (`variant="solid"`) for the page's main "add" action.
 */
// Same forwardRef pattern. Props: icon, `label` (required for accessibility as
// there's no visible text), optional `to`, size, `badge` count, variant
// (default 'outline'), and the rest in `props`.
export const IconButton = forwardRef(function IconButton({ icon: Icon, label, to, className, size = 'md', badge, variant = 'outline', ...props }, ref) {
  // Classes for the circle.
  const classes = cn(
    // Base: relative (so the badge can be positioned), centred grid, round, bordered, press shrink.
    'relative inline-grid shrink-0 place-items-center rounded-full border transition active:scale-95',
    // Chained ternary for the three variants: solid black, ghost (no border), or outline (default).
    variant === 'solid' ? 'border-ink bg-ink text-white hover:bg-[#2a2a2a]' : variant === 'ghost' ? 'border-transparent text-ink-2 hover:bg-ink/5' : 'border-line bg-white text-ink hover:border-line-strong',
    // 36px or 44px square.
    size === 'sm' ? 'h-9 w-9' : 'h-11 w-11',
    // Caller's extra classes.
    className,
  )
  // Inner content: the icon plus an optional badge, grouped in a Fragment.
  const inner = (
    <>
      {/* The icon; its size follows the button size. */}
      <Icon size={size === 'sm' ? 17 : 19} aria-hidden strokeWidth={1.9} />
      {/* Ternary rendering the badge when `badge` is a truthy number, else null (nothing). */}
      {badge ? (
        // Small accent circle pinned to the top/end corner, with a ring matching the page background.
        <span className="absolute -end-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent-600 px-1 text-2xs font-bold text-white ring-2 ring-canvas">
          {/* Cap the number shown at "9+". */}
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </>
  )
  // With a destination, render a router Link; aria-label gives screen readers its name.
  if (to) {
    return (
      <Link ref={ref} to={to} aria-label={label} className={classes} {...props}>
        {inner}
      </Link>
    )
  }
  // Otherwise a plain button (type="button" so it never submits a form).
  return (
    <button ref={ref} type="button" aria-label={label} className={classes} {...props}>
      {inner}
    </button>
  )
})
