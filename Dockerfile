FROM node:22-slim

# Install dependencies for sharp & native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json ./
COPY prisma ./prisma/

# Install deps
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy source
COPY src ./src

# Build React frontend (pre-built dist copied in)
COPY frontend ./frontend

# Create volume dirs
RUN mkdir -p /data/media /data/auth

# Expose
EXPOSE 3000

# Start
CMD ["node", "src/index.js"]
