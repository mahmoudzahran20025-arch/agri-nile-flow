const CONFIG: Record<string, { label: string; cls: string }> = {
  draft:       { label: 'مسودة',     cls: 'bg-gray-100     text-gray-600    border-gray-200'    },
  active:      { label: 'نشط',       cls: 'bg-blue-100     text-blue-700    border-blue-200'    },
  in_progress: { label: 'جارٍ',     cls: 'bg-amber-100    text-amber-700   border-amber-200'   },
  approved:    { label: 'معتمد',    cls: 'bg-emerald-100  text-emerald-700 border-emerald-200' },
  paid:        { label: 'مدفوع',    cls: 'bg-teal-100     text-teal-700    border-teal-200'    },
  completed:   { label: 'مكتمل',   cls: 'bg-green-100    text-green-700   border-green-200'   },
  posted:      { label: 'مُرحَّل', cls: 'bg-emerald-100  text-emerald-700 border-emerald-200' },
  cancelled:   { label: 'ملغى',    cls: 'bg-red-100      text-red-600     border-red-200'     },
  partial:     { label: 'جزئي',    cls: 'bg-yellow-100   text-yellow-700  border-yellow-200'  },
  closed:      { label: 'مغلق',    cls: 'bg-slate-100    text-slate-600   border-slate-200'   },
  pending:     { label: 'معلق',    cls: 'bg-amber-100    text-amber-700   border-amber-200'   },
  rejected:    { label: 'مرفوض',  cls: 'bg-red-100      text-red-600     border-red-200'     },
  harvesting:  { label: 'حصاد',    cls: 'bg-lime-100     text-lime-700    border-lime-200'    },
  planning:    { label: 'تخطيط',   cls: 'bg-purple-100   text-purple-700  border-purple-200'  },
}

interface Props {
  status: string
  size?: 'xs' | 'sm'
  customLabel?: string
}

export default function StatusBadge({ status, size = 'xs', customLabel }: Props) {
  const c = CONFIG[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 border-gray-200' }
  const pad = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'
  return (
    <span className={`inline-flex items-center font-bold rounded-full border ${pad} ${c.cls}`}>
      {customLabel ?? c.label}
    </span>
  )
}
