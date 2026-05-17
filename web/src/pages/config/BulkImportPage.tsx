import { useState, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import { configApi, type BulkImportResult } from '../../api/config'
import { Upload, CheckCircle, XCircle, AlertTriangle, Download, Loader2 } from 'lucide-react'

type ImportTarget = 'items' | 'suppliers'

// ── Column definitions ────────────────────────────────────────────────────────

const ITEM_COLUMNS = [
  { key: 'code',              label: 'code *',              required: true,  type: 'number' },
  { key: 'name',              label: 'name *',              required: true,  type: 'text'   },
  { key: 'unit',              label: 'unit',                required: false, type: 'text'   },
  { key: 'reorder_threshold', label: 'reorder_threshold',   required: false, type: 'number' },
  { key: 'standard_cost',     label: 'standard_cost',       required: false, type: 'number' },
  { key: 'package_type',      label: 'package_type',        required: false, type: 'text'   },
  { key: 'package_capacity',  label: 'package_capacity',    required: false, type: 'number' },
]

const SUPPLIER_COLUMNS = [
  { key: 'code',          label: 'code *',        required: true,  type: 'number' },
  { key: 'name',          label: 'name *',        required: true,  type: 'text'   },
  { key: 'activity',      label: 'activity',      required: false, type: 'text'   },
  { key: 'phone',         label: 'phone',         required: false, type: 'text'   },
  { key: 'email',         label: 'email',         required: false, type: 'text'   },
  { key: 'address',       label: 'address',       required: false, type: 'text'   },
  { key: 'tax_number',    label: 'tax_number',    required: false, type: 'text'   },
  { key: 'credit_limit',  label: 'credit_limit',  required: false, type: 'number' },
  { key: 'payment_terms', label: 'payment_terms', required: false, type: 'number' },
]

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }

  const splitLine = (line: string): string[] => {
    const result: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { result.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    result.push(cur.trim())
    return result
  }

  const headers = splitLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim().toLowerCase())
  const rows = lines.slice(1).map(line => {
    const vals = splitLine(line)
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').replace(/^"|"$/g, '').trim() })
    return obj
  })
  return { headers, rows }
}

function buildTemplateCSV(target: ImportTarget): string {
  const cols = target === 'items' ? ITEM_COLUMNS : SUPPLIER_COLUMNS
  const header = cols.map(c => c.key).join(',')
  const example = target === 'items'
    ? '1001,قمح بذار,طن,100,500,,,'
    : '201,شركة الأمل للتوريدات,مستلزمات زراعية,01012345678,info@amal.eg,,123456789,50000,30'
  return '﻿' + header + '\n' + example
}

