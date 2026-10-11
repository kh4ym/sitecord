// =============================================================================
// PurchasesPage.jsx
// -----------------------------------------------------------------------------
// Route: /p/:id/purchases  (optionally ?type=MATERIAL&q=cement in the URL).
//
// What it shows: every purchase on the project, with three headline figures
// (money spent this month, number of purchases, how many need attention), a
// filter by purchase type, a search box, and one row per purchase that opens
// its detail page (/p/:id/purchases/:expenseId).
//
// Who can see it: project members who can view purchases. The "+" (new
// purchase) button only appears for people with the "createExpense" permission.
//
// Data it loads: the full purchases list via the useExpenses query hook. The
// chosen type filter lives in the URL's query string (so it survives refresh
// and back/forward); the search text starts from ?q= and then lives in state.
//
// Depends on: React (useMemo, useState), React Router (useSearchParams),
// lucide-react icons, the UI kit, i18n, the format helpers and expenseChip.
// =============================================================================

// React hooks: useMemo caches a computed value; useState stores component state.
import { useMemo, useState } from 'react'
// useSearchParams reads and writes the "?key=value" part of the URL.
import { useSearchParams } from 'react-router'
// Icon components (one per purchase type, plus search/close/add icons).
import { Hammer, Package, Plus, Receipt, Search, Shapes, Truck, Wrench, X } from 'lucide-react'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { Button, EmptyState, ErrorState, FilterChips, IconButton, IconTile, Input, ListCard, ListRow, PageSkeleton, StatRow, StatusChip } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Current project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// Formatting helpers: fixed(n) number formatter, rupees, short dates, moneyParts splits an amount into number + unit (e.g. 1.2 + "lakh"), today() as "YYYY-MM-DD".
import { fixed, formatPKR, formatShortDate, moneyParts, today } from '../../lib/format.js'
// Query hook for the purchases list.
import { useExpenses } from '../../lib/queries.js'
// Works out which status chip a purchase gets.
import { expenseChip } from '../../lib/status.js'

// Lookup object: purchase type -> icon component. Values are components (not strings).
const TYPE_ICONS = { MATERIAL: Package, LABOUR: Hammer, EQUIPMENT: Wrench, TRANSPORT: Truck, OTHER: Shapes }
// Array of filter options; the empty string '' value means "all types".
const TYPES = [
  { value: '', label: 'all' },
  { value: 'MATERIAL', label: 'material' },
  { value: 'LABOUR', label: 'labour' },
  { value: 'TRANSPORT', label: 'transport' },
  { value: 'EQUIPMENT', label: 'equipment' },
  { value: 'OTHER', label: 'other' },
]
// Statuses that count towards "spent this month" (drafts and rejected ones don't).
const COUNTED = ['SUBMITTED', 'QUERIED', 'APPROVED', 'VERIFIED']

