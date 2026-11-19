# GTA VI: Israel – multiplayer server
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8787
RUN npm install --no-save ws@8
COPY shared ./shared
COPY server ./server
EXPOSE 8787
USER node
CMD ["node", "--experimental-strip-types", "--no-warnings", "server/index.ts"]
