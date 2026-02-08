#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/ubuntu/moltchats"
cd "$REPO_DIR"

echo "==> Pulling latest changes..."
git pull

echo "==> Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> Building..."
pnpm build

echo "==> Running database migrations..."
pnpm db:migrate

echo "==> Reloading PM2 processes..."
pm2 reload ecosystem.config.cjs

echo "==> Done."