// The page component (default export).
export default function PurchasesPage() {
  // Project and permission checker from context.
  const { project, can } = useProjectContext()
  // Translate function.
  const { t } = useI18n()
  // Array destructuring: `params` is a URLSearchParams object, `setParams` replaces the URL's query string.
  const [params, setParams] = useSearchParams()
  // params.get('type') returns the value or null; `?? ''` turns null into '' (all types).
  const type = params.get('type') ?? ''
  // Search text state, starting from ?q= if present.
  const [search, setSearch] = useState(params.get('q') ?? '')
  // Is the search box open? `!!` converts any value to a true/false boolean.
  const [searching, setSearching] = useState(!!params.get('q'))
  // Fetch all purchases.
  const { data, isLoading, error, refetch } = useExpenses(project.id)
  // The purchases URL, reused for links.
  const base = `/p/${project.id}/purchases`

  // useMemo with a block body: recompute the visible rows only when data, type or search change.
  const rows = useMemo(() => {
    // Normalise the search text: trim spaces and lower-case it.
    const s = search.trim().toLowerCase()
    // `(data ?? [])` uses an empty list while loading. Keep a purchase if it matches the type (or no type chosen)
    // AND it matches the search (or no search): the template literal builds one searchable string and .includes looks for the text.
    return (data ?? []).filter((e) => (!type || e.type === type) && (!s || `${e.number} ${e.supplierName} ${e.items ?? ''} ${e.invoiceNumber ?? ''}`.toLowerCase().includes(s)))
    // Dependency array for useMemo.
  }, [data, type, search])

  // Loading placeholder (hooks above must run on every render, so these returns come after them).
  if (isLoading) return <PageSkeleton />
  // Error with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // "YYYY-MM" for this month: .slice(0, 7) takes the first 7 characters of "YYYY-MM-DD".
  const month = today().slice(0, 7)
  // Keep counted purchases dated this month, then .reduce adds up their totals starting from 0; moneyParts splits the sum for display.
  const thisMonth = moneyParts(data.filter((e) => COUNTED.includes(e.status) && e.purchaseDate.startsWith(month)).reduce((n, e) => n + e.totalPaisa, 0))
  // How many purchases are drafts or queried (they need the creator's attention); .length counts them.
  const needEvidence = data.filter((e) => e.status === 'DRAFT' || e.status === 'QUERIED').length
  // Arrow function that changes the type filter in the URL.
  const setType = (v) => {
    // Copy the current params so we don't mutate the original (`new` creates an object from a class).
    const next = new URLSearchParams(params)
    // Ternary used as a statement: set ?type=v if a type was chosen, otherwise remove it.
    v ? next.set('type', v) : next.delete('type')
    // Write it back; { replace: true } replaces the history entry instead of adding one, so Back doesn't step through filters.
    setParams(next, { replace: true })
  }

  return (
    <Page>
      {/* Heading; it also accepts children (the search box) between its opening and closing tags. */}
      <PageTitle
        // Translated "Purchases".
        title={t('nav.purchases')}
        // Fragment holding the two header buttons.
        actions={
          <>
            {/* Search toggle: shows X while searching. The comma operator runs both: flip `searching` and clear the text. */}
            <IconButton icon={searching ? X : Search} label={searching ? 'Close search' : 'Search purchases'} onClick={() => (setSearching((s) => !s), setSearch(''))} />
            {/* "+" button linking to the new-purchase form, only for people who may create purchases. */}
            {can('createExpense') && <IconButton icon={Plus} label={t('purchase.new')} to={`${base}/new`} variant="solid" />}
          </>
        }
      >
        {/* Search input while searching. autoFocus puts the cursor in it; onChange receives the event and e.target.value is the typed text. */}
        {searching && <Input autoFocus aria-label="Search purchases" placeholder="Supplier, item, invoice or number" value={search} onChange={(e) => setSearch(e.target.value)} />}
      </PageTitle>

      {/* Three headline figures. */}
      <StatRow
        // Reveal animation marker.
        data-reveal
        // Margin below.
        className="mb-6"
        // Array of stat objects.
        items={[
          // Money spent this month, formatted with the right number of decimals and unit.
          { value: thisMonth.n, format: fixed(thisMonth.digits), unit: thisMonth.unit, label: 'this month' },
          // Count of non-draft purchases.
          { value: data.filter((e) => e.status !== 'DRAFT').length, label: 'purchases' },
          // Count needing attention; red ("danger") tone when above zero (0 is falsy, so tone is undefined then).
          { value: needEvidence, label: needEvidence === 1 ? 'needs attention' : 'need attention', tone: needEvidence ? 'danger' : undefined },
        ]}
      />
      {/* Type filter chips. Only show types that exist in the data: .some returns true if any purchase has that type; the "all" option (empty value) is always kept. */}
      <FilterChips data-reveal className="mb-4" label="Type" value={type} onChange={setType} options={TYPES.filter((o) => !o.value || data.some((e) => e.type === o.value))} />

      {/* Ternary: empty state when no rows, otherwise the list. */}
      {rows.length === 0 ? (
        <div data-reveal className="card">
          <EmptyState
            // Receipt icon.
            icon={Receipt}
            // Different wording when there is data but the filters hide it (data.length is 0 = falsy when empty).
            title={data.length ? 'No purchases match' : 'No purchases yet'}
            // Matching helper text.
            description={data.length ? 'Try another type or search.' : 'Purchases appear here with their receipts.'}
            // A "new purchase" button, only when there are no purchases at all and the user may create one.
            action={
              !data.length &&
              can('createExpense') && (
                <Button variant="primary" to={`${base}/new`}>
                  {t('purchase.new').toLowerCase()}
                </Button>
              )
            }
          />
        </div>
      ) : (
        <div data-reveal>
          {/* animateKey changes when the filter or search changes, so the list re-animates. */}
          <ListCard animateKey={`${type}|${search}`}>
            {/* One row per visible purchase. */}
            {rows.map((e) => (
              <ListRow
                // Unique key.
                key={e.id}
                // Link to the purchase's detail page.
                to={`${base}/${e.id}`}
                // Type icon, falling back to a receipt icon for unknown types.
                leading={<IconTile icon={TYPE_ICONS[e.type] ?? Receipt} tone="accent" />}
                // `||` picks the first truthy value: the item list, or the supplier if there are no items.
                title={e.items || e.supplierName}
                // "Supplier, 3 Oct".
                subtitle={`${e.supplierName}, ${formatShortDate(e.purchaseDate)}`}
                // Fragment with the amount (with "Rs " removed to save space) and the status chip.
                trailing={
                  <>
                    <span className="num text-body font-bold">{formatPKR(e.totalPaisa).replace('Rs ', '')}</span>
                    <StatusChip kind="expense" status={expenseChip(e)} />
                  </>
                }
              />
            ))}
          </ListCard>
        </div>
      )}
    </Page>
  )
}
