import { sessionIdentity } from './api/memoryStore.js';
import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

import { ThemeProvider } from './admin/ThemeContext.jsx'
import { SettingsProvider } from './admin/pages/settings/SettingsContext.jsx'
import { ToastProvider } from './admin/components/ui/ToastProvider.jsx'
import AsyncState from './admin/components/ui/AsyncState.jsx'
import { useToast } from './admin/components/ui/useToast.js'

import AdminLayout from './admin/layout/AdminLayout.jsx'
import NotFound from './admin/pages/NotFound.jsx'
import Login from './auth/Login.jsx'
import { loadRoles } from './admin/pages/users-roles/usersStore.js'
import { apiRequest, refreshBackendState, hasBackendSession, sessionPermissionFingerprint, clearBackendSession, retryFailedChanges, getSyncError, discardFailedChanges } from './api/backend.js'
import ChatCallProvider from './admin/pages/chat/ChatCallProvider.jsx'

function BackendSyncMonitor() {
  const toast = useToast()
  const [error, setError] = useState(getSyncError)
  const [retrying, setRetrying] = useState(false)
  useEffect(() => {
    const onError = (event) => { setError(getSyncError()); toast.error(`Serverga saqlash bajarilmadi: ${event.detail}`) }
    const onStatus = () => setError(getSyncError())
    window.addEventListener('educontrol:sync-error', onError)
    window.addEventListener('educontrol:sync-status', onStatus)
    return () => { window.removeEventListener('educontrol:sync-error', onError); window.removeEventListener('educontrol:sync-status', onStatus) }
  }, [toast])
  if (!error) return null
  return <div role="alert">O‘zgarish saqlanmadi: {error.message}. Oldingi tasdiqlangan holat tiklandi. Qoralama shu sahifa xotirasida qoladi.
    <button className="btn btn--secondary" disabled={retrying} onClick={async () => {
      setRetrying(true)
      try { await retryFailedChanges(); setError(null) } catch (failure) { setError(failure) } finally { setRetrying(false) }
    }}>{retrying ? 'Saqlanmoqda...' : 'Qayta urinish'}</button>
    <button className="btn btn--secondary" disabled={retrying} onClick={() => {
      if (window.confirm('Saqlanmagan qoralamani bekor qilasizmi? Serverdagi tasdiqlangan ma’lumotlar saqlanadi.')) discardFailedChanges()
    }}>Qoralamani bekor qilish</button>
  </div>
}

function SessionBootstrap({ children }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    // Opening/reloading the app requires explicit credentials. An old HttpOnly
    // cookie must never silently restore access to the dashboard.
    apiRequest('/auth/logout', { method: 'POST', body: '{}' }).then(() => {
      if (!active) return
      clearBackendSession()
    }).catch((failure) => {
      if (!active) return
      clearBackendSession()
      setError(failure.message)
    }).finally(() => { if (active) setReady(true) })
    return () => { active = false }
  }, [attempt])
  if (error) return <AsyncState fullPage title="Ma’lumotlarni yuklab bo‘lmadi" message={error} onRetry={() => { setReady(false); setError(''); setAttempt((value) => value + 1) }} />
  if (!ready) return <AsyncState fullPage title="Tizim tekshirilmoqda" message="Sessiya va sizga ruxsat etilgan ma’lumotlar yuklanmoqda." />
  return children
}

