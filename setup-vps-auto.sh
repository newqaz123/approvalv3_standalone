#!/bin/bash

echo "🚀 Fully Automated VPS Setup for ApprovalApp..."

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Update system packages
echo "📦 Updating system packages..."
sudo apt-get update -y

# Install Docker if not exists
if ! command_exists docker; then
    echo "📦 Installing Docker..."
    sudo apt-get install -y apt-transport-https ca-certificates curl gnupg lsb-release
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update -y
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io
    sudo systemctl start docker
    sudo systemctl enable docker
    echo "✅ Docker installed and started"
else
    echo "✅ Docker already installed"
fi

# Install Docker Compose if not exists
if ! command_exists docker-compose; then
    echo "📦 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
else
    echo "✅ Docker Compose already installed"
fi

# Install Node.js if not exists
if ! command_exists node; then
    echo "📦 Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "✅ Node.js installed"
else
    echo "✅ Node.js already installed"
fi

# Add current user to docker group without requiring logout
echo "🔧 Setting Docker permissions..."
sudo usermod -aG docker $USER
echo "⚠️  Note: You may need to log out and log back in for Docker permissions to take effect"

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "localhost")
echo "🌐 Detected server IP: $SERVER_IP"

# Create environment file if it doesn't exist
if [ ! -f .env.local ]; then
    echo "⚙️  Creating .env.local file..."
    cat > .env.local << EOF
# Database - PostgreSQL connection string (Docker Container)
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public"

# NextAuth.js Configuration
NEXTAUTH_URL="http://$SERVER_IP:3000"
NEXTAUTH_SECRET="$(openssl rand -base64 32)"

# Local File Storage Configuration
UPLOAD_DIR=public/uploads
CRON_SECRET="$(openssl rand -base64 32)"
EOF
    echo "✅ Environment file created with secure random secrets"
else
    echo "✅ Environment file already exists"
fi

# Stop any existing containers
echo "🧹 Cleaning up existing containers..."
docker-compose down 2>/dev/null || true

# Start database
echo "📦 Starting PostgreSQL database..."
docker-compose up -d db

# Wait for database to be ready
echo "⏳ Waiting for database to be ready..."
for i in {1..30}; do
    if docker exec approval-db pg_isready -U postgres -d app_db >/dev/null 2>&1; then
        echo "✅ Database is ready!"
        break
    fi
    echo "⏳ Waiting for database... ($i/30)"
    sleep 2
done

# Apply migrations
echo "🗄️  Applying database migrations..."
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npx prisma migrate deploy

# Seed database
echo "🌱 Seeding database with initial data..."
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npx prisma db seed

# Generate Prisma client
echo "⚙️  Generating Prisma client..."
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npx prisma generate

# Create a startup script for the app
echo "📝 Creating app startup script..."
cat > start-app.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting ApprovalApp..."
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npm run dev
EOF
chmod +x start-app.sh

# Create a systemd service for auto-start
echo "⚙️  Creating systemd service..."
sudo tee /etc/systemd/system/approval-app.service > /dev/null << EOF
[Unit]
Description=Approval App
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
Environment=DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public"
ExecStart=/usr/bin/npm run dev
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable approval-app
sudo systemctl start approval-app

echo ""
echo "🎉 Setup Complete!"
echo "=================="
echo "📱 App URL: http://$SERVER_IP:3000"
echo "👤 Admin Login: admin@example.com / changeme"
echo "🗄️  Database Admin: npx prisma studio (port 5555)"
echo ""
echo "🔧 Service Management:"
echo "  Start: sudo systemctl start approval-app"
echo "  Stop: sudo systemctl stop approval-app"
echo "  Status: sudo systemctl status approval-app"
echo "  Logs: sudo journalctl -u approval-app -f"
echo ""
echo "⚠️  Important Notes:"
echo "  - Change admin password after first login"
echo "  - Consider setting up HTTPS with Let's Encrypt"
echo "  - Backup your database regularly"
echo "  - If Docker permission issues occur, log out and log back in"
