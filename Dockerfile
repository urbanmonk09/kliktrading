# --- STAGE 1: BUILD ---
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first to leverage Docker cache
COPY package.json package-lock.json ./

# Install all dependencies including devDependencies for TypeScript
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build the Next.js application
RUN npm run build

# --- STAGE 2: PRODUCTION ---
FROM node:18-slim AS runner

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Set working directory
WORKDIR /app

# Copy production artifacts from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js

# Start the Next.js server
CMD ["npm", "start"]
