import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Trash2, Copy, Image, Film, FileText, Music, RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Layout from '../components/Layout';
import { api } from '../services/api';

const ICON_MAP = {
  'image/': Image,
  'video/': Film,
  'audio/': Music,
};

function getIcon(mimeType) {
  const key = Object.keys(ICON_MAP).find(k => mimeType?.startsWith(k));
  return key ? ICON_MAP[key] : FileText;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaPool() {
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const fileRef = useRef();

  const load = useCallback(async () => {
    try {
      const data = await api.listMedia();
      setMedia(data.media || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uploadFiles = async (files) => {
    if (!files.length) return;
    setUploading(true);
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));
    try {
      const data = await api.uploadMedia(formData);
      toast.success(`${data.count} file(s) uploaded`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteMedia(id);
      setMedia(m => m.filter(x => x.id !== id));
      setSelected(s => { const n = new Set(s); n.delete(id); return n; });
      toast.success('Deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Delete ${selected.size} file(s)?`)) return;
    const ids = [...selected];
    await Promise.all(ids.map(id => api.deleteMedia(id).catch(() => {})));
    setMedia(m => m.filter(x => !ids.includes(x.id)));
    setSelected(new Set());
    toast.success(`${ids.length} file(s) deleted`);
  };

  const toggleSelect = (id) => {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const copyId = (id) => {
    navigator.clipboard.writeText(id);
    toast.success('ID copied to clipboard');
  };

  const copySelected = () => {
    const ids = JSON.stringify([...selected]);
    navigator.clipboard.writeText(ids);
    toast.success(`${selected.size} IDs copied as JSON array`);
  };

  return (
    <Layout
      title="Media Pool"
      subtitle={`${media.length} file(s) stored`}
      actions={
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <>
              <button onClick={copySelected} className="flex items-center gap-2 border border-border font-mono text-xs text-muted px-3 py-2 hover:text-white transition-colors">
                <Copy size={12} /> Copy IDs ({selected.size})
              </button>
              <button onClick={handleDeleteSelected} className="flex items-center gap-2 border border-red/30 font-mono text-xs text-red px-3 py-2 hover:bg-red/10 transition-colors">
                <Trash2 size={12} /> Delete ({selected.size})
              </button>
            </>
          )}
          <button onClick={load} className="flex items-center gap-2 border border-border font-mono text-xs text-muted px-3 py-2 hover:text-white transition-colors">
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 bg-green text-black font-mono text-xs font-semibold tracking-widest uppercase px-4 py-2.5 hover:opacity-85 transition-opacity disabled:opacity-40"
          >
            <Upload size={13} /> {uploading ? 'Uploading...' : 'Upload Files'}
          </button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={e => uploadFiles(e.target.files)} />
        </div>
      }
    >
      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors mb-6 ${
          dragOver ? 'border-green bg-green/5' : 'border-border hover:border-subtle'
        }`}
      >
        <Upload size={24} className={dragOver ? 'text-green' : 'text-muted'} />
        <p className="font-mono text-xs text-muted text-center">
          {uploading ? 'Uploading...' : 'Drop files here or click to upload'}<br />
          <span className="text-subtle">Images, videos, audio, documents — max 50MB each</span>
        </p>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center gap-3 py-8">
          <div className="w-5 h-5 border-2 border-border border-t-green rounded-full animate-spin" />
          <span className="font-mono text-xs text-muted">Loading media...</span>
        </div>
      ) : media.length === 0 ? (
        <div className="border border-dashed border-border p-16 flex flex-col items-center gap-4">
          <Image size={40} className="text-subtle" />
          <p className="font-mono text-sm text-muted">No media uploaded yet</p>
        </div>
      ) : (
        <>
          {selected.size > 0 && (
            <div className="bg-green/5 border border-green/20 px-4 py-3 flex items-center justify-between mb-4">
              <span className="font-mono text-xs text-green">{selected.size} file(s) selected</span>
              <button onClick={() => setSelected(new Set())} className="text-muted hover:text-white">
                <X size={14} />
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {media.map(item => {
              const Icon = getIcon(item.mimeType);
              const isImg = item.mimeType?.startsWith('image/');
              const isSelected = selected.has(item.id);

              return (
                <div
                  key={item.id}
                  onClick={() => toggleSelect(item.id)}
                  className={`relative bg-surface border cursor-pointer group transition-all ${
                    isSelected ? 'border-green ring-1 ring-green/30' : 'border-border hover:border-subtle'
                  }`}
                >
                  {/* Checkbox */}
                  <div className={`absolute top-2 left-2 z-10 w-4 h-4 border flex items-center justify-center transition-all ${
                    isSelected ? 'border-green bg-green' : 'border-border bg-bg opacity-0 group-hover:opacity-100'
                  }`}>
                    {isSelected && <span className="text-black text-xs">✓</span>}
                  </div>

                  {/* Delete */}
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(item.id); }}
                    className="absolute top-2 right-2 z-10 p-1 bg-bg/80 border border-border text-muted hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 size={10} />
                  </button>

                  {/* Preview */}
                  <div className="aspect-square flex items-center justify-center bg-bg overflow-hidden">
                    {isImg ? (
                      <img src={item.url} alt={item.filename} className="w-full h-full object-cover" />
                    ) : (
                      <Icon size={28} className="text-muted" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-2 border-t border-border">
                    <p className="font-mono text-xs text-white truncate">{item.filename}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-mono text-xs text-muted">{formatBytes(item.size)}</span>
                      <button
                        onClick={e => { e.stopPropagation(); copyId(item.id); }}
                        className="text-muted hover:text-green transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Copy size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Layout>
  );
}
