// /p/:id/documents. Drawings, approvals, contracts and other files; inspectors
// only see drawings and approvals. Upload sheet and archive for the owner.
//
// FILE OVERVIEW
// What it does: the project's document library. Shows every document as a card
//   (an image preview, or a PDF icon) in a grid, with category filter chips and
//   an optional title search. Tapping a card opens it in a full-screen viewer
//   (the "lightbox") that also shows its fingerprint (sha256 hash). Each card has
//   a menu to download it, and, for the owner, to archive it (hide it from the
//   library while keeping it in the record). A slide-up "sheet" lets people with
//   the uploadDocument permission add a new file with a title and category.
// Route: /p/:id/documents (shown as "Drawings" for inspectors).
// Who can see it: project members. Inspectors only receive drawings and
//   approvals from the server, and can only file those two categories.
//   Uploading needs uploadDocument; archiving needs manageProject (owner).
// Data it loads: useDocuments (the list), plus the mutations useCreateDocument
//   and useArchiveDocument from lib/queries.js. File URLs come from lib/api.js.
// Depends on: React hooks, sonner toasts, lucide icons, shared document
//   categories, the evidence lightbox and uploader, the UI kit, i18n, the
//   project context and date formatting.

// React hooks: useMemo (cache a computed value), useState (local state).
import { useMemo, useState } from 'react'
// Toast notifications.
import { toast } from 'sonner'
// Icon components.
import { Archive, Download, FileText, FolderOpen, MoreHorizontal, Plus, Search, X } from 'lucide-react'
// Object mapping category keys (e.g. 'DRAWING') to labels (e.g. 'Drawing').
import { DOCUMENT_CATEGORIES } from '@shared/records.js'
// Full-screen viewer for one file.
import { EvidenceLightbox } from '../../components/evidence/EvidenceGallery.jsx'
// File upload component.
import { EvidenceUploader } from '../../components/evidence/EvidenceUploader.jsx'
// Page layout wrapper.
import { Page } from '../../components/Page.jsx'
// UI kit components.
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, FilterChips, IconButton, Input, Menu, MenuItem, Notice, PageSkeleton, Segmented, Sheet } from '../../components/ui/index.js'
// Translation hook.
import { useI18n } from '../../i18n/I18nProvider.jsx'
// Page heading.
import { PageTitle } from '../../layout/PageHeader.jsx'
// Project context.
import { useProjectContext } from '../../layout/ProjectContext.jsx'
// fileUrl(projectId, evidenceId, options) builds the URL of a stored file.
import { fileUrl } from '../../lib/api.js'
// Short date like "3 Oct".
import { formatShortDate } from '../../lib/format.js'
// Query/mutation hooks for documents.
import { useArchiveDocument, useCreateDocument, useDocuments } from '../../lib/queries.js'

