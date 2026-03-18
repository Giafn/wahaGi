// Use VITE_API_BASE_URL from .env file, or empty string for same-origin
const BASE = import.meta.env.VITE_API_BASE_URL || '';

function getToken() {
  return localStorage.getItem('token');
}

async function request(method, path, body, isFormData = false) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  // Don't send body for GET/DELETE, or if body is empty object
  const sendBody = body && Object.keys(body).length > 0;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: sendBody ? (isFormData ? body : JSON.stringify(body)) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
    throw new Error('Unauthorized');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  me: () => request('GET', '/auth/me'),

  // Sessions
  listSessions: () => request('GET', '/sessions'),
  getSession: (id) => request('GET', `/sessions/${id}`),
  createSession: (name) => request('POST', '/sessions', { name }),
  deleteSession: (id) => request('DELETE', `/sessions/${id}`),
  getQR: (id) => request('GET', `/sessions/${id}/qr`),
  setWebhook: (id, url) => request('POST', `/sessions/${id}/webhook`, { url }),
  restartSession: (id) => request('POST', `/sessions/${id}/restart`, {}),
  setStatus: (id, text) => request('POST', `/sessions/${id}/status`, { text }),

  // Messages
  sendText: (id, to, text, reply_to) => request('POST', `/sessions/${id}/send`, { to, text, reply_to }),
  sendMedia: (id, to, media_ids, caption, reply_to) =>
    request('POST', `/sessions/${id}/send-media`, { to, media_ids, caption, reply_to }),

  // Chats
  listChats: (id) => request('GET', `/sessions/${id}/chats`),
  listContacts: (id) => request('GET', `/sessions/${id}/contacts`),

  // Media
  uploadMedia: (formData) => request('POST', '/media/upload', formData, true),
  listMedia: () => request('GET', '/media'),
  deleteMedia: (id) => request('DELETE', `/media/${id}`),
};
