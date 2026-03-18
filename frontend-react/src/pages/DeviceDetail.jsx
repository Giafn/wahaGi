import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, QrCode, Send, Globe, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import StatusBadge from '../components/StatusBadge';
import QRModal from '../components/QRModal';
import { api } from '../services/api';

export default function DeviceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qrOpen, setQrOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('webhook');

  // Webhook form
  const [webhookUrl, setWebhookUrl] = useState('');
  const [savingWebhook, setSavingWebhook] = useState(false);

  // Send test form
  const [sendForm, setSendForm] = useState({ to: '', text: '' });
  const [sending, setSending] = useState(false);

  // Chats
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getSession(id);
      setSession(data);
      setWebhookUrl(data.webhook_url || '');
    } catch (err) {
      toast.error(err.message);
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [load]);

  const loadChats = async () => {
    setChatsLoading(true);
    try {
      const data = await api.listChats(id);
      setChats(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChatsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'chats') loadChats();
  }, [activeTab]);

  const saveWebhook = async () => {
    if (!webhookUrl) { toast.error('URL required'); return; }
    setSavingWebhook(true);
    try {
      await api.setWebhook(id, webhookUrl);
      toast.success('Webhook saved');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingWebhook(false);
    }
  };

  const sendTest = async () => {
    if (!sendForm.to || !sendForm.text) { toast.error('To and text required'); return; }
    setSending(true);
    try {
      const result = await api.sendText(id, sendForm.to, sendForm.text);
      toast.success(`Sent! ID: ${result.message_id?.slice(0, 8)}...`);
      setSendForm(f => ({ ...f, text: '' }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleRestart = async () => {
    try {
      await api.restartSession(id);
      toast.success('Restarting...');
      setTimeout(load, 2000);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this device? This cannot be undone.')) return;
    try {
      await api.deleteSession(id);
      toast.success('Device deleted');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const TABS = [
    { id: 'webhook', label: 'Webhook', icon: Globe },
    { id: 'send', label: 'Send Test', icon: Send },
    { id: 'chats', label: 'Chats', icon: MessageSquare },
  ];

  if (loading) return (
    <Layout title="Loading...">
      <div className="flex items-center gap-3 py-12">
        <div className="w-5 h-5 border-2 border-border border-t-green rounded-full animate-spin" />
        <span className="font-mono text-xs text-muted">Loading device...</span>
      </div>
    </Layout>
  );

  return (
    <Layout
      title={session?.name}
      subtitle={`Device ID: ${id.slice(0, 8)}...`}
      actions={
        <div className="flex items-center gap-2">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 border border-border font-mono text-xs text-muted px-3 py-2 hover:text-white transition-colors">
            <ArrowLeft size={12} /> Back
          </button>
          {session?.status !== 'connected' && (
            <button onClick={() => setQrOpen(true)} className="flex items-center gap-2 border border-blue/30 text-blue font-mono text-xs px-3 py-2 hover:bg-blue/10 transition-colors">
              <QrCode size={12} /> QR Code
            </button>
          )}
          <button onClick={handleRestart} className="flex items-center gap-2 border border-border font-mono text-xs text-muted px-3 py-2 hover:text-white transition-colors">
            <RefreshCw size={12} /> Restart
          </button>
          <button onClick={handleDelete} className="flex items-center gap-2 border border-border font-mono text-xs text-muted px-3 py-2 hover:text-red hover:border-red/30 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      }
    >
      {qrOpen && (
        <QRModal
          sessionId={id}
          onClose={() => { setQrOpen(false); load(); }}
          onConnected={() => { setQrOpen(false); load(); }}
        />
      )}

      {/* Status card */}
      <div className="bg-surface border border-border p-5 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <StatusBadge status={session?.status} />
          <div>
            <p className="font-mono text-xs text-muted">Status</p>
            <p className="font-mono text-sm text-white capitalize">{session?.status}</p>
          </div>
          {session?.last_seen && (
            <div className="pl-4 border-l border-border">
              <p className="font-mono text-xs text-muted">Last Seen</p>
              <p className="font-mono text-xs text-white">
                {new Date(session.last_seen).toLocaleString('id-ID')}
              </p>
            </div>
          )}
        </div>
        {session?.status !== 'connected' && (
          <button
            onClick={() => setQrOpen(true)}
            className="flex items-center gap-2 bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase px-4 py-2.5 hover:opacity-85 transition-opacity"
          >
            <QrCode size={12} /> Connect
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-border flex gap-0 mb-6">
        {TABS.map(({ id: tid, label, icon: Icon }) => (
          <button
            key={tid}
            onClick={() => setActiveTab(tid)}
            className={`flex items-center gap-2 px-5 py-3 font-mono text-xs border-b-2 transition-colors ${
              activeTab === tid
                ? 'border-green text-green'
                : 'border-transparent text-muted hover:text-white'
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* Webhook tab */}
      {activeTab === 'webhook' && (
        <div className="max-w-xl animate-fade-in">
          <p className="font-mono text-xs text-muted mb-4 leading-relaxed">
            Incoming messages and session events will be POSTed to this URL as JSON.
            Retries: 3x with exponential backoff.
          </p>
          <label className="font-mono text-xs text-muted tracking-widest uppercase block mb-2">Webhook URL</label>
          <div className="flex gap-3">
            <input
              value={webhookUrl}
              onChange={e => setWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="flex-1 bg-bg border border-border text-white font-mono text-sm px-4 py-3 outline-none focus:border-border-active transition-colors"
            />
            <button
              onClick={saveWebhook}
              disabled={savingWebhook}
              className="flex items-center gap-2 bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase px-4 py-3 hover:opacity-85 transition-opacity disabled:opacity-40"
            >
              <Save size={12} /> {savingWebhook ? 'Saving...' : 'Save'}
            </button>
          </div>

          {/* Payload preview */}
          <div className="mt-6">
            <p className="font-mono text-xs text-muted tracking-widest uppercase mb-3">// example payload</p>
            <pre className="bg-bg border border-border p-4 font-mono text-xs text-green/80 overflow-x-auto leading-relaxed">
{`{
  "event": "message.received",
  "session_id": "${id}",
  "from": "628xxx@s.whatsapp.net",
  "type": "text",
  "text": "Hello!",
  "timestamp": 1710000000
}`}
            </pre>
          </div>
        </div>
      )}

      {/* Send test tab */}
      {activeTab === 'send' && (
        <div className="max-w-xl animate-fade-in">
          {session?.status !== 'connected' && (
            <div className="border border-amber/30 bg-amber/5 p-4 font-mono text-xs text-amber mb-6">
              ⚠ Device not connected. Connect via QR first.
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="font-mono text-xs text-muted tracking-widest uppercase block mb-2">To (phone number)</label>
              <input
                value={sendForm.to}
                onChange={e => setSendForm(f => ({ ...f, to: e.target.value }))}
                placeholder="628xxxxxxxxxx"
                className="w-full bg-bg border border-border text-white font-mono text-sm px-4 py-3 outline-none focus:border-border-active transition-colors"
              />
            </div>
            <div>
              <label className="font-mono text-xs text-muted tracking-widest uppercase block mb-2">Message</label>
              <textarea
                value={sendForm.text}
                onChange={e => setSendForm(f => ({ ...f, text: e.target.value }))}
                placeholder="Hello from Baileys API!"
                rows={4}
                className="w-full bg-bg border border-border text-white font-mono text-sm px-4 py-3 outline-none focus:border-border-active transition-colors resize-none"
              />
            </div>
            <button
              onClick={sendTest}
              disabled={sending || session?.status !== 'connected'}
              className="flex items-center gap-2 bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase px-5 py-3 hover:opacity-85 transition-opacity disabled:opacity-40"
            >
              <Send size={12} /> {sending ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </div>
      )}

      {/* Chats tab */}
      {activeTab === 'chats' && (
        <div className="animate-fade-in">
          <div className="flex items-center justify-between mb-4">
            <p className="font-mono text-xs text-muted">{chats.length} chats loaded</p>
            <button onClick={loadChats} disabled={chatsLoading} className="flex items-center gap-2 font-mono text-xs text-muted hover:text-green transition-colors">
              <RefreshCw size={12} className={chatsLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          {chatsLoading ? (
            <div className="flex items-center gap-3 py-8">
              <div className="w-4 h-4 border-2 border-border border-t-green rounded-full animate-spin" />
              <span className="font-mono text-xs text-muted">Loading chats...</span>
            </div>
          ) : chats.length === 0 ? (
            <div className="border border-dashed border-border p-12 text-center">
              <p className="font-mono text-xs text-muted">No chats available</p>
            </div>
          ) : (
            <div className="border border-border divide-y divide-border">
              {chats.map(chat => (
                <div key={chat.id} className="flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-white truncate">{chat.name || chat.id}</p>
                    <p className="font-mono text-xs text-muted">{chat.id}</p>
                  </div>
                  {chat.unread_count > 0 && (
                    <span className="bg-green text-black font-mono text-xs font-bold px-2 py-0.5 ml-2 flex-shrink-0">
                      {chat.unread_count}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Layout>
  );
}