/** Drawings, approvals, contracts: one library, each file with its fingerprint. Inspectors see drawings and approvals. */
// The page component.
export default function DocumentsPage() {
  // Project and permission check.
  const { project, can } = useProjectContext()
  // Translation function.
  const { t } = useI18n()
  // Query result destructured: data (the list), isLoading, error, refetch.
  const { data, isLoading, error, refetch } = useDocuments(project.id)
  // Archive mutation.
  const archive = useArchiveDocument(project.id)
  // Selected category filter ('' = all).
  const [category, setCategory] = useState('')
  // Search text.
  const [search, setSearch] = useState('')
  // Is the search box open?
  const [searching, setSearching] = useState(false)
  // The document open in the viewer (null = none).
  const [open, setOpen] = useState(null)
  // Is the upload sheet open?
  const [uploading, setUploading] = useState(false)
  // The document waiting for archive confirmation (null = none).
  const [archiving, setArchiving] = useState(null)
  // True when the current person is an inspector.
  const inspector = project.role === 'INSPECTOR'

  // Filtered list, recomputed only when data, category or search change. useMemo(fn, deps).
  const docs = useMemo(
    // Keep a document if (no category chosen OR it matches) AND (no search OR its title contains the search, case-insensitive).
    () => (data ?? []).filter((d) => (!category || d.category === category) && (!search.trim() || d.title.toLowerCase().includes(search.trim().toLowerCase()))),
    // Dependencies.
    [data, category, search],
  )
  // Loading placeholder.
  if (isLoading) return <PageSkeleton />
  // Error screen with retry.
  if (error) return <ErrorState error={error} onRetry={refetch} />

  // Count per category: { DRAWING: 3, CONTRACT: 1, ... }. Object.keys lists the category keys; each is mapped to a [key, count] pair; fromEntries builds the object.
  const counts = Object.fromEntries(Object.keys(DOCUMENT_CATEGORIES).map((k) => [k, data.filter((d) => d.category === k).length]))
  return (
    <Page>
      <PageTitle
        // Different title for inspectors.
        title={inspector ? t('nav.drawings') : t('nav.documents')}
        // Buttons on the right of the heading, grouped in a Fragment.
        actions={
          <>
            {/* Search toggle, only when there are more than 4 documents. The icon swaps between X and Search. Clicking flips `searching` (s => !s) and clears the text. */}
            {data.length > 4 && (
              <IconButton icon={searching ? X : Search} label={searching ? 'Close search' : 'Search documents'} onClick={() => (setSearching((s) => !s), setSearch(''))} />
            )}
            {/* "+" upload button for people allowed to upload. */}
            {can('uploadDocument') && <IconButton icon={Plus} label="Upload a document" onClick={() => setUploading(true)} variant="solid" />}
          </>
        }
      >
        {/* Children of PageTitle: the search box, shown while searching. autoFocus puts the cursor in it. */}
        {searching && <Input autoFocus aria-label="Search documents" placeholder="Search titles" value={search} onChange={(e) => setSearch(e.target.value)} />}
      </PageTitle>

      {/* Category chips, only when there are documents in more than one category (.filter(Boolean) keeps non-zero counts). */}
      {data.length > 0 && Object.values(counts).filter(Boolean).length > 1 && (
        <FilterChips
          // Reveal animation marker.
          data-reveal
          // Margin below.
          className="mb-5"
          // Accessible label.
          label="Category"
          // Controlled value.
          value={category}
          onChange={setCategory}
          // Options: "all" first, then (spread) one chip per category that has documents.
          options={[
            { value: '', label: 'all' },
            // [key, label] pairs; `([k])` destructures just the key; keep categories with a count.
            ...Object.entries(DOCUMENT_CATEGORIES)
              .filter(([k]) => counts[k])
              // Turn each pair into a chip option with its count.
              .map(([value, label]) => ({ value, label: label.toLowerCase(), count: counts[value] })),
          ]}
        />
      )}

      {/* Ternary in JSX: empty state when nothing to show, otherwise the grid. */}
      {docs.length === 0 ? (
        <div data-reveal className="card">
          <EmptyState
            // Folder icon.
            icon={FolderOpen}
            // "No match" when there are documents but the filters hide them; otherwise "none yet" (different wording for inspectors).
            title={data.length ? 'No documents match' : inspector ? 'No drawings yet' : 'No documents yet'}
            description={data.length ? 'Try another category or search.' : 'Approved drawings, the contract and approvals belong here, in one safe place.'}
          />
        </div>
      ) : (
        // Grid: 2 columns, 3 on large screens.
        <ul data-reveal className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          {/* One card per document. */}
          {docs.map((d) => (
            // `group` lets children react to hovering the card (group-hover:...); `relative` positions the menu inside it.
            <li key={d.id} className="card group relative overflow-hidden">
              {/* The whole card is a button that opens the viewer. */}
              <button onClick={() => setOpen(d)} className="block w-full text-start">
                {/* Preview area with a 4:3 shape. */}
                <span className="block aspect-[4/3] overflow-hidden bg-sunken">
                  {/* PDFs show an icon; other files (images) show the picture. */}
                  {d.mime === 'application/pdf' ? (
                    <span className="grid h-full place-items-center text-ink-3">
                      <FileText size={34} aria-hidden />
                    </span>
                  ) : (
                    // Image preview; alt="" because it is decorative (the title is next to it); loading="lazy" loads it only when near the screen. Zooms slightly on hover.
                    <img src={fileUrl(project.id, d.evidenceId)} alt="" className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.03]" loading="lazy" />
                  )}
                </span>
                {/* Title and "Category · date" below; `truncate` cuts long text with "…". */}
                <span className="block px-3.5 py-3">
                  <span className="block truncate text-body font-semibold">{d.title}</span>
                  <span className="mt-0.5 block truncate text-meta text-ink-3">
                    {DOCUMENT_CATEGORIES[d.category]} · {formatShortDate(d.createdAt)}
                  </span>
                </span>
              </button>
              {/* "..." menu in the top corner (end-2 = right in LTR, left in RTL). */}
              <div className="absolute end-2 top-2">
                {/* `trigger` is the button that opens the menu, passed as a JSX element. */}
                <Menu trigger={<IconButton icon={MoreHorizontal} size="sm" label={`Actions for ${d.title}`} className="shadow-card" />}>
                  {/* Download: open the file URL with download:true in a new tab ('_blank'). */}
                  <MenuItem icon={Download} onSelect={() => window.open(fileUrl(project.id, d.evidenceId, { download: true }), '_blank')}>
                    download
                  </MenuItem>
                  {/* Archive, only for the owner; opens the confirmation. */}
                  {can('manageProject') && (
                    <MenuItem icon={Archive} tone="danger" onSelect={() => setArchiving(d)}>
                      archive
                    </MenuItem>
                  )}
                </Menu>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Full-screen viewer. */}
      <EvidenceLightbox
        // Project for file URLs.
        projectId={project.id}
        // `open && {...}`: false when nothing is open (viewer closed), otherwise an evidence-shaped object built from the document.
        ev={
          open && {
            id: open.evidenceId,
            kind: 'DOCUMENT',
            caption: open.title,
            mime: open.mime,
            fileName: open.fileName,
            sizeBytes: open.sizeBytes,
            sha256: open.sha256,
            captureMode: 'FILE',
            receivedAt: open.createdAt,
            uploadedByName: open.uploadedByName,
          }
        }
        // Closing clears the open document.
        onClose={() => setOpen(null)}
      />
      {/* Upload sheet (component below). */}
      <UploadSheet open={uploading} onClose={() => setUploading(false)} inspector={inspector} />
      {/* Archive confirmation dialog. */}
      <ConfirmDialog
        // Open when a document is chosen (`!!` = to boolean).
        open={!!archiving}
        // Clear it when the dialog closes.
        onOpenChange={(o) => !o && setArchiving(null)}
        // `archiving?.title`: safe while null.
        title={`Archive “${archiving?.title}”?`}
        description="It's hidden from the library but kept in the record and the history."
        confirmLabel="archive"
        tone="danger"
        loading={archive.isPending}
        // Archive, then toast and close (comma operator).
        onConfirm={() => archive.mutate(archiving.id, { onSuccess: () => (toast.success('Archived'), setArchiving(null)) })}
      />
    </Page>
  )
}

// The slide-up panel for uploading a document. Props destructured: open, onClose, inspector.
function UploadSheet({ open, onClose, inspector }) {
  // Current project.
  const { project } = useProjectContext()
  // Create mutation.
  const create = useCreateDocument(project.id)
  // Uploaded files.
  const [files, setFiles] = useState([])
  // Title text.
  const [title, setTitle] = useState('')
  // Category, default DRAWING.
  const [category, setCategory] = useState('DRAWING')
  // Show errors after a try.
  const [tried, setTried] = useState(false)
  // The last uploaded file (.at(-1) = last element; undefined if none).
  const file = files.at(-1)
  // Reset everything and tell the parent to close.
  const close = () => {
    setFiles([])
    setTitle('')
    setCategory('DRAWING')
    setTried(false)
    // Call the prop function from the parent.
    onClose()
  }
  // Inspectors can only see drawings and approvals, so that's what they file.
  // Category [key, label] pairs; inspectors get only DRAWING and APPROVAL.
  const categories = Object.entries(DOCUMENT_CATEGORIES).filter(([k]) => !inspector || ['DRAWING', 'APPROVAL'].includes(k))
  return (
    <Sheet
      // Controlled open state.
      open={open}
      // Closing the sheet resets it.
      onOpenChange={(o) => !o && close()}
      title="Upload a document"
      description="Photos and PDFs up to 10 MB."
      // The footer area holds the submit button (a JSX element as a prop).
      footer={
        <Button
          // Main style, full width.
          variant="primary"
          block
          // Spinner while saving.
          loading={create.isPending}
          // Click handler with a block body.
          onClick={() => {
            // Show errors.
            setTried(true)
            // No file: stop (the uploader shows the error).
            if (!file) return
            // Create the document. Blank title falls back to the file name without its extension (regex /\.\w+$/ = a dot and letters at the end).
            // `category` is shorthand for category: category. On success: toast, then close.
            create.mutate({ title: title.trim() || file.fileName.replace(/\.\w+$/, ''), category, evidenceId: file.id }, { onSuccess: () => (toast.success('Document added'), close()) })
          }}
        >
          add to the library
        </Button>
      }
    >
      {/* Sheet body. */}
      <div className="flex flex-col gap-5">
        <EvidenceUploader
          // Project id for uploads.
          projectId={project.id}
          // Controlled file list.
          value={files}
          onChange={setFiles}
          // Error highlighting after a try.
          showErrors={tried}
          // One required file slot; pick: 'file' opens a file chooser rather than the camera.
          slots={[{ kind: 'DOCUMENT', label: 'File', hint: 'A drawing, approval letter or contract', required: true, multiple: false, pick: 'file' }]}
        />
        {/* Optional title; the hint tells which file name will be used if left blank. */}
        <Field label="Title" optional hint={file ? `Leave blank to use “${file.fileName}”.` : undefined}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Approved front elevation" />
        </Field>
        {/* Category picker built from the allowed categories. */}
        <Field label="Category" group>
          <Segmented label="Category" value={category} onChange={setCategory} size="sm" options={categories.map(([value, label]) => ({ value, label: label.toLowerCase() }))} />
        </Field>
        {/* Server error, if any. */}
        {create.error && <Notice tone="error">{create.error.message}</Notice>}
      </div>
    </Sheet>
  )
}
