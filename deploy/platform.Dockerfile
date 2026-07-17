FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY contracts/package.json contracts/
COPY engine/package.json engine/
COPY platform/package.json platform/
RUN pnpm install --frozen-lockfile
COPY contracts contracts
COPY engine engine
COPY platform platform
RUN pnpm --filter @lusora/platform run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/platform/.next/standalone ./
COPY --from=build /app/platform/.next/static ./platform/.next/static
COPY contracts /app/contracts
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "platform/server.js"]
