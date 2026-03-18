import clsx from 'clsx';

const STATUS_CONFIG = {
  connected:    { label: 'Connected',    color: 'text-green',  bg: 'bg-green/10  border-green/20' },
  connecting:   { label: 'Connecting',   color: 'text-amber',  bg: 'bg-amber/10  border-amber/20' },
  qr:           { label: 'Awaiting QR',  color: 'text-blue',   bg: 'bg-blue/10   border-blue/20' },
  disconnected: { label: 'Disconnected', color: 'text-muted',  bg: 'bg-subtle/50 border-border' },
};

export default function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.disconnected;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 px-2 py-0.5 border font-mono text-xs',
      cfg.color, cfg.bg
    )}>
      <span className={`status-dot ${status}`} />
      {cfg.label}
    </span>
  );
}