export default function BulkImportPage() {
  const [target, setTarget] = useState<ImportTarget>('items')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [parseError, setParseError] = useState('')
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const columns = target === 'items' ? ITEM_COLUMNS : SUPPLIER_COLUMNS

  const importMut = useMutation({
    mutationFn: (rows: unknown[]) =>
      target === 'items'
        ? configApi.bulkImportItems(rows)
        : configApi.bulkImportSuppliers(rows),
    onSuccess: res => setResult(res),
  })

  function handleFile(file: File) {
    setParseError('')
    setRows([])
    setResult(null)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const { headers, rows } = parseCsv(text)
      if (rows.length === 0) { setParseError('الملف فارغ أو تنسيق غير مدعوم'); return }
      setHeaders(headers)
      setRows(rows)
    }
    reader.readAsText(file, 'utf-8')
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function buildPayload(): Record<string, unknown>[] {
    return rows.map(r => {
      const obj: Record<string, unknown> = {}
      columns.forEach(col => {
        const val = r[col.key]
        if (val !== undefined && val !== '') {
          obj[col.key] = col.type === 'number' ? Number(val) : val
        }
      })
      return obj
    })
  }

  function downloadTemplate() {
    const csv = buildTemplateCSV(target)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `template-${target}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  const errRows = result?.results.filter(r => r.status === 'error') ?? []

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      {/* Header */}
      <div className="px-6 py-5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Bulk Import</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">
            Import items or suppliers from a CSV file (Excel → Save As CSV)
          </p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-1.5 text-[12px] border border-slate-300 text-slate-600 hover:bg-slate-50 rounded px-3 py-2"
        >
          <Download size={13} /> Download Template
        </button>
      </div>

      {/* Tab selector */}
      <div className="px-6 py-3 bg-white border-b border-slate-100 flex gap-1">
        {(['items', 'suppliers'] as ImportTarget[]).map(t => (
          <button
            key={t}
            onClick={() => { setTarget(t); setRows([]); setResult(null); setParseError('') }}
            className={`px-4 py-1.5 rounded text-[12px] font-medium transition-colors ${
              target === t ? 'bg-[#0F2D5C] text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {t === 'items' ? 'Items (أصناف)' : 'Suppliers (موردين)'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* Drop zone */}
        {rows.length === 0 && !result && (
          <div
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center cursor-pointer hover:border-[#0F2D5C]/50 hover:bg-slate-50 transition-colors"
          >
            <Upload size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-[14px] font-medium text-slate-600">
              Drop a CSV file here, or click to browse
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              UTF-8 or Windows-1256 encoded CSV · max 500 rows per import
            </p>
            <input
              ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
            />
          </div>
        )}

        {parseError && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded p-3 text-[13px] text-red-700">
            <XCircle size={15} /> {parseError}
          </div>
        )}

        {/* Column mapping hint */}
        {rows.length > 0 && !result && (
          <div className="bg-blue-50 border border-blue-200 rounded p-3 text-[12px] text-blue-700 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>
              Detected columns: <span className="font-mono">{headers.join(', ')}</span>.
              Required: <span className="font-mono">{columns.filter(c => c.required).map(c => c.key).join(', ')}</span>.
              {rows.length} rows ready to import.
            </div>
          </div>
        )}

        {/* Preview table */}
        {rows.length > 0 && !result && (
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-slate-600">{rows.length} rows preview</span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setRows([]); setParseError('') }}
                  className="text-[11px] text-slate-400 hover:text-slate-600"
                >
                  Clear
                </button>
                <button
                  onClick={() => importMut.mutate(buildPayload())}
                  disabled={importMut.isPending}
                  className="flex items-center gap-1.5 btn-primary text-[12px] py-1 px-4"
                >
                  {importMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  Import {rows.length} rows
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {columns.map(col => (
                      <th key={col.key} className="px-3 py-2 text-left font-semibold text-slate-500 whitespace-nowrap">
                        {col.key}{col.required ? ' *' : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      {columns.map(col => (
                        <td key={col.key} className="px-3 py-1.5 text-slate-700 font-mono whitespace-nowrap">
                          {row[col.key] || <span className="text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length > 20 && (
                    <tr>
                      <td colSpan={columns.length} className="px-3 py-2 text-[11px] text-slate-400 text-center">
                        … and {rows.length - 20} more rows
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total', value: result.total, color: 'text-slate-800 bg-slate-100' },
                { label: 'Inserted', value: result.inserted, color: 'text-[#1D9E75] bg-[#1D9E75]/10' },
                { label: 'Updated', value: result.updated, color: 'text-blue-700 bg-blue-50' },
                { label: 'Failed', value: result.failed, color: 'text-red-700 bg-red-50' },
              ].map(s => (
                <div key={s.label} className={`rounded-lg p-4 text-center ${s.color}`}>
                  <p className="text-[24px] font-bold">{s.value}</p>
                  <p className="text-[11px] font-medium mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {result.failed === 0 ? (
              <div className="flex items-center gap-2 bg-[#1D9E75]/10 border border-[#1D9E75]/30 rounded p-3 text-[13px] text-[#1D9E75] font-medium">
                <CheckCircle size={16} /> Import completed successfully
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-100 text-[12px] font-semibold text-red-700">
                  {result.failed} rows failed
                </div>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-red-50 border-b border-red-200">
                      <th className="px-3 py-2 text-left font-semibold text-red-700">Code</th>
                      <th className="px-3 py-2 text-left font-semibold text-red-700">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-red-700">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errRows.map((r, i) => (
                      <tr key={i} className="border-b border-red-100">
                        <td className="px-3 py-1.5 font-mono text-slate-600">{r.code}</td>
                        <td className="px-3 py-1.5 text-slate-700">{r.name}</td>
                        <td className="px-3 py-1.5 text-red-600">{r.error}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button
              onClick={() => { setRows([]); setResult(null) }}
              className="btn-secondary text-[12px]"
            >
              Import Another File
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
