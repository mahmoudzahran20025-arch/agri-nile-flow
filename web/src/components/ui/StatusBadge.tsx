import React from 'react';

type BadgeType = 'status' | 'source';
type StatusVariant = 'posted' | 'draft' | 'voided' | 'reversed' | 'active' | 'inactive';
type SourceVariant = 'manual' | 'inventory' | 'cash' | 'payroll' | 'harvest' | 'wip' | 'fixed-asset' | 'contract';

interface StatusBadgeProps {
  type?: BadgeType;
  variant: StatusVariant | SourceVariant;
  label?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ type = 'status', variant, label }) => {
  let baseClasses = "inline-flex items-center px-2 py-0.5 rounded-[4px] text-[11px] font-bold uppercase tracking-wider border";
  let colorClasses = "";

  if (type === 'status') {
    switch (variant as StatusVariant) {
      case 'posted':
      case 'active':
        colorClasses = "bg-[var(--badge-posted-bg)] text-[var(--badge-posted-text)] border-[var(--badge-posted-text)]/20";
        break;
      case 'draft':
      case 'inactive':
        colorClasses = "bg-[var(--badge-draft-bg)] text-[var(--badge-draft-text)] border-[var(--badge-draft-text)]/20";
        break;
      case 'voided':
        colorClasses = "bg-[var(--badge-voided-bg)] text-[var(--badge-voided-text)] border-[var(--badge-voided-text)]/20";
        break;
      case 'reversed':
        colorClasses = "bg-[var(--badge-reversed-bg)] text-[var(--badge-reversed-text)] border-[var(--badge-reversed-text)]/20";
        break;
      default:
        colorClasses = "bg-slate-100 text-slate-600 border-slate-200";
    }
  } else {
    switch (variant as SourceVariant) {
      case 'manual':
        colorClasses = "bg-[var(--source-manual-bg)] text-[var(--source-manual-text)] border-[var(--source-manual-text)]/20";
        break;
      case 'inventory':
        colorClasses = "bg-[var(--source-inventory-bg)] text-[var(--source-inventory-text)] border-[var(--source-inventory-text)]/20";
        break;
      case 'cash':
        colorClasses = "bg-[var(--source-cash-bg)] text-[var(--source-cash-text)] border-[var(--source-cash-text)]/20";
        break;
      case 'payroll':
        colorClasses = "bg-[var(--source-payroll-bg)] text-[var(--source-payroll-text)] border-[var(--source-payroll-text)]/20";
        break;
      case 'harvest':
        colorClasses = "bg-[var(--source-harvest-bg)] text-[var(--source-harvest-text)] border-[var(--source-harvest-text)]/20";
        break;
      case 'wip':
        colorClasses = "bg-[var(--source-wip-bg)] text-[var(--source-wip-text)] border-[var(--source-wip-text)]/20";
        break;
      case 'fixed-asset':
        colorClasses = "bg-[var(--source-fixed-asset-bg)] text-[var(--source-fixed-asset-text)] border-[var(--source-fixed-asset-text)]/20";
        break;
      case 'contract':
        colorClasses = "bg-[var(--source-contract-bg)] text-[var(--source-contract-text)] border-[var(--source-contract-text)]/20";
        break;
      default:
        colorClasses = "bg-slate-100 text-slate-600 border-slate-200";
    }
  }

  const displayLabel = label || variant.toString().replace('-', ' ');

  return (
    <span className={`${baseClasses} ${colorClasses}`}>
      {displayLabel}
    </span>
  );
};

export default StatusBadge;
