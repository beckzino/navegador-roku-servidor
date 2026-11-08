FROM ghcr.io/puppeteer/puppeteer:22.15.0
WORKDIR /home/pptruser/app
COPY --chown=pptruser:pptruser package.json ./
RUN npm install --omit=dev
COPY --chown=pptruser:pptruser . .
ENV NODE_ENV=production
CMD ["node", "server.js"]
