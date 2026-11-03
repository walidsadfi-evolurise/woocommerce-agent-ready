FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production NO_COLOR=1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Reports are written to /work; mount a host directory there.
RUN mkdir -p /work && chown node:node /work
USER node
WORKDIR /work
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["--help"]
