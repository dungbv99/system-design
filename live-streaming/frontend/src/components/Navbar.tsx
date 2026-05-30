import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/')
  }

  return (
    <nav className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-8">
        <Link to="/" className="text-xl font-bold text-purple-400 tracking-tight">
          StreamZ
        </Link>
        <Link to="/" className="text-gray-300 hover:text-white text-sm transition-colors">
          Browse
        </Link>
        {user && (
          <Link to="/dashboard" className="text-gray-300 hover:text-white text-sm transition-colors">
            Dashboard
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3">
        {user ? (
          <>
            <span className="text-sm text-gray-400">{user.username}</span>
            <button
              onClick={handleLogout}
              className="text-sm px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 transition-colors"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link
              to="/login"
              className="text-sm px-3 py-1.5 rounded text-gray-300 hover:text-white transition-colors"
            >
              Log in
            </Link>
            <Link
              to="/register"
              className="text-sm px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 font-medium transition-colors"
            >
              Sign up
            </Link>
          </>
        )}
      </div>
    </nav>
  )
}