// Admin sahifalari
const Dashboard = lazy(() => import('./admin/pages/Dashboard.jsx'))
const Students = lazy(() => import('./admin/pages/students/Students.jsx'))
const Teachers = lazy(() => import('./admin/pages/teachers/Teachers.jsx'))
const SupportTeachers = lazy(() => import('./admin/pages/support-teachers/SupportTeachers.jsx'))
const Courses = lazy(() => import('./admin/pages/courses/Courses.jsx'))
const Groups = lazy(() => import('./admin/pages/groups/Groups.jsx'))
const Schedule = lazy(() => import('./admin/pages/schedule/Schedule.jsx'))
const Attendance = lazy(() => import('./admin/pages/attendance/Attendance.jsx'))
const Finance = lazy(() => import('./admin/pages/finance/Finance.jsx'))
const Payments = lazy(() => import('./admin/pages/finance/Payments.jsx'))
const Expenses = lazy(() => import('./admin/pages/finance/Expenses.jsx'))
const Salaries = lazy(() => import('./admin/pages/finance/Salaries.jsx'))
const Settings = lazy(() => import('./admin/pages/settings/Settings.jsx'))
const Reports = lazy(() => import('./admin/pages/reports/Reports.jsx'))
const UsersRoles = lazy(() => import('./admin/pages/users-roles/UsersRoles.jsx'))
const Notifications = lazy(() => import('./admin/pages/notifications/Notifications.jsx'))
const ActivityLog = lazy(() => import('./admin/pages/activity/ActivityLog.jsx'))
const Chat = lazy(() => import('./admin/pages/chat/Chat.jsx'))
const Reception = lazy(() => import('./Reception/Reception.jsx'))
const ReceptionLayout = lazy(() => import('./Reception/ReceptionLayout.jsx'))
const TeacherPages = lazy(() => import('./Teacher/TeacherPages.jsx'))
const AccountSecurity = lazy(() => import('./auth/AccountSecurity.jsx'))

const ReceptionStudents = lazy(() => import('./admin/pages/students/Students.jsx'))
const ReceptionGroups = lazy(() => import('./admin/pages/groups/Groups.jsx'))
const ReceptionCourses = lazy(() => import('./admin/pages/courses/Courses.jsx'))
const ReceptionSchedule = lazy(() => import('./admin/pages/schedule/Schedule.jsx'))
const ReceptionAttendance = lazy(() => import('./admin/pages/attendance/Attendance.jsx'))
const ReceptionPayments = lazy(() => import('./admin/pages/finance/Payments.jsx'))

function RequireReceptionPermission({ module, children }) {
  const roleId = sessionIdentity.getItem('educontrol_role')
  const role = loadRoles().find((item) => item.id === roleId)
  if (!role?.permissions?.includes(`${module}.view`)) {
    const firstAllowed = ['students', 'teachers', 'support-teachers', 'groups', 'courses', 'schedule', 'attendance', 'payments', 'finance', 'debts', 'expenses', 'salaries', 'reports', 'notifications', 'users-roles', 'settings', 'activity', 'chat'].find((key) => role?.permissions?.includes(`${key}.view`))
    if (role?.permissions?.includes('dashboard.view')) return <Navigate to="/reception" replace />
    return firstAllowed ? <Navigate to={`/reception/${firstAllowed === 'activity' ? 'activity-log' : firstAllowed}`} replace /> : <NotFound />
  }
  return children
}

function RequireTeacherPermission({ module, children }) {
  const role = loadRoles().find((item) => item.id === 'teacher')
  if (!role?.permissions?.includes(`${module}.view`)) return <Navigate to="/teacher" replace />
  return children
}

function TeacherLanding() {
  const permissions = loadRoles().find((role) => role.id === 'teacher')?.permissions ?? []
  if (permissions.includes('dashboard.view')) return <TeacherPages view="dashboard" />
  const module = ['students', 'teachers', 'support-teachers', 'courses', 'groups', 'schedule', 'attendance', 'finance', 'payments', 'debts', 'expenses', 'salaries', 'reports', 'notifications', 'users-roles', 'settings', 'activity', 'chat'].find((key) => permissions.includes(`${key}.view`))
  return module ? <Navigate to={module === 'activity' ? 'activity-log' : module} replace /> : <NotFound />
}

function TeacherModule({ module, children }) {
  const permissions = loadRoles().find((role) => role.id === 'teacher')?.permissions ?? []
  const editable = ['create', 'edit', 'delete', 'export'].some((action) => permissions.includes(`${module}.${action}`))
  return <RequireTeacherPermission module={module}>{editable ? children : <TeacherPages view={module} />}</RequireTeacherPermission>
}

