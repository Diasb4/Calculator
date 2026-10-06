# Lightweight production Dockerfile for GradeMaster
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Copy dependency manifests
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev --ignore-scripts || npm install --omit=dev

# Copy all application source files
COPY . .

# Expose server port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Start server
CMD ["node", "server.js"]
