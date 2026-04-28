import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  BookMarked, Plus, Trash2, X, Save, RotateCcw, FileText, Bookmark, BookmarkCheck,
} from 'lucide-react'
import { glApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'
import { useAppStore } from '../../store/appStore'
import AccountPicker from './AccountPicker'

// ── Types ─────────────────────────────────────────────────────
export interface NewLine {
  account_code: string
  debit:        string
  credit:       string
  description:  string
}

interface EntryTemplate {
  id:    string
  name:  string
  lines: NewLine[]
}

// ── Template helpers (localStorage, scoped per company) ───────
function templatesKey(companyId: number | undefined): string {
  return companyId ? `gl_entry_templates_v1_${companyId}` : 'gl_entry_templates_v1_0'
}

function loadTemplates(key: string): EntryTemplate[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]') } catch { return [] }
}

function saveTemplate(key: string, t: EntryTemplate) {
  const existing = loadTemplates(key).filter(x => x.id !== t.id)
  localStorage.setItem(key, JSON.stringify([t, ...existing].slice(0, 20)))
}

function deleteTemplate(key: string, id: string) {
  const existing = loadTemplates(key).filter(x => x.id !== id)
  localStorage.setItem(key, JSON.stringify(existing))
}

// ── Component ─────────────────────────────────────────────────
interface Props {
  onCancel: () => void
  onSaved:  () => void
}

