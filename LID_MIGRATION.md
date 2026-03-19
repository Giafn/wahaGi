# LID Migration Guide

## Overview

API telah diupdate untuk menggunakan **WhatsApp LID (Local ID)** sebagai primary identifier daripada real phone number. Perubahan ini membuat:

- ✅ **Lebih ringan** - tidak perlu resolve phone number setiap saat
- ✅ **Lebih mudah digunakan** - identifier konsisten dari WhatsApp
- ✅ **Lebih reliable** - tidak bergantung pada phone number resolution yang bisa berubah

## Perubahan Schema

### Chat Table
- **Sebelum**: `jid` (phone number) sebagai primary identifier
- **Sekarang**: `lid` (WhatsApp LID) sebagai primary identifier
- **Optional**: `phone` field untuk menyimpan real phone number (untuk display)

### ChatHistory Table
- **Sebelum**: `from` (phone number), `lid` (optional)
- **Sekarang**: `from` (LID), `phone` (optional untuk display)

## API Changes

### Send Message
```bash
# Sebelum
curl -X POST http://localhost:3000/sessions/<id>/send \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to":"628123456789","text":"Halo!"}'

# Sekarang (tetap bisa pakai phone number)
curl -X POST http://localhost:3000/sessions/<id>/send \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to":"628123456789","text":"Halo!"}'

# Atau langsung pakai LID
curl -X POST http://localhost:3000/sessions/<id>/send \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"to":"1234567890abcdef","text":"Halo!"}'
```

### Get Contacts
```bash
# Response sekarang include lid dan phone
[
  {
    "id": "uuid",
    "lid": "1234567890abcdef",  // Primary identifier
    "phone": "628123456789",     // Optional, untuk display
    "name": "Contact Name",
    "unread_count": 0,
    "last_message_time": 1234567890
  }
]
```

### Get Chat Messages
```bash
# URL parameter sekarang pakai lid
GET /sessions/:id/chats/:lid/messages

# Response
[
  {
    "id": "uuid",
    "from": "1234567890abcdef",  // LID
    "lid": "1234567890abcdef",
    "phone": "628123456789",     // Optional
    "message": "Hello",
    "type": "text",
    "is_from_me": false,
    "timestamp": 1234567890
  }
]
```

### Webhook Payload
```json
{
  "event": "message.received",
  "session_id": "uuid",
  "from": "628xxx@s.whatsapp.net",
  "lid": "1234567890abcdef",      // Primary identifier
  "phone_number": "628123456789", // Optional, untuk display
  "is_group": false,
  "message_id": "xxx",
  "type": "text",
  "text": "Halo!",
  "timestamp": 1710000000
}
```

## Migration Steps

### 1. Backup Data
```bash
# Backup database Anda sebelum upgrade
pg_dump $DATABASE_URL > backup_before_lid_migration.sql
```

### 2. Update Code
Pull versi terbaru dari repository.

### 3. Run Migration
```bash
cd /Users/macbook/project/personal/baileys-api
npx prisma generate
npx prisma db push --force-reset --accept-data-loss
```

**⚠️ PERINGATAN**: `--force-reset` akan menghapus semua data! Pastikan sudah backup.

### 4. Restart API
```bash
npm start
# atau
docker compose restart api
```

## FAQ

### Q: Apakah masih bisa kirim pesan pakai phone number?
**A:** Ya! API tetap menerima phone number di parameter `to`. System akan otomatis convert ke LID.

### Q: Bagaimana cara dapat phone number dari LID?
**A:** Phone number disimpan di field `phone` (optional). Jika tersedia, akan ditampilkan di response API dan webhook.

### Q: Apa keuntungan pakai LID?
**A:** 
- Lebih reliable - tidak bergantung pada phone number resolution
- Lebih cepat - tidak perlu lookup ke WhatsApp untuk resolve phone number
- Lebih konsisten - LID tidak berubah meskipun user ganti nomor

### Q: Apakah ada breaking changes?
**A:** 
- Endpoint `/sessions/:id/chats/:jid/messages` → `/sessions/:id/chats/:lid/messages`
- Endpoint `/messages/:phoneNumber` → `/messages/:lid`
- Response API sekarang return `lid` sebagai primary identifier

## Rollback

Jika ingin rollback ke versi sebelumnya:

```bash
# Restore database dari backup
psql $DATABASE_URL < backup_before_lid_migration.sql

# Revert code ke versi sebelumnya
git checkout <previous-commit>

# Restart API
npm start
```

## Support

Jika ada masalah atau pertanyaan, silakan buka issue di repository.
