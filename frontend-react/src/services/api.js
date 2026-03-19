// Use VITE_API_BASE_URL from .env file, or empty string for same-origin
const BASE = import.meta.env.VITE_API_BASE_URL || '';

function getToken() {
  return localStorage.getItem('token');
}

async function request(method, path, body, isFormData = false, queryParams = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!isFormData) headers['Content-Type'] = 'application/json';

  // Build query string
  const queryString = Object.keys(queryParams).length > 0
    ? '?' + new URLSearchParams(queryParams).toString()
    : '';

  // Don't send body for GET/DELETE, or if body is empty object
  const sendBody = body && Object.keys(body).length > 0;

  const res = await fetch(`${BASE}${path}${queryString}`, {
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
  sendMedia: (id, formData) => {
    const token = localStorage.getItem('token');
    return fetch(`/sessions/${id}/send-media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    }).then(res => {
      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
        throw new Error('Unauthorized');
      }
      return res.json().then(data => {
        if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
        return data;
      });
    });
  },
  sendMultipleMedia: (id, formData) => {
    const token = localStorage.getItem('token');
    return fetch(`/sessions/${id}/send-multiple-media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    }).then(res => {
      if (res.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/';
        throw new Error('Unauthorized');
      }
      return res.json().then(data => {
        if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
        return data;
      });
    });
  },

  // Chats
  listChats: (id) => request('GET', `/sessions/${id}/chats`),
  listContacts: (id) => request('GET', `/sessions/${id}/contacts`),
  getChatMessages: (id, jid, limit = 50) => {
    // Don't encode here - let the request function handle it
    return request('GET', `/sessions/${id}/chats/${jid}/messages`, undefined, false, { limit });
  },
};
