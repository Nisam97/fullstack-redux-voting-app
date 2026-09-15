import { Navigate, useLocation } from 'react-router-dom';
import { isAdminLoggedIn } from '../services/auth.js';

/**
 * AdminGuard
 * Protects administrative routes by verifying whether an admin session is currently active.
 * Unauthenticated users are redirected to the canonical /login route, preserving the target URL.
 * Authenticated admins are allowed to proceed to the protected route children.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 */
export function AdminGuard({ children }) {
  const location = useLocation();
  const authenticated = isAdminLoggedIn();

  if (!authenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}

export default AdminGuard;
