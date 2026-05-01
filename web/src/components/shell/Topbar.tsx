import React from 'react';
import { useLocation, Link, useNavigate } from 'react-router-dom';
import { Search, Bell, Settings, ChevronRight } from 'lucide-react';

// Map route segments to human-readable English labels
const ROUTE_LABELS: Record<string, string> = {
  gl:           'General Ledger',
  entries:      'Journal Entries',
  accounts:     'Chart of Accounts',
  ledger:       'Account Ledger',
  reconciliation: 'Reconciliation',
  'batch-posting': 'Batch Posting',
  'period-close':  'Period Close',
  'health-integrity': 'Health & Integrity',
  posting:      'Posting',
  setup:        'Setup',
  health:       'Health',
  rules:        'Posting Rules',
  groups:       'Posting Groups',
  simulator:    'Simulator',
  wizard:       'Setup Wizard',
  periods:      'Fiscal Periods',
  settings:     'Settings',
  statements:   'Financial Statements',
  reports:      'Reports',
  'suppliers-balance': 'Supplier Balances',
  season:       'Season Reports',
  treasury:     'Treasury',
  ap:           'AP / AR',
  suppliers:    'Suppliers',
  inventory:    'Inventory',
  movements:    'Movements',
  seasons:      'Seasons',
  fields:       'Fields',
  harvest:      'Harvest',
  admin:        'Admin',
  users:        'Users',
};

export const Topbar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pathnames = location.pathname.split('/').filter((x) => x);

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10 sticky top-0">
      {/* Breadcrumb */}
      <nav className="flex items-center text-[13px]">
        <Link to="/" className="text-slate-500 hover:text-[#0F2D5C] font-medium transition-colors">
          Home
        </Link>
        {pathnames.map((name, index) => {
          const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`;
          const isLast = index === pathnames.length - 1;
          const label = ROUTE_LABELS[name] ?? name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          return (
            <React.Fragment key={name}>
              <ChevronRight size={14} className="mx-1.5 text-slate-400" />
              {isLast ? (
                <span className="text-[#0F2D5C] font-bold">{label}</span>
              ) : (
                <Link to={routeTo} className="text-slate-500 hover:text-[#0F2D5C] font-medium transition-colors">
                  {label}
                </Link>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Right Actions */}
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search..."
            className="w-[200px] pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-[13px] focus:outline-none focus:ring-2 focus:ring-[#0F2D5C]/20 focus:border-[#0F2D5C] transition-all"
          />
        </div>

        <div className="h-5 w-[1px] bg-slate-200 mx-1" />

        <button className="relative p-1.5 text-slate-500 hover:text-[#0F2D5C] hover:bg-slate-100 rounded-full transition-colors">
          <Bell size={18} />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full border border-white"></span>
        </button>

        <button
          onClick={() => navigate('/gl/settings')}
          className="p-1.5 text-slate-500 hover:text-[#0F2D5C] hover:bg-slate-100 rounded-full transition-colors"
          title="GL Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
};
