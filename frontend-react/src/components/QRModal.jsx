import { useEffect, useState, useCallback } from 'react';
import { X, RefreshCw, CheckCircle, Wifi } from 'lucide-react';
import { api } from '../services/api';

export default function QRModal({ sessionId, onClose, onConnected }) {
  const [qr, setQr] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);

  const poll = useCallback(async () => {
    try {
      const data = await api.getQR(sessionId);
      setStatus(data.status);
      if (data.qr) setQr(data.qr);
      if (data.status === 'connected') {
        onConnected?.();
        return true; // stop polling
      }
    } catch (err) {
      setError(err.message);
      return true;
    }
    return false;
  }, [sessionId, onConnected]);

  useEffect(() => {
    let timer;
    let stopped = false;

    const run = async () => {
      const done = await poll();
      if (!done && !stopped) {
        timer = setTimeout(run, 2500);
      }
    };

    run();
    return () => { stopped = true; clearTimeout(timer); };
  }, [poll]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 bg-surface border border-border w-full max-w-sm animate-slide-up card-glow">
        {/* Top accent */}
        <div className="h-0.5 bg-gradient-to-r from-transparent via-green to-transparent" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div>
            <p className="font-mono text-xs text-green tracking-widest uppercase">// scan qr code</p>
            <p className="font-mono text-xs text-muted mt-0.5">Open WhatsApp → Linked Devices</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-white transition-colors p-1">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col items-center">
          {status === 'connected' ? (
            <div className="py-8 flex flex-col items-center gap-3">
              <CheckCircle size={48} className="text-green" />
              <p className="font-mono text-sm text-green">Device connected!</p>
              <button onClick={onClose} className="mt-2 bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase px-6 py-2.5 hover:opacity-85 transition-opacity">
                Close
              </button>
            </div>
          ) : error ? (
            <div className="py-8 flex flex-col items-center gap-3">
              <p className="font-mono text-xs text-red text-center">{error}</p>
              <button onClick={() => { setError(null); poll(); }} className="flex items-center gap-2 font-mono text-xs text-green hover:underline">
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          ) : qr ? (
            <div className="flex flex-col items-center gap-4">
              <div className="p-3 bg-white">
                <img src={qr} alt="QR Code" className="w-56 h-56 block" />
              </div>
              <div className="flex items-center gap-2">
                <Wifi size={12} className="text-amber animate-pulse" />
                <span className="font-mono text-xs text-muted">Waiting for scan...</span>
              </div>
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-border border-t-green rounded-full animate-spin" />
              <p className="font-mono text-xs text-muted">Generating QR code...</p>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="px-6 py-3 border-t border-border flex items-center gap-2">
          <span className={`status-dot ${status}`} />
          <span className="font-mono text-xs text-muted capitalize">{status}</span>
          {qr && status !== 'connected' && (
            <button onClick={poll} className="ml-auto text-muted hover:text-green transition-colors">
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
