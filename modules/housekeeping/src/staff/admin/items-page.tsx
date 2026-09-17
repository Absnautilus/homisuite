import { useEffect, useState } from 'react'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Languages, Trash2 } from 'lucide-react'
import { FieldError, FieldGroup, Input, Label, Select, Textarea } from '@/components/ui/field'
import { Switch, SwitchControl } from '@/components/ui/switch'
import { AutoText } from '@/components/auto-text'
import { CategoryIcon } from '@/components/category-icon'
import { IconPicker } from '@/components/icon-picker'
import { MansioniPicker } from '@/components/mansioni-picker'
import { useToast } from '@/components/toast-context'
import {
  createRequestCategory,
  createRequestType,
  deleteRequestCategory,
  deleteRequestType,
  listMenu,
  listPropertyJobTitles,
  setCategoryJobTitles,
  setRequestCategoryActive,
  setRequestTypeActive,
  updateRequestCategoryIcon,
  updateRequestCategoryName,
  updateRequestCategoryTranslations,
  updateRequestTypeDescription,
  updateRequestTypeName,
  updateRequestTypeTranslations,
  type JobTitleOption,
  type RequestCategoryAdmin,
  type RequestTypeAdmin,
} from '@/lib/admin-api'
import { LOCALES } from '@/lib/i18n/locales'
import { removeCategoryWithItems, removeMenuItem } from '@/lib/menu-removal'
import { useConfirm } from '@/components/confirm-dialog'
import { useLocale } from '@/lib/i18n/locale-context'
import { cn } from '@/lib/cn'

const TRANSLATABLE_LOCALES = LOCALES.filter((l) => l.code !== 'it')
const IT_LOCALE = LOCALES.find((l) => l.code === 'it')!

