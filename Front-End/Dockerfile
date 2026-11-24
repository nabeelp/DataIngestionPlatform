FROM node:26-alpine AS build

WORKDIR /workspace/Front-End

COPY Front-End/package.json Front-End/package-lock.json ./
RUN npm ci

COPY Front-End/ ./
COPY contracts/ ../contracts
RUN npm run build

FROM nginxinc/nginx-unprivileged:alpine

COPY --from=build --chown=nginx:nginx /workspace/Front-End/dist /usr/share/nginx/html
COPY --chown=nginx:nginx Front-End/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx Front-End/docker/entrypoint.sh /docker-entrypoint.d/40-runtime-config.sh
USER root
RUN chmod 755 /docker-entrypoint.d/40-runtime-config.sh
USER nginx

EXPOSE 8080
