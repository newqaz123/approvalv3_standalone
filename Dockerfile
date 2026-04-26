# Multi-stage Dockerfile for Next.js with Prisma
# Uses full build (not standalone) to avoid server action tracing issues

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

# Stage: Migration runner (Prisma CLI + client + seed deps)
FROM node:20-alpine AS migrator
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma/seed.ts ./
# Copy all node_modules but remove heavy unused ones
COPY --from=builder /app/node_modules ./node_modules
RUN rm -rf ./node_modules/puppeteer* ./node_modules/chromium* ./node_modules/.cache
# Install tsx for seed script
RUN npm install -g tsx
ENV NEXT_TELEMETRY_DISABLED=1

# Stage: Production runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED 1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
# Copy only production node_modules (exclude devDependencies)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
# Create uploads directory matching the app's actual path (public/uploads/)
RUN mkdir -p public/uploads && chown nextjs:nodejs public/uploads

USER nextjs

EXPOSE 3000

ENV PORT 3000
CMD ["npx", "next", "start"]
