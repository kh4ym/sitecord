// FILE: components/ui/index.js — the "barrel" file of SiteCord's design system.
//
// What it does: it gathers every reusable UI building block (buttons, chips,
// form fields, sheets and dialogs, menus, filter pills, list cards, stats and
// bars, empty/loading/error states and small bits) from the individual files
// in this folder and re-exports them from one place.
//
// Why it exists: pages import from here, never from the individual files, so
// a component can move between files without touching any of its users.
// A page writes `import { Button, Chip } from '../components/ui'` and the
// bundler (Vite) resolves the folder name to this index.js automatically.
//
// Depends on: only the sibling files in this folder. Contains no code of its own.

// `export { A, B } from './file'` is a "re-export": it imports the named
// exports A and B from that file and immediately exports them again from this
// module, without creating local variables. Each line below does that.
// Buttons: the main text button and the square icon-only button.
export { Button, IconButton } from './Button.jsx'
// Small pill labels: generic chip, status chip (colour per status) and role tag.
export { Chip, StatusChip, RoleTag } from './Chip.jsx'
// Form controls: label wrapper plus every input type the app uses.
export { Field, Input, Textarea, Select, MoneyInput, Stepper, Checkbox, OptionCards, Segmented } from './Field.jsx'
// Overlays: the bottom/side sheet and the "are you sure?" confirm dialog.
export { Sheet, ConfirmDialog } from './Dialog.jsx'
// Dropdown menu and its pieces (item, section label, divider line).
export { Menu, MenuItem, MenuLabel, MenuSeparator } from './Menu.jsx'
// Horizontal pill filters and tab-style pills.
export { FilterChips, TabPills } from './FilterChips.jsx'
// Card-style lists: the card, a row inside it, an icon tile and a section heading.
export { ListCard, ListRow, IconTile, SectionHead } from './ListCard.jsx'
// Numbers and progress: stat row, animated counter, meter, stacked bar, on/off toggle.
export { StatRow, CountUp, Meter, StackedBar, Toggle } from './Bars.jsx'
// Page states and odds and ends: empty, skeleton placeholders, spinner, error, avatar, notice.
export { EmptyState, Skeleton, Spinner, PageSkeleton, ErrorState, Avatar, Notice } from './misc.jsx'
