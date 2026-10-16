import {
  ChevronLeft,
  ChevronsUpDown,
  Clapperboard,
  Clock,
  Gavel,
  IdCard,
  LayoutDashboard,
  LogOut,
  Network,
  Package,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useState } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router'
import { useAuth } from '../auth'
import { WorkspaceProvider } from '../data'
import { Tip } from './ui'

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/products', label: 'Products', icon: Package },
  { to: '/manage', label: 'Manage', icon: SlidersHorizontal },
  { to: '/schedules', label: 'Schedules', icon: Clock },
  { to: '/rules', label: 'Rules', icon: Gavel },
  { to: '/infrastructure', label: 'Infrastructure', icon: Network },
  { to: '/profile-hub', label: 'Profile Hub', icon: IdCard },
  { to: '/users', label: 'Users', icon: Users },
]

const EDITOR_NAV: typeof NAV = [{ to: '/videos', label: 'My videos', icon: Clapperboard }]

const COLLAPSED_KEY ='ops.sidebar.collapsed'

// The frame around every page that needs a login
export function Shell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(
    () => (localStorage.getItem(COLLAPSED_KEY) ?? String(window.innerWidth < 900)) === 'true',
  )

  if (user === undefined) return <p className="p-8 text-sm text-neutral-500">Loading…</p>
  if (user === null) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />

  // a video editor's whole app is their own list of videos
  const isEditor = user.role === 'video editor'
  if (isEditor && location.pathname !== '/videos') return <Navigate to="/videos" replace />
  const nav = isEditor ? EDITOR_NAV : NAV

  function toggle() {
    localStorage.setItem(COLLAPSED_KEY, String(!collapsed))
    setCollapsed(!collapsed)
  }

  return (
    <div className="flex min-h-screen bg-neutral-50 text-neutral-900">
      <aside
        className={`sticky top-0 flex h-screen shrink-0 flex-col border-r border-neutral-200 bg-white ${collapsed ? 'w-14' : 'w-56'}`}
      >
        <div className={`flex h-14 items-center gap-2 px-3 ${collapsed ? 'justify-center' : ''}`}>
          {!collapsed && (
            <>
              <span className="flex size-7 items-center justify-center rounded-md bg-blue-700 text-sm font-semibold text-white">
                M
              </span>
              <span className="flex-1 truncate text-sm font-semibold tracking-tight">Media Ops</span>
            </>
          )}
          <Tip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
            <button
              onClick={toggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="flex size-7 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700"
            >
              <ChevronLeft className={`size-4 ${collapsed ? 'rotate-180' : ''}`} />
            </button>
          </Tip>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
          {nav.map(({ to, label, icon: Icon }) => {
            const link = (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                aria-label={label}
                className={({ isActive }) =>
                  `flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-blue-700 ${
                    isActive ? 'bg-blue-50 text-blue-800' : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                  } ${collapsed ? 'justify-center' : ''}`
                }
              >
                <Icon className="size-4 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </NavLink>
            )
            return collapsed ? (
              <Tip key={to} label={label} side="right">
                {link}
              </Tip>
            ) : (
              link
            )
          })}
        </nav>

        <div className="border-t border-neutral-200 p-2">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              aria-label="Account"
              className={`flex h-10 w-full items-center gap-2.5 rounded-md px-1.5 text-left text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-blue-700 ${collapsed ? 'justify-center' : ''}`}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-xs font-semibold text-neutral-700 uppercase">
                {(user.email ?? '?').charAt(0)}
              </span>
              {!collapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{user.email ?? 'Account'}</span>
                    <span className="block truncate text-xs text-neutral-500 capitalize">{user.role || 'No role'}</span>
                  </span>
                  <ChevronsUpDown className="size-4 shrink-0 text-neutral-400" />
                </>
              )}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                side="top"
                align="start"
                sideOffset={6}
                className="z-50 min-w-48 rounded-md border border-neutral-200 bg-white p-1 text-sm shadow-lg"
              >
                <DropdownMenu.Label className="truncate px-2 py-1.5 text-xs text-neutral-500">
                  {user.email ?? 'Account'}
                </DropdownMenu.Label>
                <DropdownMenu.Separator className="my-1 h-px bg-neutral-200" />
                <DropdownMenu.Item
                  onSelect={() => void logout()}
                  className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none data-highlighted:bg-neutral-100"
                >
                  <LogOut className="size-4 text-neutral-500" />
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {/* every page uses the full width beside the sidebar */}
        <div className="px-6 py-6">
          <WorkspaceProvider>
            <Outlet />
          </WorkspaceProvider>
        </div>
      </main>
    </div>
  )
}