export function ItemsPage({ hotelId }: { hotelId: string }) {
  const { t } = useLocale()
  const { push } = useToast()
  const [categories, setCategories] = useState<RequestCategoryAdmin[]>([])
  const [types, setTypes] = useState<RequestTypeAdmin[]>([])
  const [jobTitles, setJobTitles] = useState<JobTitleOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmDialog, confirm] = useConfirm()
  const [removedCategoryIds, setRemovedCategoryIds] = useState<Set<string>>(new Set())
  const [removedTypeIds, setRemovedTypeIds] = useState<Set<string>>(new Set())

  async function reload() {
    const [menu, jobTitleOptions] = await Promise.all([listMenu(hotelId), listPropertyJobTitles(hotelId)])
    setCategories(menu.categories)
    setTypes(menu.types)
    setJobTitles(jobTitleOptions)
  }

  useEffect(() => {
    reload().catch(() => setError(t('staff.items.loadError')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelId])

  async function onToggleCategory(category: RequestCategoryAdmin) {
    if (category.active) {
      const ok = await confirm({ title: t('staff.items.categoryDeactivateTitle'), description: t('staff.items.categoryDeactivateDesc', { name: category.name }), confirmLabel: t('staff.items.categoryDeactivateConfirm') })
      if (!ok) return
    }
    setError(null)
    const next = !category.active
    setCategories((current) => current.map((c) => (c.id === category.id ? { ...c, active: next } : c)))
    try {
      await setRequestCategoryActive(category.id, next)
      push(t(next ? 'common.toast.activated' : 'common.toast.deactivated'), 'success')
    } catch {
      setCategories((current) => current.map((c) => (c.id === category.id ? { ...c, active: category.active } : c)))
      setError(t('staff.items.toggleError'))
    }
  }

  async function onToggleItem(item: RequestTypeAdmin) {
    setError(null)
    const next = !item.active
    setTypes((current) => current.map((rt) => (rt.id === item.id ? { ...rt, active: next } : rt)))
    try {
      await setRequestTypeActive(item.id, next)
      push(t(next ? 'common.toast.activated' : 'common.toast.deactivated'), 'success')
    } catch {
      setTypes((current) => current.map((rt) => (rt.id === item.id ? { ...rt, active: item.active } : rt)))
      setError(t('staff.items.toggleError'))
    }
  }

  // request_types.category_id and guest_requests.request_type_id are plain
  // foreign keys with no ON DELETE clause (see admin-api.ts), so Postgres
  // rejects (23503) deleting a category that still has items, or an item any
  // request -- current or historical -- still references. When the category
  // is blocked by its own items (not by their request history), removing a
  // category is expected to take its items with it -- so this cascades: try
  // deleting every item in the category first (same delete-or-deactivate
  // fallback as onRemoveItem for each one), then retry the category. It only
  // still needs deactivating instead if some item couldn't actually be
  // deleted (real request history), the same guardrail as rooms-page's
  // deleteRoom -- never leaving a row un-deleted and silently reappearing on
  // the next reload.
  async function onRemoveCategory(category: RequestCategoryAdmin) {
    const ok = await confirm({ title: t('staff.items.categoryRemoveTitle'), description: t('staff.items.categoryRemoveDesc', { name: category.name }), confirmLabel: t('staff.items.categoryRemoveConfirm') })
    if (!ok) return
    setError(null)
    try {
      const result = await removeCategoryWithItems(category.id, types, {
        deleteCategory: deleteRequestCategory,
        deleteItem: deleteRequestType,
        deactivateCategory: (id) => setRequestCategoryActive(id, false),
        deactivateItem: (id) => setRequestTypeActive(id, false),
      })
      if (result.deletedItemIds.length > 0) {
        setRemovedTypeIds((current) => new Set([...current, ...result.deletedItemIds]))
      }
      if (result.deactivatedItemIds.length > 0) {
        const deactivatedIds = new Set(result.deactivatedItemIds)
        setTypes((current) => current.map((item) => (deactivatedIds.has(item.id) ? { ...item, active: false } : item)))
      }
      setRemovedCategoryIds((current) => new Set(current).add(category.id))
      if (result.outcome === 'deleted') {
        push(t('common.toast.removed'), 'success')
      } else {
        setCategories((current) => current.map((item) => (item.id === category.id ? { ...item, active: false } : item)))
        setError(t('staff.items.categoryRemoveBlockedDeactivated'))
      }
    } catch {
      await reload().catch(() => undefined)
      setError(t('staff.items.categoryRemoveError'))
    }
  }

  async function onRemoveItem(item: RequestTypeAdmin) {
    const ok = await confirm({ title: t('staff.items.removeTitle'), description: t('staff.items.removeDesc', { name: item.name }), confirmLabel: t('staff.items.removeConfirm') })
    if (!ok) return
    setError(null)
    try {
      const result = await removeMenuItem(item.id, {
        deleteItem: deleteRequestType,
        deactivateItem: (id) => setRequestTypeActive(id, false),
      })
      if (result === 'deactivated') {
        setTypes((current) => current.map((currentItem) => (currentItem.id === item.id ? { ...currentItem, active: false } : currentItem)))
        setError(t('staff.items.removeBlockedDeactivated'))
      } else {
        push(t('common.toast.removed'), 'success')
      }
      setRemovedTypeIds((current) => new Set(current).add(item.id))
    } catch {
      setError(t('staff.items.removeError'))
    }
  }

  const activeCategories = categories.filter((c) => c.active)
  const visibleCategories = categories.filter((c) => !removedCategoryIds.has(c.id))
  const visibleTypes = types.filter((rt) => !removedTypeIds.has(rt.id))

  return (
    <div className="space-y-6">
      {confirmDialog}
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t('staff.items.title')}</h1>
        <p className="text-sm text-muted">{t('staff.items.subtitle')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-bad-ink">{error}</p>}
      <NewCategoryForm jobTitles={jobTitles} onCreated={reload} />
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table aria-label={t('staff.items.title')} className="w-full min-w-max text-sm"><thead className="bg-surface-2 text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">{t('staff.items.colIcon')}</th><th className="px-4 py-2">{t('staff.items.colName')}</th><th className="px-4 py-2">{t('staff.items.colJobTitles')}</th><th className="px-4 py-2">{t('staff.items.colStatus')}</th><th className="px-4 py-2" /></tr></thead><tbody className="divide-y divide-line">{visibleCategories.map((category) => <CategoryRow key={category.id} category={category} jobTitles={jobTitles} onToggle={() => onToggleCategory(category)} onRemove={() => onRemoveCategory(category)} onSaved={reload} />)}</tbody></table>
      </div>
      <NewItemForm categories={activeCategories} onCreated={reload} />
      <div className="space-y-6">{visibleCategories.map((category) => { const items = visibleTypes.filter((rt) => rt.category_id === category.id); if (items.length === 0) return null; const headingId = `category-${category.id}`; return <div key={category.id}><h2 id={headingId} className="mb-2 text-sm font-semibold text-muted"><AutoText text={category.name} translations={category.name_i18n} /></h2><div className="overflow-x-auto rounded-lg border border-line bg-white"><table aria-labelledby={headingId} className="w-full min-w-max text-sm"><thead className="bg-surface-2 text-left text-xs uppercase text-muted"><tr><th className="px-4 py-2">{t('staff.items.colName')}</th><th className="px-4 py-2">{t('staff.items.colDescription')}</th><th className="px-4 py-2">{t('staff.items.colQuantity')}</th><th className="px-4 py-2">{t('staff.items.colStatus')}</th><th className="px-4 py-2" /></tr></thead><tbody className="divide-y divide-line">{items.map((item) => <ItemRow key={item.id} item={item} onToggle={() => onToggleItem(item)} onRemove={() => onRemoveItem(item)} onSaved={reload} />)}</tbody></table></div></div> })}</div>
    </div>
  )
}

function CategoryRow({ category, jobTitles, onToggle, onRemove, onSaved }: { category: RequestCategoryAdmin; jobTitles: JobTitleOption[]; onToggle: () => void; onRemove: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLocale(); const [open, setOpen] = useState(false); const [pickerOpen, setPickerOpen] = useState(false); const [mansioniOpen, setMansioniOpen] = useState(false)
  async function onIconSave(icon: string) {
    await updateRequestCategoryIcon(category.id, icon)
    await onSaved()
  }
  async function onMansioniSave(jobTitleIds: string[]) {
    await setCategoryJobTitles(category.id, jobTitleIds)
    await onSaved()
  }
  const jobTitleNames = category.job_title_ids
    .map((id) => jobTitles.find((jt) => jt.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  return <><tr><td className="relative px-4 py-2"><button type="button" title={t('staff.items.iconChange')} onClick={() => setPickerOpen((v) => !v)} className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border-[1.5px] border-line bg-surface-2 text-muted transition-colors hover:border-accent-soft-line hover:bg-accent-soft hover:text-accent"><CategoryIcon icon={category.icon} className="h-[17px] w-[17px]" /></button>{pickerOpen && <IconPicker value={category.icon} onSave={onIconSave} onClose={() => setPickerOpen(false)} />}</td><td className="px-4 py-2 font-medium text-foreground"><AutoText text={category.name} translations={category.name_i18n} /></td><td className="relative px-4 py-2"><button type="button" onClick={() => setMansioniOpen((v) => !v)} className="flex max-w-[220px] flex-wrap items-center gap-1 text-left">{jobTitleNames.length > 0 ? jobTitleNames.map((name) => <span key={name} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{name}</span>) : <span className="text-xs text-muted underline decoration-dotted">{t('staff.items.categoryJobTitlesNone')}</span>}</button>{mansioniOpen && <MansioniPicker jobTitles={jobTitles} value={category.job_title_ids} onSave={onMansioniSave} onClose={() => setMansioniOpen(false)} />}</td><td className="px-4 py-2"><SwitchControl checked={category.active} onCheckedChange={onToggle} aria-label={category.active ? t('staff.items.deactivate') : t('staff.items.reactivate')} /></td><td className="px-4 py-2 text-right whitespace-nowrap"><div className="flex justify-end gap-2"><IconButton tone="neutral" icon={Languages} label={t('staff.items.translations')} onClick={() => setOpen((v) => !v)} /><IconButton tone="danger" icon={Trash2} label={t('staff.items.remove')} onClick={onRemove} /></div></td></tr>{open && <tr><td colSpan={5} className="bg-surface-2 px-4 py-3"><NameTranslationsForm baseName={category.name} initial={category.name_i18n} onSave={async (name_i18n) => { await updateRequestCategoryTranslations(category.id, name_i18n); await onSaved() }} onSaveBaseName={async (name) => { await updateRequestCategoryName(category.id, name); await onSaved() }} /></td></tr>}</>
}

function ItemRow({ item, onToggle, onRemove, onSaved }: { item: RequestTypeAdmin; onToggle: () => void; onRemove: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLocale(); const [open, setOpen] = useState(false)
  return <><tr><td className="px-4 py-2 font-medium text-foreground"><AutoText text={item.name} translations={item.name_i18n} /></td><td className="px-4 py-2 text-muted">{item.description ? <AutoText text={item.description} translations={item.description_i18n} /> : '—'}</td><td className="px-4 py-2 tabular-nums text-muted">{item.available_quantity ?? '—'}</td><td className="px-4 py-2"><SwitchControl checked={item.active} onCheckedChange={onToggle} aria-label={item.active ? t('staff.items.deactivate') : t('staff.items.reactivate')} /></td><td className="px-4 py-2 text-right whitespace-nowrap"><div className="flex justify-end gap-2"><IconButton tone="neutral" icon={Languages} label={t('staff.items.translations')} onClick={() => setOpen((v) => !v)} /><IconButton tone="danger" icon={Trash2} label={t('staff.items.remove')} onClick={onRemove} /></div></td></tr>{open && <tr><td colSpan={5} className="bg-surface-2 px-4 py-3"><div className="space-y-4"><NameTranslationsForm label={t('staff.items.name')} baseName={item.name} initial={item.name_i18n} onSave={async (name_i18n) => { await updateRequestTypeTranslations(item.id, { name_i18n, description_i18n: item.description_i18n }); await onSaved() }} onSaveBaseName={async (name) => { await updateRequestTypeName(item.id, name); await onSaved() }} />{item.description && <NameTranslationsForm label={t('staff.items.description')} baseName={item.description} initial={item.description_i18n} onSave={async (description_i18n) => { await updateRequestTypeTranslations(item.id, { name_i18n: item.name_i18n, description_i18n }); await onSaved() }} onSaveBaseName={async (description) => { await updateRequestTypeDescription(item.id, description); await onSaved() }} />}</div></td></tr>}</>
}

function NameTranslationsForm({
  label,
  baseName,
  initial,
  onSave,
  onSaveBaseName,
}: {
  label?: string
  baseName: string
  initial: Record<string, string>
  onSave: (values: Record<string, string>) => Promise<void>
  // name_i18n/description_i18n never carry an 'it' entry -- baseName itself
  // plays that role, but until now nothing let an admin correct it when it
  // was typed wrong or, e.g., isn't actually Italian to begin with.
  onSaveBaseName?: (value: string) => Promise<void>
}) {
  const { t } = useLocale()
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(TRANSLATABLE_LOCALES.map((l) => [l.code, initial[l.code] ?? ''])))
  const [baseValue, setBaseValue] = useState(baseName)
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setSaved(false)
    try {
      const cleaned = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''))
      const trimmedBase = baseValue.trim()
      await Promise.all([onSave(cleaned), onSaveBaseName && trimmedBase !== baseName ? onSaveBaseName(trimmedBase) : Promise.resolve()])
      setSaved(true)
    } finally { setPending(false) }
  }
  return <form onSubmit={onSubmit}><p className="mb-2 text-xs font-semibold text-muted">{label ? `${t('staff.items.translations')} — ${label}` : t('staff.items.translations')}</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{onSaveBaseName && <div><Label htmlFor={`tr-it-${baseName}`}>{IT_LOCALE.label}</Label><Input id={`tr-it-${baseName}`} required value={baseValue} onChange={(e) => setBaseValue(e.target.value)} /></div>}{TRANSLATABLE_LOCALES.map((l) => <div key={l.code}><Label htmlFor={`tr-${l.code}-${baseName}`}>{l.label}</Label><Input id={`tr-${l.code}-${baseName}`} value={values[l.code] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [l.code]: e.target.value }))} placeholder={baseValue} /></div>)}</div><div className="mt-2 flex items-center gap-2"><Button type="submit" size="sm" disabled={pending}>{pending ? t('staff.items.translationsSaving') : t('staff.items.translationsSave')}</Button>{saved && !pending && <span className="text-xs text-ok-ink">{t('staff.items.translationsSaved')}</span>}</div></form>
}