function RequireAdminPermission({ module, children }) {
  const roleId = sessionIdentity.getItem('educontrol_role');
  const role = loadRoles().find((item) => item.id === roleId);
  if (!role?.permissions?.includes(`${module}.view`)) {
    const firstAllowed = role?.permissions?.find((permission) => permission.endsWith('.view'))?.split('.')[0];
    if (!firstAllowed) return <NotFound />;
    const destination = firstAllowed === 'activity' ? 'activity-log' : firstAllowed;
    return <Navigate to={destination ? `/admin/${destination}` : '/login'} replace />;
  }
  return children;
}

// Login holatini tekshirish
function RequireAuth({ children }) {
  const isLoggedIn = sessionIdentity.getItem('educontrol_logged_in') === 'true'
  const role = sessionIdentity.getItem('educontrol_role')

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />
  }

  const path = window.location.pathname
  if (path === '/account/security') return children
  if (role === 'teacher' && !path.startsWith('/teacher')) return <Navigate to="/teacher" replace />
  if (role === 'reception' && (path.startsWith('/admin') || path.startsWith('/teacher'))) return <Navigate to="/reception" replace />
  if (role !== 'reception' && role !== 'teacher' && (path.startsWith('/reception') || path.startsWith('/teacher'))) return <Navigate to="/admin" replace />
  return children
}

// Login qilgan foydalanuvchini qayta login sahifasiga kiritmaslik
function PublicOnlyRoute({ children }) {
  const isLoggedIn = sessionIdentity.getItem('educontrol_logged_in') === 'true'
  const role = sessionIdentity.getItem('educontrol_role')

  if (isLoggedIn) {
    return <Navigate to={role === 'reception' ? '/reception' : role === 'teacher' ? '/teacher' : '/admin'} replace />
  }

  return children
}

