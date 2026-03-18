# Testing Media Upload API

## Swagger UI Limitation

Swagger UI memiliki keterbatasan untuk upload file via multipart/form-data. Untuk testing media upload, gunakan **curl** atau **Postman**.

---

## 1. Send Single Media

### curl
```bash
curl -X POST 'http://localhost:3021/sessions/YOUR_SESSION_ID/send-media' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -F 'to=6281234567890' \
  -F 'file=@/path/to/image.jpg' \
  -F 'caption=Hello from wahaGI!'
```

### Postman
1. Method: **POST**
2. URL: `http://localhost:3021/sessions/{id}/send-media`
3. Headers:
   - `Authorization: Bearer YOUR_JWT_TOKEN`
4. Body → **form-data**:
   - `to` (Text): `6281234567890`
   - `file` (File): [Select file]
   - `caption` (Text): `Hello!`

---

## 2. Send Multiple Media

### curl
```bash
curl -X POST 'http://localhost:3021/sessions/YOUR_SESSION_ID/send-multiple-media' \
  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \
  -F 'to=6281234567890' \
  -F 'files=@/path/to/photo1.jpg' \
  -F 'files=@/path/to/photo2.jpg' \
  -F 'files=@/path/to/photo3.jpg' \
  -F 'caption=Product photos'
```

### Postman
1. Method: **POST**
2. URL: `http://localhost:3021/sessions/{id}/send-multiple-media`
3. Headers:
   - `Authorization: Bearer YOUR_JWT_TOKEN`
4. Body → **form-data**:
   - `to` (Text): `6281234567890`
   - `files` (File): [Select file 1]
   - `files` (File): [Select file 2] (klik "Add" untuk tambah lebih banyak)
   - `caption` (Text): `Product photos`

---

## Response Format

### Success (200)
```json
{
  "message_id": "ABC123XYZ",
  "status": "sent"
}
```

### Multiple Media (200)
```json
{
  "sent": 3,
  "message_ids": ["ABC1", "ABC2", "ABC3"]
}
```

### Error (400)
```json
{
  "error": "Session not connected"
}
```

### Error (404)
```json
{
  "error": "Session not found"
}
```

---

## Supported Media Types

| Type | MIME Types | Extensions |
|------|------------|------------|
| Image | `image/jpeg`, `image/png`, `image/gif`, `image/webp` | `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp` |
| Video | `video/mp4`, `video/quicktime` | `.mp4`, `.mov` |
| Document | `application/pdf`, `application/zip`, etc. | `.pdf`, `.zip`, `.docx`, `.xlsx` |
| Audio | `audio/mpeg`, `audio/ogg`, `audio/mp4` | `.mp3`, `.ogg`, `.m4a` |

---

## Tips

1. **File size limit**: 50MB per file
2. **Max files**: 20 files per request (multiple media)
3. **Delay**: Random delay 500-1000ms antar file (anti-ban)
4. **Phone number**: Harus dengan country code (62 untuk Indonesia)
5. **Caption**: Optional, max 1024 karakter

---

## Webhook Response

Ketika ada yang kirim media ke WA Anda, webhook akan mengirim:

```json
{
  "event": "message.received",
  "session_id": "uuid",
  "from": "628xxx@s.whatsapp.net",
  "type": "image",
  "mimetype": "image/jpeg",
  "filename": "image.jpg",
  "caption": "Hello",
  "media_url": "http://localhost:3021/media/files/123456-abc.jpg",
  "media_size": 102400,
  "timestamp": 1710000000
}
```

> Media otomatis di-download dan URL-nya disertakan di webhook!
