import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutGrid, Image, LogOut, Activity, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

const NAV = [
  { path: '/dashboard', label: 'Devices', icon: LayoutGrid },
  { path: '/media', label: 'Media Pool', icon: Image },
];

export default function Layout({ children, title, subtitle, actions }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/'); };

  return (
    <div className="min-h-screen bg-bg flex">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border bg-surface flex flex-col fixed top-0 left-0 bottom-0 z-20">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-green" />
            <span className="font-mono text-sm font-semibold text-white">wahaGI</span>
          </div>
          <p className="font-mono text-xs text-muted mt-1">v1.0.0</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ path, label, icon: Icon }) => {
            const active = location.pathname === path || location.pathname.startsWith(path + '/');
            return (
              <Link
                key={path}
                to={path}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2.5 font-mono text-xs tracking-wide transition-colors group',
                  active
                    ? 'text-green bg-green/10 border border-green/20'
                    : 'text-muted hover:text-white hover:bg-white/5 border border-transparent'
                )}
              >
                <Icon size={14} />
                {label}
                {active && <ChevronRight size={10} className="ml-auto" />}
              </Link>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-3 py-4 border-t border-border">
          <div className="px-3 py-2 mb-1">
            <p className="font-mono text-xs text-white truncate">{user?.username}</p>
            <p className="font-mono text-xs text-muted">administrator</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2.5 w-full font-mono text-xs text-muted hover:text-red hover:bg-red/5 transition-colors border border-transparent"
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 ml-56 min-h-screen">
        {/* Topbar */}
        <header className="h-14 border-b border-border bg-surface/50 backdrop-blur px-8 flex items-center justify-between sticky top-0 z-10">
          <div>
            <h1 className="font-mono text-sm font-semibold text-white">{title}</h1>
            {subtitle && <p className="font-mono text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-3">{actions}</div>}
        </header>

        {/* Content */}
        <div className="p-8 animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
