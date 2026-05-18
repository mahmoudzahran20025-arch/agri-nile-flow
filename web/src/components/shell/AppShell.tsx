import React, { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  FileCheck,
  Box,
  Sprout,
  Users,
  Wallet,
  Settings,
  ChevronDown,
  ChevronRight,
  UserCog,
  BarChart3,
  ShieldCheck,
  Sliders,
  FileText,
  LogOut,
  Warehouse,
  TrendingUp,
  CalendarDays,
  Tractor,
  GitBranch,
  ArrowLeftRight,
  TrendingDown,
  Clock,
  ClipboardList,
  ShoppingCart,
  ShoppingBag,
  X as XIcon,
  Upload,
} from 'lucide-react';
import { Topbar } from './Topbar';
import GlobalSearch from '../GlobalSearch';
import OfflineBanner from '../OfflineBanner';
import PeriodWarningBanner from '../PeriodWarningBanner';
import DegradedModeBanner from '../DegradedModeBanner';
import QuickEntryFAB from '../QuickEntryFAB';
import KeyboardShortcuts from '../KeyboardShortcuts';
import { useAppStore } from '../../store/appStore';
import { useQuery } from '@tanstack/react-query';
import { suppliersApi } from '../../api/suppliers';

interface NavItem {
  label: string;
  path?: string;
  icon?: React.ReactNode;
  badge?: number;
  children?: NavItem[];
}

