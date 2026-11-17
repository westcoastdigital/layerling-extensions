# The updater: checks GitHub for new versions and runs scripts/update.sh for layerling's Updates button.
FROM node:24-alpine

RUN apk add --no-cache bash git docker-cli docker-cli-compose docker-cli-buildx \
  # The repo belongs to the person on the host, not to this container's user.
  && git config --system --add safe.directory '*'

COPY server.mjs /updater/server.mjs

EXPOSE 8787
CMD ["node", "/updater/server.mjs"]