function App() {
  const [permissionVersion, setPermissionVersion] = useState(0)
  const [viewVersion, setViewVersion] = useState(0)
  useEffect(() => {
    const resetViews = () => setViewVersion((version) => version + 1)
    window.addEventListener('educontrol:session-cleared', resetViews)
    return () => window.removeEventListener('educontrol:session-cleared', resetViews)
  }, [])
  useEffect(() => {
    let active = true
    let refreshing = false
    const refresh = async () => {
      if (refreshing || !hasBackendSession() || document.hidden) return
      refreshing = true
      try {
        const { user } = await apiRequest('/auth/session')
        if (!active || !hasBackendSession()) return
        if (!user || sessionPermissionFingerprint(user) !== sessionIdentity.getItem('educontrol_permission_fingerprint')) {
          clearBackendSession()
          setPermissionVersion((version) => version + 1)
        } else {
          await refreshBackendState()
        }
      } catch { /* Retry on focus or the next interval when the network recovers. */ }
      finally { refreshing = false }
    }
    const timer = setInterval(refresh, 10_000)
    void refresh()
    const onExpired = () => setPermissionVersion((version) => version + 1)
    window.addEventListener('educontrol:session-expired', onExpired)
    window.addEventListener('focus', refresh)
    window.addEventListener('educontrol:roles-saved', refresh)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('educontrol:session-expired', onExpired)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('educontrol:roles-saved', refresh)
    }
  }, [])
  return (
    <BrowserRouter>
      <SessionBootstrap key={permissionVersion}>
      <ThemeProvider>
        <SettingsProvider key={viewVersion}>
          <ToastProvider>
            <ChatCallProvider>
            <BackendSyncMonitor />
            <Suspense
              fallback={
                <AsyncState title="Sahifa yuklanmoqda" />
              }
            >
              <Routes>
                {/* Login */}
                <Route
                  path="/login"
                  element={
                    <PublicOnlyRoute>
                      <Login />
                    </PublicOnlyRoute>
                  }
                />

                {/* Bosh sahifa */}
                <Route path="/" element={<Navigate to={sessionIdentity.getItem('educontrol_role') === 'teacher' ? '/teacher' : sessionIdentity.getItem('educontrol_role') === 'reception' ? '/reception' : '/admin'} replace />} />
                <Route path="/account/security" element={<RequireAuth><AccountSecurity /></RequireAuth>} />
                <Route path="/teacher" element={<RequireAuth><AdminLayout /></RequireAuth>}>
                  <Route index element={<TeacherLanding />} />
                  <Route path="dashboard" element={<RequireTeacherPermission module="dashboard"><TeacherPages view="dashboard" /></RequireTeacherPermission>} />
                  <Route path="students" element={<TeacherModule module="students"><Students /></TeacherModule>} />
                  <Route path="schedule" element={<TeacherModule module="schedule"><Schedule /></TeacherModule>} />
                  <Route path="payments" element={<TeacherModule module="payments"><Payments /></TeacherModule>} />
                  <Route path="salaries" element={<TeacherModule module="salaries"><Salaries /></TeacherModule>} />
                  <Route path="teachers" element={<RequireTeacherPermission module="teachers"><Teachers /></RequireTeacherPermission>} />
                  <Route path="support-teachers" element={<RequireTeacherPermission module="support-teachers"><SupportTeachers /></RequireTeacherPermission>} />
                  <Route path="courses" element={<RequireTeacherPermission module="courses"><Courses /></RequireTeacherPermission>} />
                  <Route path="groups" element={<RequireTeacherPermission module="groups"><Groups /></RequireTeacherPermission>} />
                  <Route path="attendance" element={<RequireTeacherPermission module="attendance"><Attendance /></RequireTeacherPermission>} />
                  <Route path="finance" element={<RequireTeacherPermission module="finance"><Finance /></RequireTeacherPermission>} />
                  <Route path="debts" element={<RequireTeacherPermission module="debts"><Finance view="debts" /></RequireTeacherPermission>} />
                  <Route path="expenses" element={<RequireTeacherPermission module="expenses"><Expenses /></RequireTeacherPermission>} />
                  <Route path="reports" element={<RequireTeacherPermission module="reports"><Reports /></RequireTeacherPermission>} />
                  <Route path="users-roles" element={<RequireTeacherPermission module="users-roles"><UsersRoles /></RequireTeacherPermission>} />
                  <Route path="settings" element={<RequireTeacherPermission module="settings"><Settings /></RequireTeacherPermission>} />
                  <Route path="chat" element={<RequireTeacherPermission module="chat"><Chat /></RequireTeacherPermission>} />
                  <Route path="notifications" element={<RequireTeacherPermission module="notifications"><Notifications /></RequireTeacherPermission>} />
                  <Route path="activity-log" element={<RequireTeacherPermission module="activity"><ActivityLog /></RequireTeacherPermission>} />
                  <Route path="*" element={<Navigate to="/teacher" replace />} />
                </Route>
                <Route path="/reception" element={<RequireAuth><ReceptionLayout /></RequireAuth>}>
                  <Route index element={<RequireReceptionPermission module="dashboard"><Reception /></RequireReceptionPermission>} />
                  <Route path="students" element={<RequireReceptionPermission module="students"><ReceptionStudents /></RequireReceptionPermission>} />
                  <Route path="teachers" element={<RequireReceptionPermission module="teachers"><Teachers /></RequireReceptionPermission>} />
                  <Route path="support-teachers" element={<RequireReceptionPermission module="support-teachers"><SupportTeachers /></RequireReceptionPermission>} />
                  <Route path="groups" element={<RequireReceptionPermission module="groups"><ReceptionGroups /></RequireReceptionPermission>} />
                  <Route path="courses" element={<RequireReceptionPermission module="courses"><ReceptionCourses /></RequireReceptionPermission>} />
                  <Route path="schedule" element={<RequireReceptionPermission module="schedule"><ReceptionSchedule /></RequireReceptionPermission>} />
                  <Route path="attendance" element={<RequireReceptionPermission module="attendance"><ReceptionAttendance /></RequireReceptionPermission>} />
                  <Route path="payments" element={<RequireReceptionPermission module="payments"><ReceptionPayments /></RequireReceptionPermission>} />
                  <Route path="finance" element={<RequireReceptionPermission module="finance"><Finance /></RequireReceptionPermission>} />
                  <Route path="debts" element={<RequireReceptionPermission module="debts"><Finance view="debts" /></RequireReceptionPermission>} />
                  <Route path="expenses" element={<RequireReceptionPermission module="expenses"><Expenses /></RequireReceptionPermission>} />
                  <Route path="salaries" element={<RequireReceptionPermission module="salaries"><Salaries /></RequireReceptionPermission>} />
                  <Route path="reports" element={<RequireReceptionPermission module="reports"><Reports /></RequireReceptionPermission>} />
                  <Route path="notifications" element={<RequireReceptionPermission module="notifications"><Notifications /></RequireReceptionPermission>} />
                  <Route path="users-roles" element={<RequireReceptionPermission module="users-roles"><UsersRoles /></RequireReceptionPermission>} />
                  <Route path="settings" element={<RequireReceptionPermission module="settings"><Settings /></RequireReceptionPermission>} />
                  <Route path="activity-log" element={<RequireReceptionPermission module="activity"><ActivityLog /></RequireReceptionPermission>} />
                  <Route path="chat" element={<RequireReceptionPermission module="chat"><Chat /></RequireReceptionPermission>} />
                  <Route path="*" element={<Navigate to="/reception" replace />} />
                </Route>

                {/* Himoyalangan admin panel */}
                <Route
                  path="/admin"
                  element={
                    <RequireAuth>
                      <AdminLayout />
                    </RequireAuth>
                  }
                >
                  {/* /admin ochilganda boshqaruv paneli ochiladi */}
                  <Route index element={<Navigate to="dashboard" replace />} />

                  <Route path="dashboard" element={<RequireAdminPermission module="dashboard"><Dashboard /></RequireAdminPermission>} />
                  <Route path="students" element={<RequireAdminPermission module="students"><Students /></RequireAdminPermission>} />
                  <Route path="teachers" element={<RequireAdminPermission module="teachers"><Teachers /></RequireAdminPermission>} />
                  <Route
                    path="support-teachers"
                    element={<RequireAdminPermission module="support-teachers"><SupportTeachers /></RequireAdminPermission>}
                  />
                  <Route path="courses" element={<RequireAdminPermission module="courses"><Courses /></RequireAdminPermission>} />
                  <Route path="groups" element={<RequireAdminPermission module="groups"><Groups /></RequireAdminPermission>} />
                  <Route path="schedule" element={<RequireAdminPermission module="schedule"><Schedule /></RequireAdminPermission>} />
                  <Route path="attendance" element={<RequireAdminPermission module="attendance"><Attendance /></RequireAdminPermission>} />
                  <Route path="finance" element={<RequireAdminPermission module="finance"><Finance /></RequireAdminPermission>} />
                  <Route path="payments" element={<RequireAdminPermission module="payments"><Payments /></RequireAdminPermission>} />
                  <Route path="debts" element={<RequireAdminPermission module="debts"><Finance view="debts" /></RequireAdminPermission>} />
                  <Route path="expenses" element={<RequireAdminPermission module="expenses"><Expenses /></RequireAdminPermission>} />
                  <Route path="salaries" element={<RequireAdminPermission module="salaries"><Salaries /></RequireAdminPermission>} />
                  <Route path="settings" element={<RequireAdminPermission module="settings"><Settings /></RequireAdminPermission>} />
                  <Route path="reports" element={<RequireAdminPermission module="reports"><Reports /></RequireAdminPermission>} />
                  <Route path="users-roles" element={<RequireAdminPermission module="users-roles"><UsersRoles /></RequireAdminPermission>} />
                  <Route path="notifications" element={<RequireAdminPermission module="notifications"><Notifications /></RequireAdminPermission>} />
                  <Route path="activity-log" element={<RequireAdminPermission module="activity"><ActivityLog /></RequireAdminPermission>} />
                  <Route path="chat" element={<RequireAdminPermission module="chat"><Chat /></RequireAdminPermission>} />

                  <Route path="*" element={<NotFound />} />
                </Route>

                {/* Noma'lum manzillar */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
            </ChatCallProvider>
          </ToastProvider>
        </SettingsProvider>
      </ThemeProvider>
      </SessionBootstrap>
    </BrowserRouter>
  )
}

export default App