const navSections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Home',
    items: [
      { label: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard size={18} /> },
    ],
  },
  {
    // Primary operational entry point — warehouse operations
    title: 'Inventory Operations',
    items: [
      { label: 'New Movement',      path: '/inventory/workspace/create', icon: <Box           size={18} /> },
      { label: 'All Movements',     path: '/inventory/movements',        icon: <ClipboardList size={18} /> },
      { label: 'Physical Count',    path: '/inventory/physical-count',   icon: <FileCheck     size={18} /> },
      { label: 'Warehouse Balances',path: '/inventory',                  icon: <Warehouse     size={18} /> },
      { label: 'Transactions',      path: '/inventory/transactions',     icon: <FileText      size={18} /> },
      { label: 'Posting Health',    path: '/inventory/posting-health',   icon: <ShieldCheck   size={18} /> },
    ],
  },
  {
    title: 'Inventory Analytics',
    items: [
      { label: 'WIP Balances',      path: '/inventory/wip-balances',    icon: <GitBranch  size={18} /> },
      { label: 'Fixed Assets',      path: '/inventory/fixed-assets',    icon: <TrendingUp size={18} /> },
      { label: 'تكلفة الحقول',       path: '/inventory/cost-by-field',   icon: <Sprout     size={18} /> },
      { label: 'Items',             path: '/inventory/items',           icon: <FileCheck  size={18} /> },
    ],
  },
  {
    title: 'Finance',
    items: [
      { label: 'Finance Center',  path: '/gl',                 icon: <BarChart3      size={18} /> },
      { label: 'Journal Entries', path: '/gl/entries',         icon: <BookOpen       size={18} /> },
      { label: 'Batch Posting',   path: '/gl/batch-posting',   icon: <TrendingUp     size={18} /> },
      { label: 'Reconciliation',  path: '/gl/reconciliation',  icon: <ArrowLeftRight size={18} /> },
      { label: 'Fiscal Periods',  path: '/gl/periods',         icon: <CalendarDays   size={18} /> },
      { label: 'إقفال الفترة',    path: '/gl/period-close',    icon: <Clock          size={18} /> },
      { label: 'Depreciation',    path: '/gl/depreciation',    icon: <TrendingDown   size={18} /> },
      { label: 'GL Governance',   path: '/gl/hardening',       icon: <ShieldCheck    size={18} /> },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Financial Statements', path: '/gl/statements',               icon: <FileText  size={18} /> },
      { label: 'Season Reports',       path: '/reports/season',              icon: <Sprout    size={18} /> },
      { label: 'Cost Centers',         path: '/reports/cost-centers',        icon: <BarChart3 size={18} /> },
      { label: 'Suppliers Balance',    path: '/reports/suppliers-balance',   icon: <Users     size={18} /> },
      { label: 'Cost per Feddan',      path: '/reports/cost-per-feddan',     icon: <TrendingUp size={18} /> },
      { label: 'Supplier AP Summary',  path: '/reports/supplier-ap-summary', icon: <Clock     size={18} /> },
      { label: 'Service Type Costs',   path: '/reports/service-type-summary',icon: <BarChart3 size={18} /> },
    ],
  },
  {
    title: 'Suppliers & AP',
    items: [
      { label: 'Suppliers Hub',   path: '/suppliers',              icon: <Users         size={18} /> },
      { label: 'Procurement',     path: '/suppliers/procurement',  icon: <ShoppingCart  size={18} /> },
      { label: 'AP Aging',        path: '/suppliers/aging',        icon: <Clock         size={18} /> },
      { label: 'Cash & Banks',    path: '/treasury',               icon: <Wallet        size={18} /> },
      { label: 'Bank Reconcile',  path: '/treasury/bank',          icon: <ArrowLeftRight size={18} /> },
    ],
  },
  {
    title: 'Agricultural Ops',
    items: [
      { label: 'Seasons & Fields',   path: '/seasons',                    icon: <Sprout        size={18} /> },
      { label: 'Crop Cycles',        path: '/fields/crop-cycles',         icon: <GitBranch     size={18} /> },
      { label: 'Settlements',        path: '/fields/harvest-settlements', icon: <FileCheck     size={18} /> },
      { label: 'المبيعات',           path: '/sales',                      icon: <ShoppingCart  size={18} /> },
      { label: 'تحليلات المبيعات',  path: '/sales/analytics',            icon: <BarChart3     size={18} /> },
      { label: 'نقطة البيع (POS)',   path: '/pos',                        icon: <ShoppingBag   size={18} /> },
      { label: 'العملاء',            path: '/customers',                  icon: <Users         size={18} /> },
      { label: 'Equipment',          path: '/suppliers?tab=equipment',    icon: <Tractor       size={18} /> },
      { label: 'Work Orders',        path: '/operations',                 icon: <ClipboardList size={18} /> },
      { label: 'HR & Payroll',       path: '/hr',                         icon: <Users         size={18} /> },
      { label: 'Calendar',           path: '/calendar',                   icon: <CalendarDays  size={18} /> },
      { label: 'Documents',          path: '/documents',                  icon: <FileText      size={18} /> },
    ],
  },
  {
    title: 'GL Setup',
    items: [
      { label: 'Chart of Accounts', icon: <BookOpen      size={18} />, path: '/gl/accounts' },
      { label: 'Posting Groups',    icon: <Sliders       size={18} />, path: '/gl/posting-groups' },
      { label: 'Posting Rules',     icon: <FileText      size={18} />, path: '/gl/posting-rules' },
      { label: 'Posting Tables',    icon: <ClipboardList size={18} />, path: '/gl/posting-setup' },
      { label: 'Warehouses',        icon: <Warehouse     size={18} />, path: '/inventory/setup' },
      { label: 'GL Settings',       icon: <Settings      size={18} />, path: '/gl/settings' },
    ],
  },
  {
    title: 'System',
    items: [
      { label: 'Audit Center', path: '/audit',              icon: <GitBranch size={18} /> },
      { label: 'Config',       path: '/config',             icon: <Sliders   size={18} /> },
      { label: 'Bulk Import',  path: '/config/bulk-import', icon: <Upload    size={18} /> },
      { label: 'الإعدادات',   path: '/settings',           icon: <Settings  size={18} /> },
      { label: 'Admin',        path: '/admin',              icon: <Settings  size={18} /> },
      { label: 'Users',        path: '/users',              icon: <UserCog   size={18} /> },
    ],
  },
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

