import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BrainCircuit, Filter, DatabaseZap, Search, ChevronLeft, Plus, CheckCircle2, Trash2, ArrowRight } from 'lucide-react'
import { classifierApi, configApi, suppliersApi, treasuryApi } from '../../api/client'
import { useToast } from '../../contexts/ToastContext'

type CategoryType = 'expense' | 'supplier' | 'partner' | 'bank' | 'cost_center'

export default function SmartClassifierPage() {
  const qc = useQueryClient()
  const toast = useToast()
  const [activeTab, setActiveTab] = useState<'unmapped' | 'rules'>('unmapped')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedText, setSelectedText] = useState<{ narration: string; count: number } | null>(null)

  const { data: unmapped = [], isLoading: isLoadingUnmapped } = useQuery({
    queryKey: ['dlce-unmapped'],
    queryFn: classifierApi.getUnmapped,
    staleTime: 30_000,
  })

  const { data: rules = [], isLoading: isLoadingRules } = useQuery({
    queryKey: ['dlce-rules'],
    queryFn: classifierApi.getRules,
  })

  const filteredUnmapped = useMemo(() => {
    if (!searchQuery) return unmapped
    return unmapped.filter(u => u.narration.includes(searchQuery))
  }, [unmapped, searchQuery])

  const delRuleMut = useMutation({
    mutationFn: classifierApi.deleteRule,
    onSuccess: () => {
      toast.success('تم حذف القاعدة بنجاح')
      qc.invalidateQueries({ queryKey: ['dlce-rules'] })
      qc.invalidateQueries({ queryKey: ['dlce-unmapped'] })
    }
  })

  const reconMut = useMutation({
    mutationFn: classifierApi.reconcileLegacy,
    onSuccess: (res) => {
      toast.success(`تم تسوية وتصحيح ${res.updated_count} قيد تاريخي بنجاح!`)
      qc.invalidateQueries({ queryKey: ['dlce-unmapped'] })
    }
  })

  return (
    <div className="flex h-screen bg-gray-50/50" dir="rtl">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-5 shrink-0 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-md shadow-indigo-200">
              <BrainCircuit className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">المُصنّف الذكي (DLCE)</h1>
              <p className="text-sm text-slate-500 mt-1">توجيه البيانات التاريخية وبناء القواعد المحاسبية أوتوماتيكياً</p>
            </div>
          </div>
          <button
            onClick={() => { if(confirm('هل أنت متأكد من تطبيق القواعد بأثر رجعي على كل القيود القديمة؟')) reconMut.mutate() }}
            disabled={reconMut.isPending || rules.length === 0}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-sm"
          >
            <DatabaseZap size={18} />
            {reconMut.isPending ? 'جاري التطبيق...' : 'تطبيق القواعد بأثر رجعي'}
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 border-b border-gray-200 shrink-0 flex gap-6">
          <button
            onClick={() => setActiveTab('unmapped')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'unmapped' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <Filter size={16} />
              بيانات غير مصنفة
              <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{unmapped.length}</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'rules' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <div className="flex items-center gap-2">
              <DatabaseZap size={16} />
              القواعد النشطة
              <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{rules.length}</span>
            </div>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'unmapped' && (
            <div className="max-w-5xl mx-auto space-y-4">
              <div className="relative">
                <Search className="absolute right-3 top-2.5 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="ابحث في البيانات القديمة غير المصنفة..."
                  className="w-full pl-4 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-shadow"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>

              {isLoadingUnmapped ? (
                <div className="py-20 text-center text-gray-400">جاري مسح البيانات التاريخية...</div>
              ) : filteredUnmapped.length === 0 ? (
                <div className="py-20 text-center flex flex-col items-center">
                  <CheckCircle2 size={48} className="text-emerald-400 mb-4" />
                  <h3 className="text-lg font-bold text-gray-900">عمل رائع!</h3>
                  <p className="text-gray-500 mt-1">تم تصنيف جميع حركات الخزينة السابقة بنجاح.</p>
                </div>
              ) : (
                <div className="grid gap-3">
                  {filteredUnmapped.map((u, i) => (
                    <div
                      key={i}
                      onClick={() => setSelectedText({ narration: u.narration, count: u.occurrences })}
                      className="bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-50 cursor-pointer transition-all flex items-center justify-between group"
                    >
                      <div className="flex-1">
                        <p className="font-semibold text-gray-800 font-mono text-sm">{u.narration}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          تكررت <span className="font-bold text-indigo-600">{u.occurrences}</span> مرات — 
                          إجمالي الحجم المالي: <span className="font-bold text-gray-700">{u.total_volume.toLocaleString()} ج.م</span>
                        </p>
                      </div>
                      <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight size={16} className="-rotate-135" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'rules' && (
            <div className="max-w-5xl mx-auto">
              <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-sm text-right">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-6 py-4 text-gray-500 font-semibold w-1/3">الكلمة المفتاحية (Keyword)</th>
                      <th className="px-6 py-4 text-gray-500 font-semibold w-1/4">التصنيف</th>
                      <th className="px-6 py-4 text-gray-500 font-semibold flex-1">الربط (الهدف)</th>
                      <th className="px-6 py-4 w-16"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rules.map(r => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <code className="bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg font-mono text-xs font-bold border border-indigo-100">
                            {r.keyword}
                          </code>
                        </td>
                        <td className="px-6 py-4">
                          {r.category_type === 'expense' && <span className="text-rose-600 bg-rose-50 px-2 py-1 rounded text-xs font-bold">مصروف</span>}
                          {r.category_type === 'supplier' && <span className="text-emerald-600 bg-emerald-50 px-2 py-1 rounded text-xs font-bold">مورد</span>}
                          {r.category_type === 'partner' && <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded text-xs font-bold">شريك</span>}
                        </td>
                        <td className="px-6 py-4 font-medium text-gray-800">
                          {r.expense_name || r.supplier_name || r.partner_name || `ID: ${r.target_id}`}
                        </td>
                        <td className="px-6 py-4">
                          <button onClick={() => delRuleMut.mutate(r.id)} className="text-gray-400 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors">
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rules.length === 0 && !isLoadingRules && (
                      <tr><td colSpan={4} className="px-6 py-12 text-center text-gray-400">لا توجد قواعد مسجلة حتى الآن</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar: Classification Builder */}
      {selectedText && (
        <div className="w-96 bg-white border-r border-gray-200 shadow-2xl flex flex-col shrink-0 animate-in slide-in-from-left-8">
          <div className="p-5 border-b flex items-center gap-3">
            <button onClick={() => setSelectedText(null)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
              <ChevronLeft size={20} />
            </button>
            <h2 className="font-bold text-lg text-slate-800">بناء قاعدة جديدة</h2>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 block">النص الأصلي (للمرجعية)</label>
              <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-sm font-mono text-slate-600 select-all">
                {selectedText.narration}
              </div>
            </div>

            <RuleBuilderForm 
              initialKeyword={selectedText.narration} 
              onSuccess={() => {
                setSelectedText(null)
                qc.invalidateQueries({ queryKey: ['dlce-unmapped'] })
                qc.invalidateQueries({ queryKey: ['dlce-rules'] })
                toast.success('تم بناء القاعدة بنجاح!')
              }} 
            />
          </div>
        </div>
      )}
    </div>
  )
}

function RuleBuilderForm({ initialKeyword, onSuccess }: { initialKeyword: string, onSuccess: () => void }) {
  const toast = useToast()
  const [keyword, setKeyword] = useState(initialKeyword)
  const [category, setCategory] = useState<CategoryType>('expense')
  const [targetId, setTargetId] = useState<string>('')

  // Load dropdown data
  const { data: expenses = [] } = useQuery<{code: number, name: string}[]>({ queryKey: ['config', 'expenses'], queryFn: () => configApi.expenseTypes() as Promise<{code: number, name: string}[]> })
  const { data: suppliers = [] } = useQuery<{code: number, name: string}[]>({ queryKey: ['suppliers'], queryFn: () => suppliersApi.list() as Promise<{code: number, name: string}[]> })
  const { data: partners = [] } = useQuery<{id: number, name: string}[]>({ queryKey: ['partners'], queryFn: () => treasuryApi.partners() as Promise<{id: number, name: string}[]> })

  const saveMut = useMutation({
    mutationFn: classifierApi.createRule,
    onSuccess
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!keyword.trim() || !targetId) return
    saveMut.mutate({
      keyword: keyword.trim(),
      category_type: category,
      target_id: Number(targetId)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="text-xs font-bold text-gray-700 mb-2 flex items-center justify-between">
          <span>الكلمة المفتاحية المُستخرجة</span>
          <span className="text-indigo-600 font-normal text-[10px]">امسح الزوائد لتبقى الكلمة الدالة فقط</span>
        </label>
        <input
          type="text" required
          value={keyword}
          onChange={e => setKeyword(e.target.value)}
          className="w-full border-2 border-indigo-100 focus:border-indigo-500 rounded-xl px-4 py-3 bg-indigo-50/30 text-indigo-900 font-bold outline-none transition-colors"
          placeholder="مثال: الميكنة، شركة عرفة..."
        />
      </div>

      <div>
        <label className="text-xs font-bold text-gray-700 mb-2 block">نوع التصنيف المستهدف</label>
        <div className="grid grid-cols-2 gap-2">
          {(['expense', 'supplier', 'partner'] as const).map(type => (
            <button
              key={type} type="button"
              onClick={() => { setCategory(type); setTargetId('') }}
              className={`py-2 rounded-xl border text-sm font-bold transition-all ${
                category === type
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {type === 'expense' ? 'بند مصروف' : type === 'supplier' ? 'مورد' : 'شريك (جاري)'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
        <label className="text-xs font-bold text-gray-700 mb-2 block">اختر الهدف (Target Entity)</label>
        <select
          required
          value={targetId}
          onChange={e => setTargetId(e.target.value)}
          className="w-full border-gray-300 rounded-xl px-3 py-2.5 text-sm bg-white focus:ring-indigo-500 outline-none"
        >
          <option value="">— اختر —</option>
          {category === 'expense' && Array.isArray(expenses) && expenses.map(e => <option key={e.code} value={e.code}>{e.name}</option>)}
          {category === 'supplier' && Array.isArray(suppliers) && suppliers.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          {category === 'partner' && Array.isArray(partners) && partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        
        {category === 'expense' && (
          <p className="text-[11px] text-gray-500 mt-3 flex items-start gap-1">
            <Plus size={14} className="shrink-0 text-indigo-500 mt-0.5" />
            إذا لم تجد بند المصروف المناسب، أضفه من شاشة إعدادات النظام أولاً ثم عُد لتطبيق القاعدة.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={saveMut.isPending || !keyword || !targetId}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 transition-all"
      >
        <CheckCircle2 size={18} />
        اعتماد القاعدة
      </button>
    </form>
  )
}
