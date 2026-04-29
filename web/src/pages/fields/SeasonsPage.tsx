
import { CommandBar, CommandAction } from '../../components/shell/CommandBar';
import { Plus, Download } from 'lucide-react';

export default function SeasonsPage() {
  const actions: CommandAction[] = [
    { id: 'new', label: 'New Season', icon: <Plus />, variant: 'primary' },
    { id: 'export', label: 'Export', icon: <Download />, variant: 'secondary' },
  ];

  return (
    <div className="flex flex-col h-full bg-[#f8fafc]">
      <div className="px-6 py-5 flex items-center justify-between shrink-0 bg-white border-b border-slate-200">
        <div>
          <h1 className="text-[18px] font-bold text-[#0F2D5C]">Seasons & Crops</h1>
          <p className="text-[12px] text-slate-500 mt-0.5">Manage agricultural seasons and cost centers</p>
        </div>
      </div>

      <CommandBar actions={actions} />

      <div className="flex-1 p-6 flex items-center justify-center">
        <div className="text-center text-slate-400">
          <p className="text-sm font-medium">Seasons logic will be integrated here.</p>
        </div>
      </div>
    </div>
  );
}
