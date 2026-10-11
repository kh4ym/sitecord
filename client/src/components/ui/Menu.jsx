// FILE: components/ui/Menu.jsx — dropdown menus.
//
// What it does: a thin styling layer over Radix UI's DropdownMenu. Radix
// provides the behaviour (open/close, keyboard arrows, focus handling, closing
// on outside click); this file only adds SiteCord's look.
// Where it's used: the project switcher, the user menu and pages' "more
// actions" menus. Re-exported from ui/index.js.
// Depends on: radix-ui (DropdownMenu primitives) and `cn` (class-name joiner).

// Import the DropdownMenu namespace from radix-ui and rename it to `M` with `as`,
// so we can write M.Root, M.Trigger, M.Item... instead of the long name.
import { DropdownMenu as M } from 'radix-ui'
// Helper that joins CSS class strings, ignoring false/empty values.
import { cn } from '../../lib/format.js'

/** Dropdown menu. Keyboard navigation and focus come from Radix. */
// Exported component. Destructured props with defaults: `trigger` (the element
// that opens the menu), `children` (the menu items), `align` defaults to 'end',
// `side` defaults to 'bottom', plus optional extra `className`.
export function Menu({ trigger, children, align = 'end', side = 'bottom', className }) {
  return (
    // Root holds the open/closed state. modal={false} lets the rest of the page
    // stay interactive/scrollable while the menu is open.
    <M.Root modal={false}>
      {/* Trigger opens the menu. `asChild` (a Radix prop, shorthand for true)
          means "don't render your own button; merge your behaviour into my child",
          so the caller's own button element becomes the trigger. */}
      <M.Trigger asChild>{trigger}</M.Trigger>
      {/* Portal renders the menu at the end of <body>, outside the page layout,
          so it can't be clipped by parents with overflow hidden. */}
      <M.Portal>
        {/* Content is the floating panel itself. */}
        <M.Content
          // Horizontal alignment relative to the trigger (start/center/end).
          align={align}
          // Which side of the trigger to open on.
          side={side}
          // Gap in pixels between the trigger and the panel.
          sideOffset={8}
          // Panel styling: on top (z-50), min width, rounded, bordered, white,
          // shadow, and a pop-in animation when Radix sets data-state="open".
          className={cn('z-50 min-w-[230px] rounded-tile border border-line bg-white p-1.5 shadow-pop data-[state=open]:animate-pop-in', className)}
        >
          {/* The MenuItem / MenuLabel / MenuSeparator elements passed in. */}
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  )
}

// One clickable menu row. `icon: Icon` destructures the `icon` prop and renames
// it to `Icon` (capitalised, because JSX treats capitalised names as components).
// `...props` is "rest" syntax: every other prop not named here goes into `props`.
export function MenuItem({ icon: Icon, children, onSelect, tone, description, ...props }) {
  return (
    // Radix menu item: handles hover/keyboard highlighting and closing on select.
    <M.Item
      // Function called when the item is chosen (click or Enter).
      onSelect={onSelect}
      // cn() with two arguments split over lines: base row styling (flex row,
      // rounded, padded, no outline, grey background when Radix marks it
      // data-highlighted), then a ternary for red text when tone is 'danger'.
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-body outline-none select-none data-[highlighted]:bg-sunken',
        tone === 'danger' ? 'text-danger-700' : 'text-ink',
      )}
      // Spread syntax: pass all remaining props (e.g. disabled) onto M.Item.
      {...props}
    >
      {/* `a && <X/>` conditional rendering: only render the icon if one was given.
          Danger items keep the inherited red colour (empty class), others get grey. */}
      {Icon && <Icon size={17} className={tone === 'danger' ? '' : 'text-ink-3'} aria-hidden />}
      {/* Text column; min-w-0 lets long text truncate instead of overflowing. */}
      <span className="flex min-w-0 flex-1 flex-col">
        {/* Main label: the item's children, cut off with "..." if too long. */}
        <span className="truncate font-semibold">{children}</span>
        {/* Optional smaller grey second line. */}
        {description && <span className="truncate text-meta text-ink-3">{description}</span>}
      </span>
    </M.Item>
  )
}

// Arrow-function component: `(props) => <jsx>` returns the JSX directly (no
// `return` needed with no braces). A small heading inside the menu.
export const MenuLabel = ({ children }) => <M.Label className="head px-3 pt-2 pb-1.5 text-ink-3">{children}</M.Label>
// A 1px horizontal divider line between groups of items. Takes no props.
export const MenuSeparator = () => <M.Separator className="my-1.5 h-px bg-line" />