function NewCategoryForm({ jobTitles, onCreated }: { jobTitles: JobTitleOption[]; onCreated: () => Promise<void> }) {
  const { t } = useLocale(); const [name, setName] = useState(''); const [jobTitleIds, setJobTitleIds] = useState<string[]>([]); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null)
  function toggleJobTitle(id: string) {
    setJobTitleIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]))
  }
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setError(null)
    try {
      await createRequestCategory({ name: name.trim(), jobTitleIds })
      setName(''); setJobTitleIds([])
      await onCreated()
    } catch { setError(t('staff.items.addCategoryError')) } finally { setPending(false) }
  }
  return <Card><CardHeader><h2 className="text-sm font-semibold text-foreground">{t('staff.items.addCategoryTitle')}</h2></CardHeader><CardBody><form onSubmit={onSubmit} className="space-y-4">
    <FieldGroup className="mb-0"><Label htmlFor="categoryName" required>{t('staff.items.categoryName')}</Label><Input id="categoryName" required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('staff.items.categoryNamePlaceholder')} /></FieldGroup>
    <FieldGroup className="mb-0">
      <Label>{t('staff.items.categoryJobTitles')}</Label>
      {jobTitles.length === 0 ? (
        <p className="text-xs text-muted">{t('staff.items.categoryJobTitlesEmpty')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {jobTitles.map((jt) => (
            <label key={jt.id} className={cn('flex cursor-pointer items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1.5 text-xs font-semibold transition-colors', jobTitleIds.includes(jt.id) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:border-accent-soft-line')}>
              <input type="checkbox" className="sr-only" checked={jobTitleIds.includes(jt.id)} onChange={() => toggleJobTitle(jt.id)} />
              {jt.name}
            </label>
          ))}
        </div>
      )}
    </FieldGroup>
    <FieldError>{error ?? undefined}</FieldError>
    <div className="flex justify-end border-t border-line pt-4"><Button type="submit" disabled={pending}>{pending ? t('staff.items.addCategorySubmitPending') : t('staff.items.addCategorySubmit')}</Button></div>
  </form></CardBody></Card>
}

function NewItemForm({ categories, onCreated }: { categories: RequestCategoryAdmin[]; onCreated: () => Promise<void> }) {
  const { t } = useLocale(); const [categoryId, setCategoryId] = useState(''); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [allowsQuantity, setAllowsQuantity] = useState(false); const [availableQuantity, setAvailableQuantity] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null)
  useEffect(() => { setCategoryId((current) => (current && categories.some((c) => c.id === current) ? current : (categories[0]?.id ?? ''))) }, [categories])
  async function onSubmit(e: React.FormEvent) { e.preventDefault(); setPending(true); setError(null); try { await createRequestType({ categoryId, name: name.trim(), description: description.trim() || null, allowsQuantity, availableQuantity: availableQuantity.trim() ? Number(availableQuantity) : null }); setName(''); setDescription(''); setAllowsQuantity(false); setAvailableQuantity(''); await onCreated() } catch { setError(t('staff.items.addError')) } finally { setPending(false) } }
  return <Card><CardHeader><h2 className="text-sm font-semibold text-foreground">{t('staff.items.addTitle')}</h2></CardHeader><CardBody><form onSubmit={onSubmit} className="space-y-4"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FieldGroup className="mb-0"><Label htmlFor="category" required>{t('staff.items.category')}</Label><Select id="category" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}><AutoText text={c.name} translations={c.name_i18n} /></option>)}</Select></FieldGroup><FieldGroup className="mb-0"><Label htmlFor="itemName" required>{t('staff.items.name')}</Label><Input id="itemName" required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('staff.items.namePlaceholder')} /></FieldGroup></div><FieldGroup className="mb-0"><Label htmlFor="description">{t('staff.items.description')}</Label><Textarea id="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></FieldGroup><div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><FieldGroup className="mb-0"><Label htmlFor="availableQuantity">{t('staff.items.availableQuantity')}</Label><Input id="availableQuantity" type="number" min={0} value={availableQuantity} onChange={(e) => setAvailableQuantity(e.target.value)} placeholder={t('staff.items.availableQuantityPlaceholder')} /></FieldGroup><Switch id="allowsQuantity" checked={allowsQuantity} onCheckedChange={setAllowsQuantity} label={t('staff.items.allowsQuantity')} className="self-end" /></div><FieldError>{error ?? undefined}</FieldError><div className="flex justify-end border-t border-line pt-4"><Button type="submit" disabled={pending || !categoryId}>{pending ? t('staff.items.submitPending') : t('staff.items.submit')}</Button></div></form></CardBody></Card>
}
