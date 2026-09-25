import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import UserDashboard from './pages/UserDashboard';
import AdminDashboard from './pages/AdminDashboard';
import Upload from './pages/Upload';
import UploadHistory from './pages/UploadHistory';
import UploadDetails from './pages/UploadDetails';
import Rules from './pages/Rules';
import Definitions from './pages/Definitions';
import Lookups from './pages/Lookups';
import AdminUsers from './pages/admin/Users';
import AdminFileDefinitions from './pages/admin/FileDefinitions';
import AuditLogs from './pages/admin/AuditLogs';
import Monitoring from './pages/admin/Monitoring';
import Compliance from './pages/admin/Compliance';
import Layout from './components/Layout';

// Protected route wrapper component
function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.Role)) {
    // Redirect to appropriate dashboard based on role
    if (user.Role === 'admin') {
      return <Navigate to="/admin" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function App() {
  const { user, isLoading } = useAuth();

  // Show a full-screen loading spinner only on initial load before hydration
  // This prevents flash of content and ensures auth state is restored
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500 text-sm">Loading application...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route 
        path="/login" 
        element={user ? <Navigate to={user.Role === 'admin' ? '/admin' : '/'} replace /> : <Login />} 
      />
      
      {/* SSO Callback route - renders Login component which handles the callback */}
      <Route 
        path="/auth/callback" 
        element={<Login />} 
      />
      
      {/* Standard User routes */}
      <Route 
        path="/" 
        element={
          <ProtectedRoute allowedRoles={['user']}>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<UserDashboard />} />
        <Route path="upload" element={<Upload />} />
        <Route path="history" element={<UploadHistory />} />
        <Route path="history/:id" element={<UploadDetails />} />
        <Route path="rules" element={<Rules />} />
        <Route path="definitions" element={<Definitions />} />
        <Route path="lookups" element={<Lookups />} />
      </Route>

      {/* Global Admin routes */}
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute allowedRoles={['admin']}>
            <Layout />
          </ProtectedRoute>
        }
      >
      <Route index element={<AdminDashboard />} />
        {/* Standard user capabilities, also available to admins */}
        <Route path="my-dashboard" element={<UserDashboard />} />
        <Route path="upload" element={<Upload />} />
        <Route path="definitions" element={<Definitions />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="file-definitions" element={<AdminFileDefinitions />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="compliance" element={<Compliance />} />
        <Route path="history" element={<UploadHistory />} />
        <Route path="history/:id" element={<UploadDetails />} />
        <Route path="rules" element={<Rules />} />
        <Route path="lookups" element={<Lookups />} />
      </Route>

      {/* Catch all - redirect to login or appropriate dashboard */}
      <Route 
        path="*" 
        element={
          user ? (
            <Navigate to={user.Role === 'admin' ? '/admin' : '/'} replace />
          ) : (
            <Navigate to="/login" replace />
          )
        } 
      />
    </Routes>
  );
}

export default App;

