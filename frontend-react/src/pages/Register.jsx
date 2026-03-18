import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username || !form.password) { toast.error('All fields required'); return; }
    if (form.password !== form.confirm) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await register(form.username, form.password);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg grid-bg flex items-center justify-center relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[600px] h-[600px] rounded-full bg-green/5 blur-3xl" />
      </div>
      <div className="relative z-10 w-full max-w-sm px-4">
        <div className="bg-surface border border-border relative top-line animate-fade-in card-glow">
          <div className="p-10">
            <p className="font-mono text-green text-xs tracking-widest uppercase mb-2">// baileys-api v1.0</p>
            <h1 className="font-mono text-2xl font-semibold text-white mb-8">Register</h1>
            <form onSubmit={handleSubmit} className="space-y-5">
              {[
                { key: 'username', label: 'Username', type: 'text', placeholder: 'myusername' },
                { key: 'password', label: 'Password', type: 'password', placeholder: '••••••••' },
                { key: 'confirm', label: 'Confirm Password', type: 'password', placeholder: '••••••••' },
              ].map(({ key, label, type, placeholder }) => (
                <div key={key}>
                  <label className="font-mono text-xs text-muted tracking-widest uppercase block mb-2">{label}</label>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full bg-bg border border-border text-white font-mono text-sm px-4 py-3 outline-none focus:border-border-active transition-colors"
                  />
                </div>
              ))}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase py-3.5 mt-2 hover:opacity-85 transition-opacity disabled:opacity-40"
              >
                {loading ? 'Creating...' : 'Create Account →'}
              </button>
            </form>
            <p className="font-mono text-xs text-muted text-center mt-6">
              Already have an account?{' '}
              <Link to="/" className="text-green hover:underline">Login</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
