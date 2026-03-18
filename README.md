# Baileys API — Multi-Tenant WhatsApp Gateway

REST API berbasis [Baileys](https://github.com/WhiskeySockets/Baileys) untuk multi-device dan multi-tenant WhatsApp, lengkap dengan admin panel React.

---

## Features

- **Multi-tenant** — setiap user punya session (device) sendiri
- **Multi-device** — satu user bisa punya banyak WA session
- **REST API** — bersih, JSON, mudah diintegrasikan ke n8n / AI
- **Media Pool** — upload banyak file, kirim sequential (anti-ban)
- **Webhook** — push event ke URL kamu, retry 3x exponential backoff
- **Admin Panel** — React + Tailwind, QR modal, media manager
- **JWT Auth** — stateless, secure

---

## Quick Start (Docker Compose)

```bash
# 1. Clone & masuk folder
git clone <repo> baileys-api && cd baileys-api

# 2. Copy env
cp .env.example .env
# Edit .env — ubah JWT_SECRET, POSTGRES_PASSWORD, ADMIN_PASSWORD

# 3. Build frontend React dulu
cd frontend-react
npm install
npm run build       # output → ../frontend/
cd ..

# 4. Jalankan
docker compose up -d

# 5. Cek log
docker compose logs -f api
```

Buka: http://localhost:3000

---

## Manual Setup (tanpa Docker)

### Requirements
- Node.js 20+
- PostgreSQL 14+

```bash
npm install

# Setup env
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, dll

# Migrate DB
npm run db:push

# Seed admin user
node scripts/seed.js

# Build frontend
cd frontend-react && npm install && npm run build && cd ..

# Start
npm start
# atau dev mode:
npm run dev
```

---

## API Reference

### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/login` | Login, returns JWT |
| POST | `/auth/register` | Register new user |
| GET | `/auth/me` | Get current user |

**Login:**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme123"}'
```

### Sessions (Device)

Semua endpoint butuh header: `Authorization: Bearer <token>`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/sessions` | List semua device |
| POST | `/sessions` | Buat device baru |
| GET | `/sessions/:id` | Status device |
| GET | `/sessions/:id/qr` | Get QR code (base64) |
| DELETE | `/sessions/:id` | Hapus device |
| POST | `/sessions/:id/webhook` | Set webhook URL |
| POST | `/sessions/:id/restart` | Restart session |
| POST | `/sessions/:id/status` | Set WA about/status |
| POST | `/sessions/:id/profile-picture` | Ganti foto profil |

**Buat device baru:**
```bash
curl -X POST http://localhost:3000/sessions \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Marketing Bot"}'
```

**Polling QR:**
```bash
# Poll /sessions/:id/qr sampai status = connected
curl http://localhost:3000/sessions/<id>/qr \
  -H "Authorization: Bearer <token>"
# Response: { "qr": "data:image/png;base64,...", "status": "qr" }
```

### Messages

| Method | Path | Description |
|--------|------|-------------|
| POST | `/sessions/:id/send` | Kirim teks |
| POST | `/sessions/:id/send-media` | Kirim media dari pool (sequential) |
| GET | `/sessions/:id/chats` | List chat |
| GET | `/sessions/:id/contacts` | List kontak |

**Kirim teks:**
```bash
curl -X POST http://localhost:3000/sessions/<id>/send \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to":"628xxxxxxxxxx","text":"Halo!"}'
```

**Kirim multiple media (sequential, anti-ban):**
```bash
curl -X POST http://localhost:3000/sessions/<id>/send-media \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "628xxxxxxxxxx",
    "media_ids": ["uuid1", "uuid2", "uuid3"],
    "caption": "Ini 3 gambar produk",
    "reply_to": null
  }'
```

### Media Pool

| Method | Path | Description |
|--------|------|-------------|
| POST | `/media/upload` | Upload satu/banyak file |
| GET | `/media` | List semua media |
| GET | `/media/:id` | Info satu file |
| DELETE | `/media/:id` | Hapus file |

**Upload multiple files:**
```bash
curl -X POST http://localhost:3000/media/upload \
  -H "Authorization: Bearer <token>" \
  -F "files=@photo1.jpg" \
  -F "files=@photo2.jpg" \
  -F "files=@catalog.pdf"
# Response: { "media_ids": ["id1","id2","id3"], "count": 3 }
```

---

## Webhook Events

Set webhook URL di `/sessions/:id/webhook`, lalu semua event akan di-POST ke URL kamu.

**Pesan masuk (teks):**
```json
{
  "event": "message.received",
  "session_id": "uuid",
  "from": "628xxx@s.whatsapp.net",
  "message_id": "xxx",
  "type": "text",
  "text": "Halo!",
  "timestamp": 1710000000
}
```

**Pesan masuk (media):**
```json
{
  "event": "message.received",
  "session_id": "uuid",
  "from": "628xxx@s.whatsapp.net",
  "type": "image",
  "mimetype": "image/jpeg",
  "caption": "Ini gambar",
  "timestamp": 1710000000
}
```

**Update status session:**
```json
{
  "event": "session.update",
  "session_id": "uuid",
  "status": "connected"
}
```

> Retry: 3x dengan delay 2s, 4s, 6s (exponential backoff).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWT_SECRET` | — | **Wajib diubah!** |
| `JWT_EXPIRY` | `7d` | Token expiry |
| `PORT` | `3000` | Server port |
| `MEDIA_DIR` | `./media` | Folder penyimpanan file |
| `AUTH_DIR` | `./auth` | Folder auth Baileys per session |
| `PUBLIC_URL` | `http://localhost:3000` | Base URL untuk media links |
| `MEDIA_SEND_DELAY_MIN` | `500` | Min delay antar kirim (ms) |
| `MEDIA_SEND_DELAY_MAX` | `1000` | Max delay antar kirim (ms) |
| `WEBHOOK_RETRY_COUNT` | `3` | Jumlah retry webhook gagal |
| `WEBHOOK_RETRY_DELAY` | `2000` | Base delay retry (ms) |
| `ADMIN_USERNAME` | `admin` | Username admin awal |
| `ADMIN_PASSWORD` | `changeme123` | **Wajib diubah!** |

---

## Integrasi n8n

1. Gunakan **HTTP Request** node untuk semua endpoint
2. Auth: **Header Auth** — `Authorization: Bearer <token>`
3. Untuk trigger incoming message: setup **Webhook** node di n8n, masukkan URL-nya ke `/sessions/:id/webhook`

---

## Limitations

- Unofficial WhatsApp API — risiko banned ada
- WhatsApp bisa ubah protokol kapan saja
- Jangan spam, gunakan delay yang wajar
- Tidak untuk broadcast massal tanpa rate limiting

---

## Stack

- **Runtime**: Node.js 22
- **Framework**: Fastify 4
- **WA Library**: @whiskeysockets/baileys
- **ORM**: Prisma + PostgreSQL
- **Auth**: JWT
- **Frontend**: React 18 + Tailwind CSS + Vite
- **Deploy**: Docker / Podman
