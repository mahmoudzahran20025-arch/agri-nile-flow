import React from 'react';

export type CommandActionVariant = 'primary' | 'secondary' | 'ghost';

export interface CommandAction {
  id: string;
  label?: string;
  icon?: React.ReactNode;
  variant?: CommandActionVariant;
  onClick?: () => void;
  isSeparator?: boolean;
  disabled?: boolean;
}

interface CommandBarProps {
  actions: CommandAction[];
  rightSlot?: React.ReactNode;
}

export const CommandBar: React.FC<CommandBarProps> = ({ actions, rightSlot }) => {
  return (
    <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10 sticky top-0 shadow-sm">
      {/* Actions Left */}
      <div className="flex items-center gap-2">
        {actions.map((action, index) => {
          if (action.isSeparator) {
            return <div key={action.id || `sep-${index}`} className="w-[1px] h-6 bg-slate-200 mx-2" />;
          }

          const baseClasses = "flex items-center gap-2 px-3 py-1.5 rounded-md text-[13px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed";
          
          let variantClasses = "";
          if (action.variant === 'primary') {
            variantClasses = "bg-[#0F2D5C] text-white hover:bg-[#153D7A] shadow-sm";
          } else if (action.variant === 'secondary') {
            variantClasses = "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm";
          } else {
            // Ghost
            variantClasses = "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-[#0F2D5C]";
          }

          return (
            <button
              key={action.id}
              onClick={action.onClick}
              disabled={action.disabled}
              className={`${baseClasses} ${variantClasses}`}
            >
              {action.icon && <span className="[&>svg]:w-4 [&>svg]:h-4">{action.icon}</span>}
              {action.label && <span>{action.label}</span>}
            </button>
          );
        })}
      </div>

      {/* Filters Right */}
      {rightSlot && (
        <div className="flex items-center gap-3">
          {rightSlot}
        </div>
      )}
    </div>
  );
};
