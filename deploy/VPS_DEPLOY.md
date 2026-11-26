# Deploy na VPS Hostinger (Nginx + Certbot + Subdomínio Único)

Este guia coloca o **TrendPlay / DevCore** no ar ao lado dos seus outros projetos sem conflito de portas, com PostgreSQL isolado e HTTPS automático.

---

## 1. Apontar o subdomínio no DNS
No painel DNS do seu domínio (Hostinger / Cloudflare), crie um registro **A**:
- **Tipo:** `A`
- **Nome:** `cursos` *(ou o subdomínio escolhido)*
- **Aponta para:** IP público da sua VPS Hostinger

---

## 2. Clonar o projeto e configurar `.env.prod` na VPS
Conecte via SSH na VPS e execute:

```bash
cd /var/www   # ou a pasta onde ficam seus projetos
git clone https://github.com/AlexTayron/trendPlay.git
cd trendPlay
cp .env.prod.example .env.prod
```

Gere chaves seguras para colar no `.env.prod`:

```bash
openssl rand -hex 32   # use em ENCRYPTION_MASTER_KEY
openssl rand -hex 32   # use em JWT_SECRET
openssl rand -hex 20   # use em POSTGRES_ADMIN_PASSWORD
openssl rand -hex 20   # use em DB_APP_PASSWORD
```

Edite `.env.prod` (`nano .env.prod`) e preencha:
- `APP_DOMAIN=cursos.seudominio.com`
- `POSTGRES_ADMIN_PASSWORD` e `DB_APP_PASSWORD`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_PICKER_API_KEY`
- `ENCRYPTION_MASTER_KEY` e `JWT_SECRET`
- *(Se já usar as portas `3100` ou `4100` na VPS, troque `WEB_HOST_PORT` e `API_HOST_PORT`.)*

---

## 3. Subir os containers em produção
Dê permissão de execução ao script de init do banco e suba o stack:

```bash
chmod +x deploy/init-db/01_set_app_password.sh
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Verifique se tudo subiu saudável:

```bash
docker compose -f docker-compose.prod.yml ps
curl http://127.0.0.1:4100/health
```
Esperado: `{"status":"ok","service":"api","database":"ok"}`.

---

## 4. Configurar o Nginx + Certbot (HTTPS)
Copie o template do Nginx e troque `cursos.seudominio.com` pelo seu subdomínio:

```bash
sudo cp deploy/nginx/trendplay.conf /etc/nginx/sites-available/trendplay.conf
sudo nano /etc/nginx/sites-available/trendplay.conf
```

Ative o site e gere o certificado SSL gratuito com Certbot:

```bash
sudo ln -s /etc/nginx/sites-available/trendplay.conf /etc/nginx/sites-enabled/trendplay.conf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d cursos.seudominio.com
```

---

## 5. Atualizar as URLs no Google Cloud Console
No [Google Cloud Console](https://console.cloud.google.com/) (**APIs e serviços → Credenciais**):

1. Abra o seu **ID do cliente OAuth 2.0** (`Curso auth`):
   - **Origens JavaScript autorizadas:** adicione `https://cursos.seudominio.com`
   - **URIs de redirecionamento autorizados:** adicione `https://cursos.seudominio.com/api/auth/google/callback`
2. Se restringiu a **Chave de API** (`GOOGLE_PICKER_API_KEY`) por site:
   - Adicione `https://cursos.seudominio.com/*`

*(Pode manter as URLs de `http://localhost:3000` e `http://localhost:4000/auth/google/callback` junto, assim funciona tanto local quanto na VPS!)*

---

## 6. Atualizar o projeto depois de novos commits
```bash
cd /var/www/trendPlay
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
