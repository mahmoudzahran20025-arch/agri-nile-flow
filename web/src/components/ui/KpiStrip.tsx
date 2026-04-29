import React from 'react';

export interface KpiItem {
  id: string;
  label: string;
  value: string | number;
  delta?: string;
  progress?: number; // 0-100
  variant?: 'default' | 'success' | 'warning';
}

interface KpiStripProps {
  items: KpiItem[];
}

export const KpiStrip: React.FC<KpiStripProps> = ({ items }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-0 bg-white border-b border-slate-200">
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        
        let barColor = "bg-[#0F2D5C]";
        if (item.variant === 'success') barColor = "bg-[#1D9E75]";
        if (item.variant === 'warning') barColor = "bg-amber-500";

        return (
          <div 
            key={item.id} 
            className={`p-5 relative ${!isLast ? 'border-r border-slate-100' : ''}`}
          >
            {/* Background progress bar indication if progress exists */}
            {item.progress !== undefined && (
              <div className="absolute bottom-0 left-0 h-[3px] bg-slate-100 w-full">
                <div 
                  className={`h-full ${barColor}`} 
                  style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
                />
              </div>
            )}
            
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
              {item.label}
            </h3>
            
            <div className="flex items-end justify-between">
              <div className="text-[22px] font-medium text-slate-800 leading-none">
                {item.value}
              </div>
              {item.delta && (
                <div className="text-[12px] font-medium text-slate-500 mb-0.5">
                  {item.delta}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
