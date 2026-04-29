import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  BookOpen, 
  FileCheck, 
  Box, 
  Sprout, 
  Users, 
  Wallet,
  Building2,
  Settings,
  ChevronDown,
  ChevronRight,
  UserCog
} from 'lucide-react';
import { Topbar } from './Topbar';
import GlobalSearch from '../GlobalSearch';
import OfflineBanner from '../OfflineBanner';
import PeriodWarningBanner from '../PeriodWarningBanner';
import QuickEntryFAB from '../QuickEntryFAB';
import KeyboardShortcuts from '../KeyboardShortcuts';

interface NavItem {
  label: string;
  path?: string;
  icon?: React.ReactNode;
  badge?: number;
  children?: NavItem[];
}

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'الرئيسية',
    items: [
      { label: 'لوحة التحكم', path: '/', icon: <LayoutDashboard size={18} /> }
    ]
  },
  {
    title: 'المحاسبة والمالية',
    items: [
      { 
        label: 'الأستاذ العام', 
        icon: <BookOpen size={18} />,
        children: [
          { label: 'قيود اليومية', path: '/gl/entries' },
          { label: 'دليل الحسابات', path: '/gl/accounts' },
          { label: 'ميزان المراجعة', path: '/gl/statements' },
          { label: 'قواعد الترحيل', path: '/gl/posting-setup/health' },
          { label: 'إعدادات الترحيل', path: '/gl/posting-setup' },
        ]
      }
    ]
  },
  {
    title: 'العمليات والمخازن',
    items: [
      { label: 'الحصاد والمحاصيل', path: '/fields/harvest', icon: <Sprout size={18} /> },
      { label: 'حركات المخزون', path: '/inventory/movements', icon: <Box size={18} /> },
      { label: 'المواسم الزراعية', path: '/seasons', icon: <FileCheck size={18} /> },
      { label: 'الموردون والعملاء', path: '/suppliers', icon: <Users size={18} /> },
    ]
  },
  {
    title: 'الخزينة والمدفوعات',
    items: [
      { label: 'الخزينة والبنوك', path: '/treasury', icon: <Wallet size={18} /> },
      { label: 'الذمم الدائنة/المدينة', path: '/treasury/ap', icon: <Building2 size={18} /> },
    ]
  },
  {
    title: 'الإعدادات والنظام',
    items: [
      { label: 'مدير النظام', path: '/admin', icon: <Settings size={18} /> },
      { label: 'المستخدمون', path: '/users', icon: <UserCog size={18} /> },
    ]
  }
];

const NavItemNode = ({ item, isChild = false }: { item: NavItem; isChild?: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();

  if (item.children) {
    return (
      <div className="mb-1">
        <button 
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2 rounded text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
        >
          <div className="flex items-center gap-3">
            {item.icon}
            <span className="text-[13px] font-medium">{item.label}</span>
          </div>
          <div className="flex items-center gap-2">
            {item.badge && (
              <span className="bg-brand-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {item.badge}
              </span>
            )}
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
        </button>
        {expanded && (
          <div className="mt-1 space-y-1">
            {item.children.map((child, idx) => (
              <NavItemNode key={idx} item={child} isChild={true} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <NavLink
      to={item.path || '#'}
      className={({ isActive: isExactActive }) => {
        const active = item.path === '/' ? isExactActive : location.pathname.startsWith(item.path || '');
        return `flex items-center gap-3 py-2 rounded transition-colors ${
          isChild ? 'pl-[33px] pr-3 text-[12px]' : 'px-3 text-[13px] font-medium'
        } ${
          active
            ? 'bg-white/15 text-white shadow-sm'
            : 'text-slate-300 hover:bg-white/10 hover:text-white'
        }`;
      }}
    >
      {item.icon && !isChild && item.icon}
      <span>{item.label}</span>
      {item.badge && (
        <span className="ml-auto bg-brand-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          {item.badge}
        </span>
      )}
    </NavLink>
  );
};

export const AppShell = () => {
  return (
    <div className="flex h-screen overflow-hidden bg-[#f3f4f6]" dir="rtl">
      <GlobalSearch />
      <OfflineBanner />
      <PeriodWarningBanner />
      
      {/* Sidebar */}
      <aside className="w-[260px] flex-shrink-0 bg-[#0F2D5C] text-white flex flex-col h-full shadow-2xl z-30 transition-all duration-300">
        {/* Logo Area */}
        <div className="h-16 flex items-center px-6 gap-3 border-b border-white/5 bg-black/10">
          <div className="w-9 h-9 rounded-xl bg-[#1D9E75] text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-black/20">
            A
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-[15px] leading-tight tracking-tight">Agri-Nile Flow</span>
            <span className="text-[10px] text-emerald-400 font-bold tracking-widest uppercase opacity-80">Enterprise ERP</span>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-6 px-3 custom-scrollbar">
          {navSections.map((section, idx) => (
            <div key={idx} className="mb-8">
              <div className="px-4 mb-3 text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] opacity-70">
                {section.title}
              </div>
              <div className="space-y-1">
                {section.items.map((item, itemIdx) => (
                  <NavItemNode key={itemIdx} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-white/5 flex items-center gap-4 bg-black/20 backdrop-blur-sm">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1D9E75] to-[#0F2D5C] flex items-center justify-center text-sm font-bold border border-white/10 shadow-lg">
            MZ
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-[14px] font-bold leading-tight truncate">محمود زهران</span>
            <span className="text-[11px] text-slate-400 truncate">مدير النظام</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[#f8fafc]">
        <Topbar />
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col">
          <div className="flex-1 flex flex-col">
            <Outlet />
          </div>
        </div>
      </main>
      
      <QuickEntryFAB />
      <KeyboardShortcuts />
    </div>
  );
};
