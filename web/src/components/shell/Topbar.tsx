import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Search, Bell, Settings, ChevronRight } from 'lucide-react';

export const Topbar = () => {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x);

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10 sticky top-0" dir="rtl">
      {/* Breadcrumb */}
      <nav className="flex items-center text-[13px]">
        <Link to="/" className="text-slate-500 hover:text-[#0F2D5C] font-medium transition-colors">
          الرئيسية
        </Link>
        {pathnames.map((name, index) => {
          const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`;
          const isLast = index === pathnames.length - 1;
          // Capitalize and format name
          const formattedName = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          return (
            <React.Fragment key={name}>
              <ChevronRight size={14} className="mx-1.5 text-slate-400" />
              {isLast ? (
                <span className="text-[#0F2D5C] font-bold">{formattedName}</span>
              ) : (
                <Link to={routeTo} className="text-slate-500 hover:text-[#0F2D5C] font-medium transition-colors">
                  {formattedName}
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input 
            type="text" 
            placeholder="بحث في النظام..." 
            className="w-[200px] pr-9 pl-4 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] transition-all"
          />
        </div>
        
        <div className="h-5 w-[1px] bg-slate-200 mx-1" />

        <button className="relative p-1.5 text-slate-500 hover:text-[#0F2D5C] hover:bg-slate-100 rounded-full transition-colors">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full border border-white"></span>
        </button>
        
        <button className="p-1.5 text-slate-500 hover:text-[#0F2D5C] hover:bg-slate-100 rounded-full transition-colors">
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
};
