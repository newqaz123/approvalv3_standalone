# Multi-stage Dockerfile for Next.js with Prisma
# Based on Vercel/Next.js and Prisma Docker best practices

FROM node:20-alpine AS base
# Install dependencies required for Prisma and Puppeteer on Alpine
RUN apk add --no-cache libc6-compat openssl curl chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Set environment variables for Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Stage: Install dependencies
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage: Build application
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED 1
# Dummy DATABASE_URL required by prisma.config.ts during generate
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV DATABASE_URL=$DATABASE_URL
# Generate Prisma Client before build
RUN npx prisma generate
RUN npm run build

# Stage: Migration runner (lightweight — only Prisma + seed deps)
FROM node:20-alpine AS migrator
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma/seed.ts ./
# Copy generated Prisma client + engine from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
# Copy only the specific deps needed for seed (bcryptjs + its deps)
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs
# Install tsx as a global binary (minimal, no node_modules tree)
RUN npm install -g tsx
ENV NEXT_TELEMETRY_DISABLED=1

# Stage: Production runner (minimal image)
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built artifacts from builder
COPY --from=builder /app/public ./public
# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Copy uploads folder structure if needed
RUN mkdir -p uploads && chown nextjs:nodejs uploads

USER nextjs

EXPOSE 3000

ENV PORT 3000
CMD ["node", "server.js"]
