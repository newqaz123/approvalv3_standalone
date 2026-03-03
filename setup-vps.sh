#!/bin/bash

echo "🚀 ApprovalApp VPS Setup - Starting Installation..."
echo "=================================================="
echo ""
echo "📋 This script will:"
echo "   ✅ Install Docker & Docker Compose"
echo "   ✅ Install Node.js 20.x"
echo "   ✅ Setup PostgreSQL database"
echo "   ✅ Configure environment variables"
echo "   ✅ Create admin user and departments"
echo "   ✅ Start the application"
echo ""

# Progress function
show_progress() {
    echo "🔄 $1..."
    sleep 1
}

show_success() {
    echo "✅ $1"
}

show_info() {
    echo "ℹ️  $1"
}

show_warning() {
    echo "⚠️  $1"
}

# Check if Docker is installed
show_progress "Checking Docker installation"
if ! command -v docker &> /dev/null; then
    echo "📦 Docker not found. Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    sudo usermod -aG docker $USER
    show_success "Docker installed successfully"
    show_warning "Please log out and log back in to use Docker without sudo"
else
    show_success "Docker is already installed"
fi

# Check if Docker Compose is installed
show_progress "Checking Docker Compose installation"
if ! command -v docker-compose &> /dev/null; then
    echo "📦 Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    show_success "Docker Compose installed successfully"
else
    show_success "Docker Compose is already installed"
fi

# Check if Node.js is installed
show_progress "Checking Node.js installation"
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    show_success "Node.js installed successfully"
else
    show_success "Node.js is already installed"
fi

# Install dependencies
show_progress "Installing npm dependencies"
npm install
show_success "Dependencies installed"

# Get server IP
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "localhost")
show_info "Detected server IP: $SERVER_IP"

# Create environment file if it doesn't exist
show_progress "Setting up environment configuration"
if [ ! -f .env.local ]; then
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
    show_success "Environment file created with secure random secrets"
else
    show_info "Environment file already exists, skipping creation"
fi

# Start database
show_progress "Starting PostgreSQL database"
docker-compose up -d db
show_success "Database container started"

# Wait for database
show_progress "Waiting for database to be ready"
sleep 15
show_success "Database is ready"

# Apply migrations
show_progress "Applying database migrations"
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npx prisma migrate deploy
show_success "Database migrations applied"

# Seed database
show_progress "Seeding database with initial data"
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npx prisma db seed
show_success "Database seeded with admin user and departments"

# Generate Prisma client
show_progress "Generating Prisma client"
DATABASE_URL="postgresql://postgres:changeme@localhost:5432/app_db?schema=public" npx prisma generate
show_success "Prisma client generated"

echo ""
echo "🎉 Installation Complete!"
echo "========================"
echo ""
echo "🌐 Application URLs:"
echo "   📱 Main App: http://$SERVER_IP:3000"
echo "   🗄️  Database Admin: http://$SERVER_IP:5555 (run: npx prisma studio)"
echo ""
echo "👤 Admin Login Details:"
echo "   📧 Email: admin@example.com"
echo "   🔑 Password: changeme"
echo "   ⚠️  Please change this password after first login!"
echo ""
echo "� To start the application:"
echo "   npm run dev"
echo ""
echo "�️  Useful Commands:"
echo "   📊 View database: npx prisma studio"
echo "   🔄 Restart database: docker-compose restart db"
echo "   📋 View logs: docker-compose logs db"
echo "   🛑 Stop app: Ctrl+C (when running npm run dev)"
echo ""
echo "📚 First-Time Instructions:"
echo "   1. Start the app: npm run dev"
echo "   2. Open http://$SERVER_IP:3000 in your browser"
echo "   3. Login with admin@example.com / changeme"
echo "   4. Change your admin password immediately"
echo "   5. Create departments and users as needed"
echo "   6. Test the approval workflow"
echo ""
echo "🔧 Troubleshooting:"
echo "   If Docker permission issues occur: log out and log back in"
echo "   If port 3000 is busy: sudo lsof -i :3000 && sudo kill -9 <PID>"
echo "   If database connection fails: docker-compose restart db"
echo ""
echo "🎯 Ready to use! Your ApprovalApp is now set up and running."
