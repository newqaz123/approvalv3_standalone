#!/bin/bash

echo "🚀 Starting ApprovalApp Development Environment (Docker)..."

# Start all services in Docker
echo "📦 Starting all services in Docker containers..."
docker-compose -f docker-compose.dev.yml up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 30

# Check if all containers are running
echo "🔍 Checking service status..."
docker ps --filter "name=approval-" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "✅ Development environment started!"
echo "=================================="
echo "📱 Web App: http://localhost:3000"
echo "🗄️  Database Admin: http://localhost:5555"
echo "👤 Admin Login: admin@example.com / changeme"
echo ""
echo "🛠️  Docker Commands:"
echo "   📊 View logs: docker-compose -f docker-compose.dev.yml logs -f"
echo "   🔄 Restart: docker-compose -f docker-compose.dev.yml restart"
echo "   🛑 Stop: docker-compose -f docker-compose.dev.yml down"
echo "   📋 Status: docker-compose -f docker-compose.dev.yml ps"
echo ""
echo "🎯 All services are running in Docker containers!"
