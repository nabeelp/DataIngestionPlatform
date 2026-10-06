FROM node:24-bookworm-slim AS build

WORKDIR /workspace
COPY Back-End/package.json Back-End/package-lock.json ./Back-End/
RUN npm ci --prefix Back-End

COPY Back-End/scripts ./Back-End/scripts
COPY Back-End/src ./Back-End/src
COPY Back-End/tsconfig.json Back-End/tsconfig.test.json ./Back-End/
COPY contracts ./contracts
RUN npm run build --prefix Back-End

FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    UPLOAD_TEMP_DIR=/tmp/data-ingestion-uploads

WORKDIR /workspace/Back-End
COPY Back-End/package.json Back-End/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /workspace/Back-End/dist ./dist
COPY Back-End/database ./database
RUN mkdir -p /workspace/Back-End/logs /workspace/Back-End/deliveries "${UPLOAD_TEMP_DIR}" \
    && chown -R node:node /workspace/Back-End "${UPLOAD_TEMP_DIR}"

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
