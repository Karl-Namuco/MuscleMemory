import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { CalendarDays, ChartNoAxesCombined, CircleHelp, Dumbbell, House, UserRound, WifiOff, CloudCheck, CloudUpload, ShieldCheck } from 'lucide-react'
import Brand from '../../components/shared/Brand'
import PwaFeedback from '../../components/shared/PwaFeedback'
import { useAuth } from '../../services/auth/AuthProvider'
import { usingEmulators } from '../../services/firebase/client'
import { useOnline } from '../../hooks/useOnline'

const links = [
  { to: '/today', label: 'Today', icon: House },
  { to: '/plan', label: 'Plan', icon: CalendarDays },
  { to: '/train', label: 'Train', icon: Dumbbell },
  { to: '/progress', label: 'Progress', icon: ChartNoAxesCombined },
  { to: '/profile', label: 'Profile', icon: UserRound },
]
export default function AppShell() {
  const { account, error, refreshAccess } = useAuth()
  const online = useOnline()
  const location = useLocation()
  useEffect(() => { window.scrollTo(0, 0); document.getElementById('page-content')?.focus() }, [location.pathname])
  const syncLabel = !online ? 'Offline · cached data' : account?.hasPendingWrites ? 'Saved locally · sync pending' : account?.fromCache ? 'Showing cached preferences' : 'Preferences synced'
  const SyncIcon = !online ? WifiOff : account?.hasPendingWrites ? CloudUpload : CloudCheck
  return <div className="app-shell">
    <a className="skip-link" href="#page-content">Skip to content</a>
    <aside className="sidebar">
      <Brand />
      <div className="sidebar-section-label">Your training space</div>
      <nav className="desktop-navigation" aria-label="Main navigation">{links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to}><Icon size={20} strokeWidth={1.7} /><span>{label}</span>{to === '/train' && <span className="nav-training-dot" />}</NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><span className="small-orbit" aria-hidden="true" /><p>Your schedule forgets.<br /><strong>Your muscles don’t.</strong></p></div><Link className="help-link" to="/settings"><CircleHelp size={18} /> Help & installation</Link><Link className="sidebar-profile" to="/profile"><span className="avatar">{account?.profile.displayName.charAt(0).toUpperCase() || 'M'}</span><span><strong>{account?.profile.displayName || 'Your profile'}</strong><small>Make it your own</small></span></Link></div>
    </aside>
    <div className="main-region">
      <header className="topbar"><div className="mobile-brand"><Brand /></div><span className="desktop-context">A little consistency. A lot of possibility.</span><div className="topbar-status"><span className="sync-status" role="status"><SyncIcon size={14} /><span>{syncLabel}</span></span>{usingEmulators && <span className="environment-label"><ShieldCheck size={13} /> Local development</span>}<Link className="header-avatar" to="/profile" aria-label="Open profile">{account?.profile.displayName.charAt(0).toUpperCase() || 'M'}</Link></div></header>
      <main id="page-content" className="page-content" tabIndex={-1}>{error && <div className="notice sync-error" role="alert"><span>{error}</span><button className="btn btn-secondary" onClick={() => void refreshAccess().catch(() => undefined)}>Try again</button></div>}<Outlet /></main>
      <footer className="desktop-footer"><span>muscle memory</span><span>Built around your life.</span></footer>
    </div>
    <nav className="mobile-navigation" aria-label="Mobile navigation">{links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to}><Icon size={21} strokeWidth={1.7} /><span>{label}</span></NavLink>)}</nav>
    <PwaFeedback />
  </div>
}
