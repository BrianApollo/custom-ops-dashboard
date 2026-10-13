import { Tooltip } from 'radix-ui'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider } from './auth'
import { Shell } from './components/Shell'
import { CampaignView } from './pages/CampaignView'
import { EditorPortal } from './pages/EditorPortal'
import { Infrastructure } from './pages/Infrastructure'
import { Login } from './pages/Login'
import { Manage } from './pages/Manage'
import { Overview } from './pages/Overview'
import { CampaignLauncher } from './pages/launcher/CampaignLauncher'
import { Products } from './pages/Products'
import { ProfileHub } from './pages/ProfileHub'
import { Rules } from './pages/Rules'
import { Schedules } from './pages/Schedules'
import { Users } from './pages/Users'

export function App() {
  return (
    <BrowserRouter>
      <Tooltip.Provider delayDuration={300}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Shell />}>
              <Route index element={<Overview />} />
              <Route path="products" element={<Products />} />
              <Route path="campaigns/:id/launch" element={<CampaignLauncher />} />
              <Route path="manage" element={<Manage />} />
              <Route path="schedules" element={<Schedules />} />
              <Route path="campaigns/:id" element={<CampaignView />} />
              <Route path="rules" element={<Rules />} />
              <Route path="infrastructure" element={<Infrastructure />} />
              <Route path="profile-hub" element={<ProfileHub />} />
              <Route path="users" element={<Users />} />
              <Route path="videos" element={<EditorPortal />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </Tooltip.Provider>
    </BrowserRouter>
  )
}
