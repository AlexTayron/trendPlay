# DevCore — Plataforma de Aprendizagem com RAG Pessoal (Modelo B)

Sistema de aceleração técnica para engenheiros de software construído sobre acervos no **Google Drive pessoal**, com motor RAG multiescopo, busca híbrida determinística, isolamento multitenant nativo via PostgreSQL RLS e design system Obsidian.

---

## 1. Estrutura do Monorepo

```
.
├── apps/
│   ├── api/          # NestJS (Modular Monolith: RAG, Auth, Learning, Drive)
│   ├── web/          # Next.js 15 (React 19, Tailwind, Obsidian Design System)
│   └── worker/       # Background Worker persistente para Ingestion (pg-boss)
├── packages/
│   ├── database/     # Drizzle ORM + DDL SQL com RLS, HNSW, e 36 tabelas modeladas
│   └── shared/       # Tipos TypeScript, Locators canônicos (PDF, Code, Vídeo)
├── docker-compose.yml # PostgreSQL 16 com extensão pgvector
└── tsconfig.base.json
```

---

## 2. Decisões Arquiteturais e Regras de Segurança

1. **Modelo B (Drive Pessoal — D1 Aprovada):** O conteúdo do estudante advém do seu Google Drive. Pastas tornam-se cursos, subpastas viram módulos e arquivos convertem-se em aulas/documentos.
2. **Isolamento de Tenant Obrigatório (D13 Proposta):** Todas as tabelas de usuário operam sob `FORCE ROW LEVEL SECURITY`. O papel `devcore_app` **não possui `BYPASSRLS`** nem privilégios de superuser.
3. **Busca Híbrida Determinística (B.6):** Combinação de Full-Text Search (FTS em português e simple para código via `websearch_to_tsquery`) com busca vetorial cosseno (`<=>` no HNSW) via **Reciprocal Rank Fusion (RRF)**.
4. **Preservação de Histórico (D17 Proposta):** A exclusão de aulas ou documentos nunca remove notas do estudante nem o histórico de citações em conversas com o Copilot (`ON DELETE SET NULL` acompanhado de snapshots).
5. **Troca Atômica de Versão de Chunks (D16 Proposta):** O processamento de um novo arquivo ocorre em versão separada (`parser_version`). Apenas ao final da indexação, a transação ativa a nova versão em `document_embeddings.is_active` e `documents.active_parser_version`.

---

## 3. Inicialização do Ambiente Local

### 3.0 Verificação inicial

Antes de iniciar as aplicações, confirme que o ambiente está verde:

```bash
npm install
npm run build
```

Com a API e o PostgreSQL ativos, o endpoint abaixo deve retornar `status: ok` e `database: ok`:

```text
GET http://localhost:4000/health
```

### 3.1 Subir o Banco de Dados com pgvector
```bash
docker compose up -d
```

### 3.2 Executar a Migração de Baseline
A migração inicial `packages/database/migrations/0000_baseline_patch.sql` provisiona todas as 36 tabelas, funções estáveis de contexto (`app_user_id()`), papéis de segurança e índices otimizados:
```bash
# Executado automaticamente pelo docker-compose na primeira subida
# ou manualmente via psql:
psql -h localhost -p 5433 -U devcore_admin -d devcore -f packages/database/migrations/0000_baseline_patch.sql
```

### 3.3 Executar as Aplicações em Desenvolvimento
```bash
# Instalar dependências
npm install

# Subir API NestJS (porta 4000)
npm run --workspace=@devcore/api dev

# Subir Worker pg-boss
npm run --workspace=@devcore/worker dev

# Subir Frontend Next.js (porta 3000)
npm run --workspace=@devcore/web dev
```

