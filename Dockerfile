# --- STAGE 1: BUILD ---
# Start from a standard Node.js image for building
FROM node:18-alpine AS builder

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json (or yarn.lock) first
# This allows Docker to cache the installation step if dependencies haven't changed
COPY package.json .
COPY yarn.lock .

# Install dependencies, including devDependencies
RUN yarn install --frozen-lockfile

# Copy the rest of the application files
COPY . .

# Build the Next.js application
# The output is placed in the .next folder
RUN yarn build

# --- STAGE 2: PRODUCTION RUNTIME ---
# Start from a minimal image to run the final application
# node:18-slim is a great choice for production
FROM node:18-slim AS runner

# Set the environment variable for production
ENV NODE_ENV production

# Railway typically exposes on port 3000 by default, 
# but it's good practice to set it if needed.
ENV PORT 3000
EXPOSE 3000

# Set working directory
WORKDIR /app

# Copy the minimum required files from the builder stage
# 1. The built application (.next)
# 2. node_modules (only production dependencies are needed)
# 3. public files
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Copy server configuration files, if you have any (e.g., next.config.js)
COPY next.config.js .

# Command to run the application
CMD ["yarn", "start"]