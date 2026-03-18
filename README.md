# wahaGI — Multi-Tenant WhatsApp Gateway

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
git clone <repo> wahaGI && cd wahaGI

# 2. Copy env
cp .env.example .env
# Edit .env — ubah DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD

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

## Deployment dengan Podman

Podman adalah alternatif Docker yang daemonless dan lebih aman (rootless by default).

### 1. Persiapan Environment

```bash
# Copy dan edit .env
cp .env.example .env
nano .env

# Pastikan DATABASE_URL mengarah ke PostgreSQL eksternal
DATABASE_URL="postgresql://postgres:password@your-db-host:5432/baileys_api"
JWT_SECRET="your-super-secret-key"
ADMIN_PASSWORD="secure-password"
```

### 2. Build Frontend

```bash
cd frontend-react
npm install
npm run build
cd ..
```

### 3. Build Image Podman

```bash
podman build -t baileys-api:latest .
```

### 4. Jalankan Container

**Opsi A: Menggunakan podman run**

```bash
# Buat volume untuk persistensi data
podman volume create baileys-media
podman volume create baileys-auth

# Jalankan container
podman run -d \
  --name baileys-api \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://postgres:password@your-db-host:5432/baileys_api" \
  -e JWT_SECRET="your-super-secret-key" \
  -e ADMIN_PASSWORD="secure-password" \
  -e MEDIA_DIR=/data/media \
  -e AUTH_DIR=/data/auth \
  -v baileys-media:/data/media \
  -v baileys-auth:/data/auth \
  --restart=always \
  baileys-api:latest
```

**Opsi B: Menggunakan Podman Compose (direkomendasikan)**

```bash
# Install podman-compose jika belum
pip install podman-compose

# Jalankan dengan compose
podman-compose up -d

# Lihat log
podman-compose logs -f api
```

### 5. Auto-start dengan Systemd

Podman dapat generate systemd unit file untuk auto-start:

```bash
# Generate systemd service
podman generate systemd --new --name baileys-api > ~/.config/systemd/user/podman-baileys-api.service

# Reload systemd
systemctl --user daemon-reload

# Enable dan start
systemctl --user enable podman-baileys-api.service
systemctl --user start podman-baileys-api.service

# Cek status
systemctl --user status podman-baileys-api.service
```

### 6. Enable Lingering (Agar Tetap Jalan Setelah Logout)

```bash
# Untuk user saat ini
loginctl enable-linger $(whoami)
```

### 7. Update Container

```bash
# Pull image baru
podman pull baileys-api:latest

# Stop dan remove container lama
podman stop baileys-api && podman rm baileys-api

# Jalankan ulang dengan image baru
podman-compose up -d
```

### 8. Backup Data

```bash
# Backup volume media dan auth
podman run --rm \
  -v baileys-media:/source:ro \
  -v $(pwd):/backup \
  alpine tar czf /backup/media-backup-$(date +%Y%m%d).tar.gz -C /source .

podman run --rm \
  -v baileys-auth:/source:ro \
  -v $(pwd):/backup \
  alpine tar czf /backup/auth-backup-$(date +%Y%m%d).tar.gz -C /source .
```

---

## Perbedaan Docker vs Podman

| Feature | Docker | Podman |
|---------|--------|--------|
| Daemon | Required | Daemonless |
| Root required | Yes (default) | Rootless |
| Compose | `docker compose` | `podman-compose` |
| Systemd integration | Manual | Built-in (`podman generate systemd`) |
| Security | Good | Better (SELinux support) |
| Registry login | `docker login` | `podman login` |

> **Note:** `docker-compose.yml` kompatibel dengan `podman-compose`. Cukup ganti perintah `docker compose` dengan `podman-compose`.

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
| GET | `/auth/me` | Get current user |

> **Note:** Registration is disabled by default for security. Create users manually via script.

**Login:**
```bash
curl -X POST http://localhost:3021/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme123"}'
```

**Create User (Manual):**
```bash
# Via npm script
npm run create-user -- newuser securepassword

# Or directly
node scripts/create-user.js newuser securepassword
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

- **Runtime**: Node.js 20+
- **Framework**: Fastify 4
- **WA Library**: @whiskeysockets/baileys
- **ORM**: Prisma + PostgreSQL (eksternal)
- **Auth**: JWT
- **Frontend**: React 18 + Tailwind CSS + Vite
- **Deploy**: Docker / Podman (rootless)
