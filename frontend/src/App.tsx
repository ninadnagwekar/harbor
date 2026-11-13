import { Navigate, Route, Routes } from "react-router-dom"
import { Shell } from "@/components/layout/shell"
import { useAuth } from "@/lib/auth"
import { ForgotPage, InvitePage, LoginPage, ResetPage, SetupPage } from "@/pages/auth-pages"
import { DashboardPage, MyTasksPage, NotificationsPage, ProjectsPage } from "@/pages/home-pages"
import { ProjectPage } from "@/pages/project-page"
import { SettingsPage, TeamPage } from "@/pages/team-page"
import { PageLoading } from "@/components/ui-bits"

function RequireAuth() {
  const { user, loading, needsSetup } = useAuth()
  if (loading) {
    return (
      <div className="grid min-h-svh place-items-center">
        <PageLoading />
      </div>
    )
  }
  if (needsSetup) return <Navigate to="/setup" replace />
  if (!user) return <Navigate to="/login" replace />
  return <Shell />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/forgot" element={<ForgotPage />} />
      <Route path="/invite/:token" element={<InvitePage />} />
      <Route path="/reset/:token" element={<ResetPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/my-tasks" element={<MyTasksPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/team" element={<TeamPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