// Extracted sidebar content so it can be used in both desktop and mobile overlays
const SidebarContent = ({ onNavClick }: { onNavClick?: () => void }) => {
  const { user, role, logout } = useAppStore();
  const navigate = useNavigate();

  const { data: supplierListData } = useQuery({
    queryKey: ['suppliers', 1, ''],
    queryFn:  () => suppliersApi.list({ page: 1, size: 1 }) as Promise<{
      data: unknown[]; total: number; meta?: { draft_count: number }
    }>,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
  const supplierDraftCount = supplierListData?.meta?.draft_count ?? 0

  const initials = user?.full_name
    ? user.full_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : 'U';

  return (
    <div className="flex flex-col h-full">
      {/* Logo Area */}
      <div className="h-16 flex items-center px-6 gap-3 border-b border-white/5 bg-black/10 shrink-0">
        <div className="w-9 h-9 rounded-xl bg-[#1D9E75] text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-black/20">
          A
        </div>
        <div className="flex flex-col">
          <span className="font-bold text-[15px] leading-tight tracking-tight">Agri-Nile Flow</span>
          <span className="text-[10px] text-emerald-400 font-bold tracking-widest uppercase opacity-80">Enterprise ERP</span>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-6 px-3 custom-scrollbar" onClick={onNavClick}>
        {navSections.map((section, idx) => {
          const items: NavItem[] = section.title === 'Suppliers & AP'
            ? [
                {
                  label: 'Pending Approvals',
                  path: '/suppliers/pending',
                  icon: <ShieldCheck size={18} />,
                  badge: supplierDraftCount > 0 ? supplierDraftCount : undefined,
                },
                ...section.items,
              ]
            : section.items
          return (
          <div key={idx} className="mb-8">
            <div className="px-4 mb-3 text-[11px] font-bold text-slate-400 uppercase tracking-[0.15em] opacity-70">
              {section.title}
            </div>
            <div className="space-y-1">
              {items.map((item, itemIdx) => (
                <NavItemNode key={itemIdx} item={item} />
              ))}
            </div>
          </div>
          )
        })}
      </div>

      {/* User Footer */}
      <div className="p-4 border-t border-white/5 flex items-center gap-3 bg-black/20 backdrop-blur-sm shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#1D9E75] to-[#0F2D5C] flex items-center justify-center text-sm font-bold border border-white/10 shadow-lg shrink-0">
          {initials}
        </div>
        <div className="flex flex-col overflow-hidden flex-1 min-w-0">
          <span className="text-[13px] font-bold leading-tight truncate">{user?.full_name ?? 'User'}</span>
          <span className="text-[11px] text-slate-400 truncate">{role ?? 'Staff'}</span>
        </div>
        <button
          onClick={() => { logout(); navigate('/login'); }}
          title="Sign out"
          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-white/10 rounded-lg transition-colors shrink-0"
        >
          <LogOut size={15} />
        </button>
      </div>
    </div>
  );
};

export const AppShell = () => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#f3f4f6]" dir="ltr">
      <GlobalSearch />
      <OfflineBanner />
      <PeriodWarningBanner />

      {/* Desktop sidebar — hidden below lg */}
      <aside className="hidden lg:flex w-[260px] flex-shrink-0 bg-[#0F2D5C] text-white flex-col h-full shadow-2xl z-30">
        <SidebarContent />
      </aside>

      {/* Mobile overlay sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer */}
          <aside className="relative w-[280px] bg-[#0F2D5C] text-white flex flex-col h-full shadow-2xl z-10">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg z-20"
              aria-label="Close menu"
            >
              <XIcon size={18} />
            </button>
            <SidebarContent onNavClick={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[#f8fafc]">
        <Topbar onMenuClick={() => setMobileOpen(true)} />
        <DegradedModeBanner />
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

