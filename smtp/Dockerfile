FROM node:22-alpine
WORKDIR /app
COPY mime.mjs server.mjs ./
USER node
ENV NODE_ENV=production
EXPOSE 2525
CMD ["node", "server.mjs"]
