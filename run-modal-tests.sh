#!/bin/bash

# Run Playwright tests for modal system in headed mode
# This allows visual verification of the new modal components

echo "🚀 Starting Modal System E2E Tests in Headed Mode"
echo "=================================================="
echo ""
echo "This will:"
echo "  1. Start the development server"
echo "  2. Run Playwright tests with browser visible"
echo "  3. Test all modal workflows"
echo ""

# Check if dev server is running
if ! curl -s http://localhost:3000 > /dev/null; then
    echo "⚠️  Development server not running on port 3000"
    echo "Please start the dev server first with: npm run dev"
    exit 1
fi

echo "✅ Development server detected on port 3000"
echo ""

# Create screenshots directory if it doesn't exist
mkdir -p tests/screenshots

# Run Playwright tests in headed mode
echo "🎭 Running Playwright tests in headed mode..."
echo ""

npx playwright test tests/e2e/modal-system.spec.ts \
  --headed \
  --workers=1 \
  --timeout=60000 \
  --reporter=list

echo ""
echo "=================================================="
echo "✅ Tests completed!"
echo ""
echo "Screenshots saved to: tests/screenshots/"
echo ""
