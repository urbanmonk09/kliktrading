# --- STAGE 1: BUILD ---
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy dependency definitions first (for caching)
COPY package.json package-lock.json ./

# Install all dependencies (dev + prod) for building
RUN npm ci

# Copy all source files
COPY . .

# Build Next.js application
RUN npm run build

# --- STAGE 2: PRODUCTION ---
FROM node:18-alpine AS runner

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

WORKDIR /app

# Copy build output and public folder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Install only production dependencies
RUN npm ci --omit=dev

# Copy next.config.js if exists
COPY --from=builder /app/next.config.js ./next.config.js

# Start the Next.js server
CMD ["npm", "start"]
