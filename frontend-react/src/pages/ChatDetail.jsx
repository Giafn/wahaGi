import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Send, Paperclip, Smile, Mic } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import toast from 'react-hot-toast';

export default function ChatDetail() {
  const { id, jid } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  const loadMessages = async () => {
    try {
      const data = await api.getChatMessages(id, jid, 50);
      setMessages(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadSession = async () => {
    try {
      const data = await api.getSession(id);
      setSession(data);
    } catch (err) {
      toast.error(err.message);
      navigate(`/device/${id}`);
    }
  };

  useEffect(() => {
    loadSession();
    loadMessages();
    
    // Poll for new messages every 5 seconds
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, [id, jid]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!messageText.trim()) return;
    
    setSending(true);
    try {
      await api.sendText(id, jid.split('@')[0], messageText);
      setMessageText('');
      await loadMessages();
      toast.success('Message sent');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return date.toLocaleDateString('id-ID', { weekday: 'long' });
    return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const phoneNumber = jid?.split('@')[0] || '';

  return (
    <div className="h-screen flex flex-col bg-bg">
      {/* Header */}
      <header className="bg-surface border-b border-border px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(`/device/${id}`)}
          className="flex items-center gap-2 text-muted hover:text-white transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h2 className="font-mono text-sm font-semibold text-white">{phoneNumber}</h2>
          <p className="font-mono text-xs text-muted">{session?.status === 'connected' ? 'Connected' : 'Disconnected'}</p>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-border border-t-green rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center py-12">
            <p className="font-mono text-xs text-muted">No messages yet</p>
            <p className="font-mono text-xs text-muted mt-2">Say hello! 👋</p>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const isFromMe = msg.is_from_me;
              const showDate = idx === 0 || 
                new Date(msg.timestamp).toDateString() !== new Date(messages[idx - 1]?.timestamp).toDateString();
              
              return (
                <div key={msg.id}>
                  {showDate && (
                    <div className="flex items-center justify-center my-4">
                      <span className="font-mono text-xs text-muted bg-bg px-3 py-1 rounded">
                        {formatDate(msg.timestamp)}
                      </span>
                    </div>
                  )}
                  
                  <div className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[70%] rounded-lg px-3 py-2 ${
                        isFromMe
                          ? 'bg-green text-black'
                          : 'bg-surface border border-border text-white'
                      }`}
                    >
                      {/* Message type indicator */}
                      {msg.type !== 'text' && (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs opacity-70">
                            📎 {msg.type}
                          </span>
                        </div>
                      )}
                      
                      {/* Message text */}
                      <p className="font-mono text-xs whitespace-pre-wrap break-words">
                        {msg.message}
                      </p>
                      
                      {/* Timestamp */}
                      <p className={`font-mono text-[10px] mt-1 text-right ${
                        isFromMe ? 'text-black/60' : 'text-muted'
                      }`}>
                        {formatTime(msg.timestamp)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="bg-surface border-t border-border p-3">
        <div className="flex items-end gap-2">
          <button
            className="p-2 text-muted hover:text-white transition-colors"
            title="Attach file"
          >
            <Paperclip size={20} />
          </button>
          
          <div className="flex-1 bg-bg border border-border rounded-lg flex items-center">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 bg-transparent text-white font-mono text-sm px-3 py-2 outline-none resize-none max-h-32"
              style={{ minHeight: '40px' }}
            />
            <button className="p-2 text-muted hover:text-white transition-colors">
              <Smile size={20} />
            </button>
          </div>
          
          <button
            onClick={sendMessage}
            disabled={sending || !messageText.trim()}
            className="p-3 bg-green text-black rounded-lg hover:opacity-85 transition-opacity disabled:opacity-40"
          >
            {messageText.trim() ? <Send size={20} /> : <Mic size={20} />}
          </button>
        </div>
      </div>
    </div>
  );
}
