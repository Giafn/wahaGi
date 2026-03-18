import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Settings, QrCode, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import QRModal from '../components/QRModal';
import { api } from '../services/api';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [qrSession, setQrSession] = useState(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const data = await api.listSessions();
      setSessions(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) { toast.error('Device name required'); return; }
    setCreating(true);
    try {
      const data = await api.createSession(newName.trim());
      toast.success(`Session "${newName}" created`);
      setNewName('');
      setShowCreate(false);
      await load();
      // Auto-open QR modal if not yet connected
      if (data.status !== 'connected') {
        setQrSession(data.session_id);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete device "${name}"? This cannot be undone.`)) return;
    try {
      await api.deleteSession(id);
      toast.success('Device deleted');
      setSessions(s => s.filter(x => x.id !== id));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRestart = async (id) => {
    try {
      await api.restartSession(id);
      toast.success('Restarting...');
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const connectedCount = sessions.filter(s => s.status === 'connected').length;

  return (
    <Layout
      title="Devices"
      subtitle={`${connectedCount} of ${sessions.length} connected`}
      actions={
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase px-4 py-2.5 hover:opacity-85 transition-opacity"
        >
          <Plus size={13} /> Add Device
        </button>
      }
    >
      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowCreate(false)} />
          <div className="relative z-10 bg-surface border border-border w-full max-w-sm animate-slide-up card-glow">
            <div className="h-0.5 bg-gradient-to-r from-transparent via-green to-transparent" />
            <div className="p-6">
              <p className="font-mono text-xs text-green tracking-widest uppercase mb-4">// new device</p>
              <label className="font-mono text-xs text-muted tracking-widest uppercase block mb-2">Device Name</label>
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                placeholder="e.g. Marketing Bot"
                className="w-full bg-bg border border-border text-white font-mono text-sm px-4 py-3 outline-none focus:border-border-active transition-colors mb-4"
              />
              <div className="flex gap-3">
                <button onClick={() => setShowCreate(false)} className="flex-1 border border-border font-mono text-xs text-muted py-2.5 hover:text-white transition-colors">
                  Cancel
                </button>
                <button onClick={handleCreate} disabled={creating} className="flex-1 bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase py-2.5 hover:opacity-85 transition-opacity disabled:opacity-40">
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Modal */}
      {qrSession && (
        <QRModal
          sessionId={qrSession}
          onClose={() => { setQrSession(null); load(); }}
          onConnected={() => { setQrSession(null); load(); }}
        />
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center gap-3 py-12">
          <div className="w-5 h-5 border-2 border-border border-t-green rounded-full animate-spin" />
          <span className="font-mono text-xs text-muted">Loading devices...</span>
        </div>
      ) : sessions.length === 0 ? (
        <div className="border border-border border-dashed p-16 flex flex-col items-center gap-4">
          <WifiOff size={40} className="text-subtle" />
          <p className="font-mono text-sm text-muted">No devices yet</p>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase px-4 py-2.5 hover:opacity-85 transition-opacity"
          >
            <Plus size={13} /> Add First Device
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {sessions.map(session => (
            <div
              key={session.id}
              className="bg-surface border border-border hover:border-subtle transition-colors group relative"
            >
              {/* Status top accent */}
              {session.status === 'connected' && (
                <div className="h-0.5 bg-gradient-to-r from-transparent via-green to-transparent" />
              )}

              <div className="p-5">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="min-w-0">
                    <h3 className="font-mono text-sm font-semibold text-white truncate">{session.name}</h3>
                    <p className="font-mono text-xs text-muted mt-0.5 truncate">{session.id.slice(0, 8)}...</p>
                  </div>
                  <StatusBadge status={session.status} />
                </div>

                {/* Meta */}
                <div className="space-y-1.5 mb-5">
                  <div className="flex justify-between">
                    <span className="font-mono text-xs text-muted">Webhook</span>
                    <span className="font-mono text-xs text-white truncate max-w-[140px]">
                      {session.webhook_url ? (
                        <span className="text-green">✓ configured</span>
                      ) : (
                        <span className="text-muted">— not set</span>
                      )}
                    </span>
                  </div>
                  {session.last_seen && (
                    <div className="flex justify-between">
                      <span className="font-mono text-xs text-muted">Last seen</span>
                      <span className="font-mono text-xs text-white">
                        {new Date(session.last_seen).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t border-border">
                  {session.status !== 'connected' && (
                    <button
                      onClick={() => setQrSession(session.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-blue/30 text-blue hover:bg-blue/10 font-mono text-xs transition-colors"
                    >
                      <QrCode size={12} /> QR
                    </button>
                  )}
                  <button
                    onClick={() => handleRestart(session.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-white hover:border-subtle font-mono text-xs transition-colors"
                  >
                    <RefreshCw size={12} /> Restart
                  </button>
                  <button
                    onClick={() => navigate(`/device/${session.id}`)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-white hover:border-subtle font-mono text-xs transition-colors ml-auto"
                  >
                    <Settings size={12} /> Config
                  </button>
                  <button
                    onClick={() => handleDelete(session.id, session.name)}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted hover:text-red hover:border-red/30 font-mono text-xs transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Layout>
  );
}
