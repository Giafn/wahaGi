import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) { toast.error('All fields required'); return; }
    setLoading(true);
    try {
      await login(form.username, form.password);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg grid-bg flex items-center justify-center relative overflow-hidden">
      {/* Glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[600px] h-[600px] rounded-full bg-green/5 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm px-4">
        <div className="bg-surface border border-border relative top-line animate-fade-in card-glow">
          <div className="p-10">
            <p className="font-mono text-green text-xs tracking-widest uppercase mb-2">// baileys-api v1.0</p>
            <h1 className="font-mono text-2xl font-semibold text-white mb-8">Sign In</h1>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="font-mono text-xs text-muted tracking-widest uppercase block mb-2">Username</label>
                <input
                  type="text"
                  autoComplete="username"
                  value={form.username}
                  onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="admin"
                  className="w-full bg-bg border border-border text-white font-mono text-sm px-4 py-3 outline-none focus:border-border-active transition-colors"
                />
              </div>
              <div>
                <label className="font-mono text-xs text-muted tracking-widest uppercase block mb-2">Password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full bg-bg border border-border text-white font-mono text-sm px-4 py-3 outline-none focus:border-border-active transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase py-3.5 mt-2 hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Authenticating...' : 'Access System →'}
              </button>
            </form>

            <p className="font-mono text-xs text-muted text-center mt-6">
              No account?{' '}
              <Link to="/register" className="text-green hover:underline">Register</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