export default function NewEntryForm({ onCancel, onSaved }: Props) {
  const { toast }  = useToast()
  const companyId  = useAppStore(s => s.company?.id)
  const tKey       = templatesKey(companyId)
  const scope      = companyId ? String(companyId) : undefined

  const [header, setHeader] = useState({
    entry_date:  new Date().toISOString().slice(0, 10),
    description: '',
  })
  const [lines, setLines] = useState<NewLine[]>([
    { account_code: '', debit: '', credit: '', description: '' },
    { account_code: '', debit: '', credit: '', description: '' },
  ])
  const [showTemplates,    setShowTemplates]    = useState(false)
  const [templates,        setTemplates]        = useState<EntryTemplate[]>(() => loadTemplates(tKey))
  const [savingName,       setSavingName]       = useState('')
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)

  const totalDebit  = lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0
  const diff        = totalDebit - totalCredit

  const addLine    = () => setLines(p => [...p, { account_code: '', debit: '', credit: '', description: '' }])
  const removeLine = (i: number) => setLines(p => p.filter((_, idx) => idx !== i))
  const updateLine = (i: number, f: Partial<NewLine>) =>
    setLines(p => p.map((l, idx) => idx === i ? { ...l, ...f } : l))

  function applyTemplate(t: EntryTemplate) {
    setLines(t.lines.map(l => ({ ...l })))
    if (t.name) setHeader(h => ({ ...h, description: h.description || t.name }))
    setShowTemplates(false)
    toast(`تم تطبيق القالب: ${t.name}`, 'success')
  }

  function handleSaveTemplate() {
    if (!savingName.trim()) return
    const t: EntryTemplate = {
      id:    Date.now().toString(),
      name:  savingName.trim(),
      lines: lines.filter(l => l.account_code),
    }
    saveTemplate(tKey, t)
    setTemplates(loadTemplates(tKey))
    setSavingName('')
    setShowSaveTemplate(false)
    toast('تم حفظ القالب', 'success')
  }

  const saveMutation = useMutation({
    mutationFn: () => glApi.createEntry({
      entry_date:  header.entry_date,
      description: header.description,
      lines: lines
        .filter(l => l.account_code && (Number(l.debit) > 0 || Number(l.credit) > 0))
        .map(l => ({
          account_code: l.account_code,
          debit:        Number(l.debit)  || 0,
          credit:       Number(l.credit) || 0,
          description:  l.description || undefined,
        })),
    }),
    onSuccess: (res: { success: boolean; error?: string }) => {
      if (!res.success) { toast(res.error ?? 'خطأ', 'error'); return }
      toast('تم حفظ القيد وترحيله بنجاح', 'success')
      onSaved()
    },
    onError: () => toast('فشل حفظ القيد', 'error'),
  })

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-fade-in">
      {/* Form Header */}
      <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-purple-600 to-blue-600">
        <div className="flex items-center gap-2 text-white">
          <BookMarked size={18} />
          <span className="font-bold text-sm">قيد يومية يدوي جديد</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTemplates(s => !s)}
            className="flex items-center gap-1 text-white/80 hover:text-white text-xs border border-white/30 hover:border-white/60 px-2.5 py-1 rounded-lg transition-all"
            title="القوالب المحفوظة"
          >
            <Bookmark size={13} /> قوالب
            {templates.length > 0 && (
              <span className="bg-white/20 text-white text-[10px] px-1 rounded">{templates.length}</span>
            )}
          </button>
          <button onClick={onCancel} className="text-white/70 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Templates Panel */}
      {showTemplates && (
        <div className="px-5 py-3 bg-purple-50 border-b border-purple-100">
          {templates.length === 0 ? (
            <p className="text-xs text-slate-400">لا توجد قوالب محفوظة. أكمل القيد وانقر "حفظ كقالب".</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {templates.map(t => (
                <div key={t.id} className="flex items-center gap-1 bg-white border border-purple-200 rounded-lg px-2 py-1 text-xs">
                  <button
                    onClick={() => applyTemplate(t)}
                    className="text-purple-700 font-medium hover:text-purple-900 transition-colors"
                  >
                    <BookmarkCheck size={11} className="inline ml-1" />
                    {t.name}
                    <span className="text-slate-400 mr-1">({t.lines.length} سطر)</span>
                  </button>
                  <button
                    onClick={() => { deleteTemplate(tKey, t.id); setTemplates(loadTemplates(tKey)) }}
                    className="text-slate-300 hover:text-red-400 transition-colors p-0.5"
                    title="حذف القالب"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Meta fields */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4 border-b border-slate-100 bg-slate-50/50">
        <div>
          <label className="label">التاريخ *</label>
          <input
            className="input"
            type="date"
            value={header.entry_date}
            onChange={e => setHeader(p => ({ ...p, entry_date: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">البيان *</label>
          <input
            className="input"
            value={header.description}
            onChange={e => setHeader(p => ({ ...p, description: e.target.value }))}
            placeholder="مثال: قيد افتتاحي / تسوية حسابية..."
            autoFocus
          />
        </div>
      </div>

      {/* Lines grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="th text-right w-8 text-slate-400">#</th>
              <th className="th text-right">الحساب</th>
              <th className="th text-right w-40">مدين</th>
              <th className="th text-right w-40">دائن</th>
              <th className="th text-right">بيان السطر</th>
              <th className="th w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr
                key={i}
                className={`border-b border-slate-100 transition-colors ${
                  l.account_code ? 'bg-white hover:bg-slate-50/50' : 'bg-slate-50/30'
                }`}
              >
                <td className="td text-slate-300 text-xs text-center">{i + 1}</td>
                <td className="td">
                  <AccountPicker
                    value={l.account_code || null}
                    onChange={v => updateLine(i, { account_code: v ?? '' })}
                    compact
                    showFavorites
                    storageScope={scope}
                  />
                </td>
                <td className="td">
                  <input
                    className={`input text-xs py-1 w-full tabular-nums text-left ${
                      Number(l.debit) > 0 ? 'border-red-300 bg-red-50/50 font-semibold text-red-700' : ''
                    }`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.debit}
                    placeholder="0"
                    onChange={e => updateLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })}
                  />
                </td>
                <td className="td">
                  <input
                    className={`input text-xs py-1 w-full tabular-nums text-left ${
                      Number(l.credit) > 0 ? 'border-green-300 bg-green-50/50 font-semibold text-green-700' : ''
                    }`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.credit}
                    placeholder="0"
                    onChange={e => updateLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })}
                  />
                </td>
                <td className="td">
                  <input
                    className="input text-xs py-1 w-full"
                    value={l.description}
                    placeholder="اختياري..."
                    onChange={e => updateLine(i, { description: e.target.value })}
                  />
                </td>
                <td className="td">
                  {lines.length > 2 && (
                    <button
                      onClick={() => removeLine(i)}
                      className="text-slate-300 hover:text-red-500 transition-colors p-1 rounded"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>

          {/* Totals footer */}
          <tfoot>
            <tr className="bg-slate-50 border-t-2 border-slate-200">
              <td className="td text-xs font-bold text-slate-500" colSpan={2}>
                الإجمالي ({lines.filter(l => l.account_code).length} سطر)
              </td>
              <td className="td">
                <span className={`text-sm font-black tabular-nums ${isBalanced ? 'text-emerald-700' : 'text-red-600'}`}>
                  {Number(totalDebit).toLocaleString('en-US')}
                </span>
              </td>
              <td className="td">
                <span className={`text-sm font-black tabular-nums ${isBalanced ? 'text-emerald-700' : 'text-red-600'}`}>
                  {Number(totalCredit).toLocaleString('en-US')}
                </span>
              </td>
              <td className="td" colSpan={2}>
                {!isBalanced && totalDebit > 0 && (
                  <span className="text-xs text-red-500 font-medium">
                    فرق: {Math.abs(diff).toLocaleString('en-US')} {diff > 0 ? '(مدين زائد)' : '(دائن زائد)'}
                  </span>
                )}
                {isBalanced && (
                  <span className="text-xs text-emerald-600 font-medium">✓ القيد متوازن</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50/80 border-t border-slate-100">
        <div className="flex items-center gap-2">
          <button
            onClick={addLine}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg transition-all"
          >
            <Plus size={14} /> إضافة سطر
          </button>
          <button
            onClick={() => setShowSaveTemplate(s => !s)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-purple-600 border border-slate-200 hover:border-purple-300 px-2.5 py-1.5 rounded-lg transition-all"
            title="حفظ كقالب للاستخدام لاحقاً"
          >
            <Bookmark size={12} /> حفظ كقالب
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="btn-secondary gap-1.5 text-sm">
            <RotateCcw size={13} /> إلغاء
          </button>
          <button
            className="btn-primary gap-1.5 shadow-lg shadow-blue-100"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !header.entry_date || !header.description || !isBalanced}
          >
            <Save size={13} />
            {saveMutation.isPending ? 'جاري الحفظ...' : 'ترحيل القيد'}
          </button>
        </div>
      </div>

      {/* Save as template panel */}
      {showSaveTemplate && (
        <div className="px-5 py-3 bg-purple-50/80 border-t border-purple-100 flex items-center gap-3">
          <FileText size={14} className="text-purple-500 shrink-0" />
          <input
            className="input text-xs h-8 flex-1 max-w-xs"
            placeholder="اسم القالب (مثال: رسوم بنكية شهرية)"
            value={savingName}
            onChange={e => setSavingName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveTemplate()}
            autoFocus
          />
          <button
            onClick={handleSaveTemplate}
            disabled={!savingName.trim() || lines.filter(l => l.account_code).length === 0}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
          >
            حفظ
          </button>
          <button onClick={() => setShowSaveTemplate(false)} className="text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
