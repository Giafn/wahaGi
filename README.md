# wahaGI - WhatsApp Gateway API

Multi-tenant WhatsApp API menggunakan Baileys library.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment

```bash
cp .env.example .env
```

Edit `.env` dengan konfigurasi Anda:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/wahagi"
JWT_SECRET="your-secret-key"
ADMIN_USERNAME="admin"
ADMIN_PASSWORD="your-password"
PORT=3021
```

### 3. Setup Database

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate
```

### 4. Seed Database (Create Admin User)

```bash
npm run db:seed
```

Atau interactive:
```bash
npm run create-user
```

### 5. Run Server

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

Server akan berjalan di `http://localhost:3021`

---

## 📚 API Documentation

### Swagger UI
Buka `http://localhost:3021/docs` untuk dokumentasi interaktif.

### Authentication

**Login**
```bash
POST /auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your-password"
}

# Response: { "token": "jwt-token-here", "user": {...} }
```

Gunakan token JWT di header untuk request selanjutnya:
```
Authorization: Bearer <your-token>
```

---

## 📱 Usage Flow

### 1. Create Session

```bash
POST /sessions
Authorization: Bearer <token>

{
  "name": "Marketing Bot"
}

# Response: { "session_id": "...", "status": "qr", "qr": "base64-image" }
```

### 2. Connect via QR

Scan QR code yang ditampilkan di `/sessions/:id/qr` atau via frontend.

### 3. Send Message

```bash
POST /sessions/:id/send
Authorization: Bearer <token>

{
  "to": "628123456789",  # WhatsApp LID (tanpa + atau @)
  "text": "Hello from wahaGI!"
}

# Response: { "message_id": "...", "status": "sent" }
```

### 4. Setup Webhook (Optional)

```bash
POST /sessions/:id/webhook
Authorization: Bearer <token>

{
  "url": "https://your-server.com/webhook"
}
```

**Webhook Payload:**
```json
{
  "event": "message.received",
  "session_id": "...",
  "from": "628xxx@s.whatsapp.net",
  "is_group": false,
  "message_id": "...",
  "type": "text",
  "timestamp": 1710000000,
  "text": "Hello!"
}
```

---

## 📂 Project Structure

```
baileys-api/
├── src/
│   ├── routes/         # API endpoints
│   ├── services/       # Business logic
│   ├── db/             # Database client
│   └── index.js        # Entry point
├── prisma/
│   ├── schema.prisma   # Database schema
│   └── migrations/     # Database migrations
├── frontend/           # Built React app
├── auth/               # Baileys auth files (auto-generated)
└── media/              # Uploaded media files (auto-generated)
```

---

## 🔧 Available Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run production server |
| `npm run dev` | Run development server (auto-reload) |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:reset` | Reset database (drop all tables & re-migrate) |
| `npm run db:fresh` | Reset database + regenerate Prisma client |
| `npm run db:seed` | Seed database with initial data (admin user) |
| `npm run db:studio` | Open Prisma Studio (DB viewer) |
| `npm run create-user` | Create admin user (interactive) |
| `npm test` | Run tests |

---

## 🗄️ Database

Menggunakan PostgreSQL dengan Prisma ORM.

**Default Connection:**
- Host: `localhost:5432`
- Database: `wahagi`

**Tables:**
- `users` - User accounts
- `sessions` - WhatsApp sessions
- `chat_history` - Message history
- `chats` - Chat list
- `media` - Uploaded files

---

## 🔐 Security

- JWT authentication untuk semua API endpoints
- Password hashing dengan bcrypt
- CORS enabled untuk frontend

---

## 📝 Notes

- **LID (Linked Device ID)**: WhatsApp sekarang menggunakan LID sebagai identifier utama
- Format LID: `628xxx` (tanpa `+` atau `@s.whatsapp.net`)
- Session auth files disimpan di folder `auth/`
- Media files disimpan di folder `media/`

---

## 🐛 Troubleshooting

**Session tidak connect:**
- Pastikan QR code belum expired (60 detik)
- Restart session dengan `POST /sessions/:id/restart`

**Database error:**
- Pastikan PostgreSQL running
- Check `DATABASE_URL` di `.env`
- Run `npm run db:migrate`

**Port already in use:**
- Ubah `PORT` di `.env`
- Default: `3021`

---

## 📄 License

MIT License
