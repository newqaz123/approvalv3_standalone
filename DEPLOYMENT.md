# VPS Deployment Guide

## Quick Setup (Ubuntu/Debian)

### 1. Clone and Setup
```bash
git clone <your-repo-url>
cd ApprovalAppV3_Standalone
./setup-vps.sh
```

### 2. Start the Application
```bash
npm run dev
```

## What the Setup Script Does

✅ **Installs Dependencies:**
- Docker & Docker Compose
- Node.js 20.x
- npm packages

✅ **Creates Environment:**
- `.env.local` with secure random secrets
- Auto-detects your VPS IP address
- Configures database connection

✅ **Database Setup:**
- Starts PostgreSQL in Docker
- Applies all migrations
- Seeds initial data (admin user, departments)

✅ **Generates Prisma Client**

## Manual VPS Setup (if script fails)

### Install Dependencies
```bash
# Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
sudo usermod -aG docker $USER

# Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Log out and back in for Docker permissions
```

### Configure Environment
```bash
# Copy the template
cp .env.example .env.local

# Edit for your setup
nano .env.local
```

**Development (.env.local):**
```bash
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
UPLOAD_DIR="public/uploads"
CRON_SECRET="$(openssl rand -base64 32)"
```

**Production (.env.production):**
```bash
DATABASE_URL="postgresql://postgres:changeme@db:5432/app_db?schema=public"
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"
UPLOAD_DIR="public/uploads"
CRON_SECRET="$(openssl rand -base64 32)"
```

### Start Services
```bash
# Install npm packages
npm install

# Start database
docker-compose up -d db

# Setup database
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npx prisma db seed

# Start app
npm run dev
```

## Production Deployment

For production, consider:

### Option 1: Docker Compose (Full)
```bash
docker-compose up -d
```

### Option 2: PM2 (Process Manager)
```bash
npm install -g pm2
pm2 start npm --name "approval-app" -- run dev
pm2 startup
pm2 save
```

### Option 3: Systemd Service
Create `/etc/systemd/system/approval-app.service`:
```ini
[Unit]
Description=Approval App
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/path/to/ApprovalAppV3_Standalone
ExecStart=/usr/bin/npm run dev
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable approval-app
sudo systemctl start approval-app
```

## Security Notes

🔒 **Change Default Passwords:**
- Database: Update `changeme` in docker-compose.yml
- Admin: Change `changeme` after first login

🔒 **Firewall:**
```bash
sudo ufw allow 22    # SSH
sudo ufw allow 3000  # App
sudo ufw enable
```

🔒 **Environment:**
- Use strong secrets in production
- Consider HTTPS with Let's Encrypt
- Backup database regularly

## Access After Setup

- **App:** `http://YOUR_VPS_IP:3000`
- **Admin:** `admin@example.com` / `changeme`
- **Database:** `npx prisma studio` (port 5555)

## Troubleshooting

### Docker Permission Issues
```bash
sudo usermod -aG docker $USER
# Log out and log back in
```

### Port Already in Use
```bash
sudo lsof -i :3000
sudo kill -9 <PID>
```

### Database Connection Issues
```bash
docker-compose logs db
docker-compose restart db
```
