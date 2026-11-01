# Сборка сервера TWM Market. Запуск из корня репозитория:
#   docker build -f apps/api/Dockerfile -t twm-api .
FROM node:22-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --filter @twm/api... \
 && pnpm --filter @twm/api build \
 && pnpm --filter @twm/api deploy --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
