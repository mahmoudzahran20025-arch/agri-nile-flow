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
    title: 'MAIN',
    items: [
      { label: 'Dashboard', path: '/', icon: <LayoutDashboard size={18} /> }
    ]
  },
  {
    title: 'FINANCE',
    items: [
      { 
        label: 'General Ledger', 
        icon: <BookOpen size={18} />,
        children: [
          { label: 'Journal Entries', path: '/gl/entries' },
          { label: 'Chart of Accounts', path: '/gl/accounts' },
          { label: 'Trial Balance', path: '/gl/statements' },
          { label: 'Posting Rules', path: '/gl/posting-setup/health' },
          { label: 'Posting Setup', path: '/gl/posting-setup' },
        ]
      }
    ]
  },
  {
    title: 'OPERATIONS',
    items: [
      { label: 'Harvest', path: '/fields/harvest', icon: <Sprout size={18} /> },
      { label: 'Inventory', path: '/inventory/movements', icon: <Box size={18} /> },
      { label: 'Seasons', path: '/seasons', icon: <FileCheck size={18} /> },
      { label: 'Suppliers', path: '/suppliers', icon: <Users size={18} /> },
    ]
  },
  {
    title: 'TREASURY',
    items: [
      { label: 'Cash/Bank', path: '/treasury', icon: <Wallet size={18} /> },
      { label: 'AP/AR', path: '/treasury/ap', icon: <Building2 size={18} /> },
    ]
  },
  {
    title: 'SETTINGS',
    items: [
      { label: 'Admin', path: '/admin', icon: <Settings size={18} /> },
      { label: 'Users', path: '/users', icon: <UserCog size={18} /> },
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
    <div className="flex h-screen overflow-hidden bg-[#f8fafc]" style={{ direction: 'ltr' }}>
      <GlobalSearch />
      <OfflineBanner />
      <PeriodWarningBanner />
      {/* Sidebar */}
      <aside className="w-[220px] flex-shrink-0 bg-[#0F2D5C] text-white flex flex-col h-full shadow-xl z-20">
        {/* Logo Area */}
        <div className="h-16 flex items-center px-4 gap-3 border-b border-white/10">
          <div className="w-8 h-8 rounded bg-[#1D9E75] text-white flex items-center justify-center font-bold text-lg shadow-inner">
            AN
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-[14px] leading-tight">Agri-Nile Flow</span>
            <span className="text-[10px] text-brand-200 tracking-wider uppercase opacity-80">ERP System</span>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          {navSections.map((section, idx) => (
            <div key={idx}>
              <div className="px-3 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
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

        {/* Footer */}
        <div className="p-4 border-t border-white/10 flex items-center gap-3 bg-black/10">
          <div className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-sm font-bold border border-white/20">
            MA
          </div>
          <div className="flex flex-col">
            <span className="text-[13px] font-medium leading-tight">Mahmoud</span>
            <span className="text-[11px] text-slate-400">Finance Admin</span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <Topbar />
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <Outlet />
        </div>
      </main>
      <QuickEntryFAB />
      <KeyboardShortcuts />
    </div>
  );
};
