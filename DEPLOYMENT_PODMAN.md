# Podman deployment guide

## Prerequisites

- Podman 4.0+
- PostgreSQL database (external)
- Node.js 20+ (untuk build frontend)

## Quick Deploy

### 1. Setup Environment

```bash
# Copy environment file
cp .env.example .env

# Edit dengan kredensial Anda
nano .env
```

Pastikan untuk mengubah:
- `DATABASE_URL` - koneksi ke PostgreSQL eksternal
- `JWT_SECRET` - secret key untuk JWT
- `ADMIN_PASSWORD` - password admin

### 2. Build Frontend

```bash
cd frontend-react
npm install
npm run build
cd ..
```

### 3. Build & Run dengan Podman Compose

```bash
# Install podman-compose (jika belum)
pip install podman-compose

# Build image
podman-compose build

# Start container
podman-compose up -d

# Check logs
podman-compose logs -f
```

### 4. Verify Deployment

```bash
# Check container status
podman ps

# Test health endpoint
curl http://localhost:3000/health
```

## Manual Deployment (podman run)

```bash
# Build image
podman build -t baileys-api:latest .

# Create volumes
podman volume create baileys-media
podman volume create baileys-auth

# Run container
podman run -d \
  --name baileys-api \
  -p 3000:3000 \
  --env-file .env \
  -v baileys-media:/data/media \
  -v baileys-auth:/data/auth \
  --restart=always \
  baileys-api:latest
```

## Systemd Auto-start

```bash
# Generate systemd unit
podman generate systemd --new --name baileys-api \
  > ~/.config/systemd/user/podman-baileys-api.service

# Enable lingering
loginctl enable-linger $(whoami)

# Enable and start
systemctl --user daemon-reload
systemctl --user enable podman-baileys-api.service
systemctl --user start podman-baileys-api.service

# Check status
systemctl --user status podman-baileys-api.service
```

## Troubleshooting

### Container tidak bisa connect ke database

```bash
# Test koneksi database dari host
psql -h your-db-host -U postgres -d baileys_api

# Check firewall rules
sudo firewall-cmd --list-all

# Pastikan database accessible dari host Podman
```

### Permission denied pada volume

```bash
# Untuk rootless Podman, pastikan volume accessible
podman unshare chown -R 1000:1000 /var/lib/containers/storage/volumes/
```

### Cek logs

```bash
# Container logs
podman logs baileys-api

# Follow logs
podman logs -f baileys-api

# Last 100 lines
podman logs --tail 100 baileys-api
```

### Restart container

```bash
podman restart baileys-api

# Atau dengan compose
podman-compose restart
```

### Update ke versi terbaru

```bash
# Pull image baru
podman pull baileys-api:latest

# Stop dan remove
podman stop baileys-api && podman rm baileys-api

# Start dengan image baru
podman-compose up -d
```

## Backup & Restore

### Backup

```bash
# Backup media files
podman run --rm \
  -v baileys-media:/source:ro \
  -v $(pwd):/backup \
  alpine tar czf backup/media-$(date +%Y%m%d).tar.gz -C /source .

# Backup auth files
podman run --rm \
  -v baileys-auth:/source:ro \
  -v $(pwd):/backup \
  alpine tar czf backup/auth-$(date +%Y%m%d).tar.gz -C /source .

# Backup database (dari database server)
pg_dump -h your-db-host -U postgres baileys_api > backup/db-$(date +%Y%m%d).sql
```

### Restore

```bash
# Restore media
podman run --rm \
  -v baileys-media:/target \
  -v $(pwd):/backup \
  alpine tar xzf /backup/media-YYYYMMDD.tar.gz -C /target

# Restore auth
podman run --rm \
  -v baileys-auth:/target \
  -v $(pwd):/backup \
  alpine tar xzf /backup/auth-YYYYMMDD.tar.gz -C /target

# Restore database
psql -h your-db-host -U postgres baileys_api < backup/db-YYYYMMDD.sql
```

## Security Best Practices

1. **Gunakan rootless mode** - Podman default sudah rootless
2. **Update .env dengan secret yang kuat**
3. **Enable firewall** - hanya expose port yang diperlukan
4. **Gunakan HTTPS** - deploy reverse proxy (nginx/caddy) di depan
5. **Regular backup** - setup cron job untuk backup otomatis
6. **Monitor logs** - setup log aggregation (Loki, ELK, dll)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | - | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | - | Secret key untuk JWT |
| `ADMIN_PASSWORD` | ✅ | - | Password admin initial |
| `PORT` | - | 3000 | Server port |
| `MEDIA_DIR` | - | /data/media | Media storage path |
| `AUTH_DIR` | - | /data/auth | Baileys auth path |
| `PUBLIC_URL` | - | http://localhost:3000 | Base URL untuk media |

## Common Issues

### Issue: "database does not exist"

```bash
# Pastikan database sudah dibuat di PostgreSQL
psql -h your-db-host -U postgres -c "CREATE DATABASE baileys_api;"
```

### Issue: "port already in use"

```bash
# Ganti port di .env
PORT=3001

# Atau map ke port berbeda
podman run -p 3001:3000 ...
```

### Issue: "permission denied" untuk volumes

```bash
# Gunakan named volumes (direkomendasikan)
podman volume create baileys-media
podman volume create baileys-auth

# Atau set proper permissions
chmod 755 /path/to/host/volumes
```
