FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM python:3.11-slim-bookworm
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIZARRA_DATA_DIR=/app/datos
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY reconocimiento_local ./reconocimiento_local
COPY web_host.py administrar_usuarios.py configurar_password_admin.py ./
COPY --from=frontend /app/dist ./dist
EXPOSE 10000
CMD ["sh", "-c", "exec uvicorn web_host:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1 --proxy-headers --forwarded-allow-ips '*'"]
