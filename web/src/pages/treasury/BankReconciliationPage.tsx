import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Plus, Loader2, ChevronDown, ChevronUp,
  CheckCircle2, Link2, Unlink, AlertTriangle,
  Banknote, FileText, Search, X,
} from 'lucide-react'
import { financeApi, type BankAccount, type BankReconciliation, type BankStatement, type CashTxSearchResult } from '../../api/finance'
import Modal from '../../components/ui/Modal'

// ── Helpers ───────────────────────────────────────────────────
function fmtCurrency(n: number) {
  return new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
function diffColor(diff: number) {
  if (Math.abs(diff) < 0.01) return 'text-emerald-600'
  if (Math.abs(diff) < 100)  return 'text-amber-600'
  return 'text-red-600'
}

// ════════════════════════════════════════════════════════════
// Main Page
// ════════════════════════════════════════════════════════════
export default function BankReconciliationPage() {
  const qc = useQueryClient()
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRecon, setShowRecon] = useState(false)
  const [accountForm, setAccountForm] = useState({
    bank_name: '', account_name: '', account_number: '',
    iban: '', currency: 'EGP', opening_balance: '0',
  })
  const [importText, setImportText] = useState('')
  const [reconForm, setReconForm] = useState({
    period_start: '', period_end: '',
    bank_closing_bal: '', book_closing_bal: '',
    outstanding_checks: '0', deposits_in_transit: '0',
    bank_errors: '0', book_errors: '0', notes: '',
  })

  const { data: accounts = [], isLoading: acctLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn:  () => financeApi.getBankAccounts(),
  })

  const createAcctMut = useMutation({
    mutationFn: () => financeApi.createBankAccount({
      ...accountForm,
      opening_balance: Number(accountForm.opening_balance) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      setShowAddAccount(false)
      setAccountForm({ bank_name: '', account_name: '', account_number: '', iban: '', currency: 'EGP', opening_balance: '0' })
    },
  })

  const importMut = useMutation({
    mutationFn: () => {
      // Parse CSV-ish text: each line → date,description,in,out
      const lines = importText.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split(',').map(s => s.trim())
        return {
          statement_date: parts[0] ?? '',
          description:    parts[1] ?? 'غير محدد',
          amount_in:      Number(parts[2]) || 0,
          amount_out:     Number(parts[3]) || 0,
          ref_number:     parts[4] ?? undefined,
        }
      }).filter(l => l.statement_date)
      return financeApi.importStatements(selectedAccount!.id, lines)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bank-statements', selectedAccount?.id] })
      setShowImport(false)
      setImportText('')
      alert(`تم استيراد ${res.imported} سطر بنجاح`)
    },
  })

  const createReconMut = useMutation({
    mutationFn: () => financeApi.createReconciliation(selectedAccount!.id, {
      period_start:        reconForm.period_start,
      period_end:          reconForm.period_end,
      bank_closing_bal:    Number(reconForm.bank_closing_bal) || 0,
      book_closing_bal:    Number(reconForm.book_closing_bal) || 0,
      outstanding_checks:  Number(reconForm.outstanding_checks) || 0,
      deposits_in_transit: Number(reconForm.deposits_in_transit) || 0,
      bank_errors:         Number(reconForm.bank_errors) || 0,
      book_errors:         Number(reconForm.book_errors) || 0,
      notes:               reconForm.notes || undefined,
    } as Partial<BankReconciliation>),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-recon', selectedAccount?.id] })
      setShowRecon(false)
    },
  })

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">مطابقة البنك</h1>
          <p className="text-sm text-gray-500 mt-0.5">مطابقة كشوف حساب البنك مع سجلات الخزينة</p>
        </div>
        <button
          onClick={() => setShowAddAccount(true)}
          className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} /> حساب بنكي جديد
        </button>
      </div>

      {/* Account list */}
      {acctLoading ? (
        <div className="flex justify-center py-12 text-gray-400"><Loader2 className="animate-spin" size={32} /></div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">لا توجد حسابات بنكية بعد</p>
          <p className="text-sm mt-1">أضف حساباً بنكياً للبدء في المطابقة</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map(acc => (
            <AccountCard
              key={acc.id}
              account={acc}
              selected={selectedAccount?.id === acc.id}
              onSelect={() => setSelectedAccount(acc.id === selectedAccount?.id ? null : acc)}
            />
          ))}
        </div>
      )}

      {/* Selected account detail */}
      {selectedAccount && (
        <AccountDetail
          account={selectedAccount}
          onImport={() => setShowImport(true)}
          onNewRecon={() => {
            const today = new Date().toISOString().slice(0, 10)
            const firstDay = today.slice(0, 8) + '01'
            setReconForm(f => ({ ...f, period_start: firstDay, period_end: today }))
            setShowRecon(true)
          }}
        />
      )}

      {/* Add Account Modal */}
      <Modal open={showAddAccount} onClose={() => setShowAddAccount(false)} title="إضافة حساب بنكي">
        <div className="space-y-4 p-1">
          {[
            { field: 'bank_name',      label: 'اسم البنك',           placeholder: 'مثال: بنك مصر' },
            { field: 'account_name',   label: 'اسم الحساب',          placeholder: 'مثال: حساب التشغيل' },
            { field: 'account_number', label: 'رقم الحساب',          placeholder: '1234567890' },
            { field: 'iban',           label: 'IBAN (اختياري)',       placeholder: 'EG38...' },
          ].map(({ field, label, placeholder }) => (
            <div key={field}>
              <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                placeholder={placeholder}
                value={accountForm[field as keyof typeof accountForm]}
                onChange={e => setAccountForm(f => ({ ...f, [field]: e.target.value }))}
              />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">العملة</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                value={accountForm.currency}
                onChange={e => setAccountForm(f => ({ ...f, currency: e.target.value }))}
              >
                {['EGP','USD','EUR','SAR'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">الرصيد الافتتاحي</label>
              <input
                type="number" step="0.01"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                value={accountForm.opening_balance}
                onChange={e => setAccountForm(f => ({ ...f, opening_balance: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => createAcctMut.mutate()}
              disabled={!accountForm.bank_name || !accountForm.account_name || !accountForm.account_number || createAcctMut.isPending}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {createAcctMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              إضافة الحساب
            </button>
            <button onClick={() => setShowAddAccount(false)} className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          </div>
        </div>
      </Modal>

      {/* Import Statements Modal */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title={`استيراد كشف حساب — ${selectedAccount?.bank_name}`}>
        <div className="space-y-4 p-1">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
            <p className="font-semibold mb-1">صيغة الإدخال (CSV):</p>
            <code className="text-xs bg-white px-2 py-1 rounded block" dir="ltr">
              YYYY-MM-DD, البيان, إيداع, سحب, رقم_مرجعي
            </code>
            <p className="mt-1 text-xs text-blue-600">كل سطر = حركة واحدة. أعمدة الإيداع والسحب أرقام.</p>
          </div>
          <textarea
            rows={10}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            placeholder={"2026-04-01, تحويل من عميل, 50000, 0, TX-001\n2026-04-02, دفع فواتير كهرباء, 0, 1200, TX-002"}
            dir="ltr"
            value={importText}
            onChange={e => setImportText(e.target.value)}
          />
          <div className="flex gap-3">
            <button
              onClick={() => importMut.mutate()}
              disabled={!importText.trim() || importMut.isPending}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {importMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              استيراد البيانات
            </button>
            <button onClick={() => setShowImport(false)} className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          </div>
        </div>
      </Modal>

      {/* New Reconciliation Modal */}
      <Modal open={showRecon} onClose={() => setShowRecon(false)} title="مطابقة جديدة">
        <div className="space-y-4 p-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">من تاريخ</label>
              <input type="date" value={reconForm.period_start}
                onChange={e => setReconForm(f => ({ ...f, period_start: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">إلى تاريخ</label>
              <input type="date" value={reconForm.period_end}
                onChange={e => setReconForm(f => ({ ...f, period_end: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* Reconciliation fields */}
          {[
            { field: 'bank_closing_bal',    label: 'رصيد البنك في نهاية الفترة',    hint: 'من كشف البنك' },
            { field: 'book_closing_bal',    label: 'رصيد الدفاتر في نهاية الفترة', hint: 'من سجلات الخزينة' },
            { field: 'outstanding_checks',  label: 'شيكات صادرة لم تُصرف',          hint: 'تُطرح من رصيد البنك' },
            { field: 'deposits_in_transit', label: 'إيداعات قيد التحصيل',           hint: 'تُضاف لرصيد البنك' },
            { field: 'bank_errors',         label: 'فروق بنكية (أخطاء البنك)',       hint: 'موجبة أو سالبة' },
            { field: 'book_errors',         label: 'فروق دفترية (أخطاء الدفاتر)',    hint: 'موجبة أو سالبة' },
          ].map(({ field, label, hint }) => (
            <div key={field}>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {label} <span className="text-gray-400 font-normal text-xs">({hint})</span>
              </label>
              <input
                type="number" step="0.01"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
                value={reconForm[field as keyof typeof reconForm]}
                onChange={e => setReconForm(f => ({ ...f, [field]: e.target.value }))}
              />
            </div>
          ))}

          {/* Live preview */}
          {reconForm.bank_closing_bal && reconForm.book_closing_bal && (
            <ReconPreview form={reconForm} />
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ملاحظات</label>
            <textarea rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500"
              value={reconForm.notes}
              onChange={e => setReconForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              onClick={() => createReconMut.mutate()}
              disabled={!reconForm.period_start || !reconForm.period_end || createReconMut.isPending}
              className="flex-1 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-lg py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {createReconMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              حفظ المطابقة
            </button>
            <button onClick={() => setShowRecon(false)} className="px-4 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50">إلغاء</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── Account Card ──────────────────────────────────────────────
function AccountCard({ account, selected, onSelect }: {
  account: BankAccount; selected: boolean; onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={`
        text-right p-4 rounded-xl border transition-all w-full
        ${selected
          ? 'border-brand-500 bg-brand-50 shadow-md ring-2 ring-brand-200'
          : 'border-gray-200 bg-white shadow-sm hover:shadow-md hover:border-brand-200'}
      `}
    >
      <div className="flex items-start gap-3">
        <div className="bg-brand-100 rounded-xl p-2.5 shrink-0">
          <Building2 size={20} className="text-brand-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gray-800 truncate">{account.bank_name}</p>
          <p className="text-sm text-gray-500 truncate">{account.account_name}</p>
          <p className="text-xs text-gray-400 mt-1 font-mono">{account.account_number}</p>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
        <span className="text-xs text-gray-500">{account.currency}</span>
        <span className="font-bold text-gray-800">
          {fmtCurrency(account.current_balance ?? account.opening_balance)}
        </span>
      </div>
    </button>
  )
}

// ── Account Detail Panel ──────────────────────────────────────
function AccountDetail({ account, onImport, onNewRecon }: {
  account: BankAccount; onImport: () => void; onNewRecon: () => void
}) {
  const qc = useQueryClient()
  const [showStmts, setShowStmts] = useState(true)
  const [matchingStmt, setMatchingStmt] = useState<BankStatement | null>(null)

  const { data: statements = [], isLoading: stmtLoading } = useQuery({
    queryKey: ['bank-statements', account.id],
    queryFn:  () => financeApi.getStatements(account.id),
  })

  const { data: reconciliations = [], isLoading: reconLoading } = useQuery({
    queryKey: ['bank-recon', account.id],
    queryFn:  () => financeApi.getReconciliations(account.id),
  })

  const closeReconMut = useMutation({
    mutationFn: (id: number) => financeApi.closeReconciliation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bank-recon', account.id] }),
  })

  const matchMut = useMutation({
    mutationFn: ({ stmtId, txId }: { stmtId: number; txId: number | null }) =>
      financeApi.matchStatement(stmtId, txId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-statements', account.id] })
      setMatchingStmt(null)
    },
  })

  const unmatchedCount = statements.filter(s => !s.is_matched).length

  return (
    <>
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-wrap gap-3">
        <div>
          <h2 className="font-bold text-gray-800">{account.bank_name} — {account.account_name}</h2>
          {unmatchedCount > 0 && (
            <p className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
              <AlertTriangle size={12} /> {unmatchedCount} حركة غير مطابقة
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onImport}
            className="flex items-center gap-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg px-3 py-1.5 transition-colors">
            <FileText size={14} /> استيراد كشف
          </button>
          <button onClick={onNewRecon}
            className="flex items-center gap-1.5 text-sm bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-3 py-1.5 transition-colors">
            <Banknote size={14} /> مطابقة جديدة
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100">
        {[
          { key: true,  label: 'حركات البنك', count: statements.length },
          { key: false, label: 'جلسات المطابقة', count: reconciliations.length },
        ].map(tab => (
          <button
            key={String(tab.key)}
            onClick={() => setShowStmts(tab.key)}
            className={`
              flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors
              ${showStmts === tab.key
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'}
            `}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="text-xs bg-gray-100 text-gray-500 rounded-full px-1.5 py-0.5">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Statements Table */}
      {showStmts && (
        <div className="overflow-x-auto">
          {stmtLoading ? (
            <div className="flex justify-center py-8 text-gray-400"><Loader2 className="animate-spin" size={24} /></div>
          ) : statements.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">
              لا توجد حركات — استورد كشف حساب البنك
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="px-4 py-2.5 text-right font-medium">التاريخ</th>
                  <th className="px-4 py-2.5 text-right font-medium">البيان</th>
                  <th className="px-4 py-2.5 text-right font-medium">مرجع</th>
                  <th className="px-4 py-2.5 text-left font-medium">إيداع</th>
                  <th className="px-4 py-2.5 text-left font-medium">سحب</th>
                  <th className="px-4 py-2.5 text-center font-medium">المطابقة</th>
                  <th className="px-4 py-2.5 text-center font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {statements.map(s => (
                  <tr key={s.id} className={`hover:bg-gray-50 transition-colors ${s.is_matched ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{s.statement_date}</td>
                    <td className="px-4 py-2.5 text-gray-800 max-w-xs truncate">{s.description}</td>
                    <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{s.ref_number ?? '—'}</td>
                    <td className="px-4 py-2.5 text-left">
                      {s.amount_in > 0 ? <span className="text-emerald-600 font-medium">{fmtCurrency(s.amount_in)}</span> : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-left">
                      {s.amount_out > 0 ? <span className="text-red-500 font-medium">{fmtCurrency(s.amount_out)}</span> : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {s.is_matched ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <Link2 size={12} /> مطابق
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-500">
                          <Unlink size={12} /> غير مطابق
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {s.is_matched ? (
                        <button
                          onClick={() => matchMut.mutate({ stmtId: s.id, txId: null })}
                          disabled={matchMut.isPending}
                          className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mx-auto transition-colors"
                          title="إلغاء المطابقة"
                        >
                          <X size={12} /> إلغاء
                        </button>
                      ) : (
                        <button
                          onClick={() => setMatchingStmt(s)}
                          className="text-xs text-brand-600 hover:text-brand-800 flex items-center gap-1 mx-auto transition-colors"
                        >
                          <Link2 size={12} /> طابق
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Reconciliations Table */}
      {!showStmts && (
        <div className="divide-y divide-gray-50">
          {reconLoading ? (
            <div className="flex justify-center py-8 text-gray-400"><Loader2 className="animate-spin" size={24} /></div>
          ) : reconciliations.length === 0 ? (
            <div className="text-center py-10 text-gray-400 text-sm">لا توجد جلسات مطابقة بعد</div>
          ) : (
            reconciliations.map(r => (
              <ReconRow
                key={r.id} recon={r}
                onClose={() => closeReconMut.mutate(r.id)}
                closing={closeReconMut.isPending}
              />
            ))
          )}
        </div>
      )}
    </div>

    {/* Cash Tx Picker */}
    {matchingStmt && (
      <CashTxPickerModal
        stmt={matchingStmt}
        isPending={matchMut.isPending}
        onSelect={(txId) => matchMut.mutate({ stmtId: matchingStmt.id, txId })}
        onClose={() => setMatchingStmt(null)}
      />
    )}
    </>
  )
}

// ── CashTx Picker Modal ────────────────────────────────────────
function CashTxPickerModal({ stmt, onSelect, onClose, isPending }: {
  stmt: BankStatement
  onSelect: (txId: number) => void
  onClose: () => void
  isPending: boolean
}) {
  const [q, setQ] = useState('')
  const direction = stmt.amount_in > 0 ? 'د' : 'م'

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['cash-tx-search', q, direction],
    queryFn:  () => financeApi.searchCashTransactions({ q: q || undefined, direction }),
    staleTime: 10_000,
  })

  return (
    <Modal open onClose={onClose} title={`ربط حركة بنكية — ${stmt.description}`}>
      <div className="space-y-4 p-1">
        {/* Context badge */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">{stmt.statement_date}</span>
          <span className={`font-bold ${stmt.amount_in > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {stmt.amount_in > 0 ? `+ ${fmtCurrency(stmt.amount_in)}` : `- ${fmtCurrency(stmt.amount_out)}`}
          </span>
        </div>

        {/* Search box */}
        <div className="relative">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            className="w-full border border-gray-300 rounded-lg pr-9 pl-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            placeholder="ابحث بالبيان أو اسم الجهة..."
            value={q}
            onChange={e => setQ(e.target.value)}
            autoFocus
          />
        </div>

        {/* Results list */}
        <div className="max-h-72 overflow-y-auto divide-y divide-gray-50 border border-gray-200 rounded-xl">
          {isFetching ? (
            <div className="flex justify-center py-6 text-gray-400"><Loader2 className="animate-spin" size={20} /></div>
          ) : results.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">لا توجد حركات غير مطابقة</div>
          ) : (
            results.map((tx: CashTxSearchResult) => (
              <button
                key={tx.id}
                onClick={() => onSelect(tx.id)}
                disabled={isPending}
                className="w-full text-right flex items-center justify-between gap-3 px-4 py-3 hover:bg-brand-50 transition-colors text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate">{tx.narration}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {tx.transaction_date}{tx.recipient_name ? ` · ${tx.recipient_name}` : ''}
                    {tx.document_number ? ` · ${tx.document_number}` : ''}
                  </p>
                </div>
                <span className={`font-bold shrink-0 ${tx.direction === 'د' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {tx.direction === 'د' ? '+' : '-'} {fmtCurrency(tx.amount)}
                </span>
              </button>
            ))
          )}
        </div>

        <button onClick={onClose} className="w-full border border-gray-300 rounded-lg py-2 text-sm text-gray-600 hover:bg-gray-50">
          إلغاء
        </button>
      </div>
    </Modal>
  )
}

// ── Reconciliation Row ────────────────────────────────────────
function ReconRow({ recon, onClose, closing }: {
  recon: BankReconciliation; onClose: () => void; closing: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const balanced = Math.abs(recon.difference) < 0.01

  return (
    <div>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 px-5 py-3.5 text-right hover:bg-gray-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-800">
              {recon.period_start} — {recon.period_end}
            </span>
            {recon.status === 'draft'
              ? <span className="text-xs bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">مسودة</span>
              : <span className="text-xs bg-emerald-100 text-emerald-700 rounded-full px-2 py-0.5">مطابق</span>
            }
            <span className={`text-xs font-bold ${diffColor(recon.difference)}`}>
              {balanced ? '✓ متوازن' : `فرق: ${fmtCurrency(recon.difference)}`}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">أُنشئ بواسطة: {recon.created_by_name ?? '—'}</p>
        </div>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-5 pb-4 pt-1 bg-gray-50 border-t border-gray-100">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4 text-sm">
            {[
              { label: 'رصيد البنك',           value: recon.bank_closing_bal },
              { label: 'شيكات غير مصروفة',     value: recon.outstanding_checks },
              { label: 'إيداعات قيد التحصيل',  value: recon.deposits_in_transit },
              { label: 'رصيد الدفاتر',         value: recon.book_closing_bal },
              { label: 'رصيد البنك المعدّل',   value: recon.adjusted_bank_bal, highlight: true },
              { label: 'رصيد الدفاتر المعدّل', value: recon.adjusted_book_bal, highlight: true },
            ].map(({ label, value, highlight }) => (
              <div key={label} className={`rounded-lg p-3 ${highlight ? 'bg-white border border-gray-200' : ''}`}>
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`font-bold mt-0.5 ${highlight ? diffColor(recon.difference) : 'text-gray-800'}`}>
                  {fmtCurrency(value)}
                </p>
              </div>
            ))}
          </div>
          {recon.notes && <p className="text-sm text-gray-600 mb-3">ملاحظة: {recon.notes}</p>}
          {recon.status === 'draft' && (
            <button
              onClick={onClose}
              disabled={closing}
              className="flex items-center gap-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg px-4 py-2 transition-colors"
            >
              {closing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              اعتماد المطابقة
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Reconciliation Live Preview ───────────────────────────────
function ReconPreview({ form }: { form: Record<string, string> }) {
  const bankBal    = Number(form.bank_closing_bal) || 0
  const bookBal    = Number(form.book_closing_bal) || 0
  const checks     = Number(form.outstanding_checks) || 0
  const deposits   = Number(form.deposits_in_transit) || 0
  const bankErr    = Number(form.bank_errors) || 0
  const bookErr    = Number(form.book_errors) || 0
  const adjBank    = bankBal - checks + deposits + bankErr
  const adjBook    = bookBal + bookErr
  const diff       = adjBank - adjBook
  const balanced   = Math.abs(diff) < 0.01

  return (
    <div className={`rounded-xl p-3 border text-sm ${balanced ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
      <p className={`font-semibold mb-2 ${balanced ? 'text-emerald-700' : 'text-red-700'}`}>
        {balanced ? '✅ المطابقة متوازنة' : '⚠️ يوجد فرق في المطابقة'}
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
        <span>رصيد البنك المعدّل: <strong>{new Intl.NumberFormat('ar-EG').format(adjBank)}</strong></span>
        <span>رصيد الدفاتر المعدّل: <strong>{new Intl.NumberFormat('ar-EG').format(adjBook)}</strong></span>
        {!balanced && <span className="col-span-2 text-red-600 font-medium">الفرق: {new Intl.NumberFormat('ar-EG').format(diff)}</span>}
      </div>
    </div>
  )
}
