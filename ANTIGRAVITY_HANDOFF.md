# DevCore — Handoff para continuidade

## Objetivo atual

Levar o projeto até o primeiro marco **bootstrap green**:

- API compilando e iniciando;
- `GET /health` validando a conexão com PostgreSQL;
- migration aplicada;
- RLS validado com testes básicos;
- fluxo mínimo de cursos, notas e progresso exposto pela API.

## Contexto carregado

O documento principal é o SRS/TDD DevCore v1.2, em rascunho. A arquitetura proposta usa Next.js, NestJS, PostgreSQL/pgvector, Drizzle, pg-boss, Google OAuth e RLS multitenant. D1 está aprovada; D2–D21 continuam propostas.

## Situação inicial encontrada

- Não havia `node_modules` nem `package-lock.json`; a instalação npm foi tentada, mas o registry não respondeu neste ambiente e não criou esses artefatos.
- O diretório não tinha `.git` funcional.
- A migration SQL era a parte mais avançada do projeto.
- `AuthModule` não era importado no `AppModule`.
- Learning e RAG não tinham controllers.
- O worker apenas simulava a troca de versão e não iniciava pg-boss.
- O frontend tinha dados hardcoded do protótipo Stitch.
- Havia risco de vazamento de contexto RLS porque alguns `set_config` não estavam dentro de transações.
- Os testes de aceite não estavam ligados a script e o conjunto de avaliação tinha somente 5 perguntas.

## Alterações realizadas nesta etapa

- Criado `apps/api/src/common/database.module.ts` com um pool compartilhado.
- Criado endpoint `GET /health` em `apps/api/src/health/`.
- Registrado `DatabaseModule`, `HealthModule` e `AuthModule` no `AppModule`.
- Adicionado `LearningController` com endpoints para cursos, notas e progresso.
- Alterado o callback Google para receber e validar `idToken` via `googleapis`.
- Corrigido o uso do contexto RLS em transações para `getMe`, `getCourses` e progresso.
- Removidos imports não utilizados e corrigido o bootstrap do worker para não declarar a fila como pronta.
- Adicionado `vitest` e o script `test` ao pacote de database para conectar a suíte de aceite ao workspace.
- Corrigido o `tsconfig` da API para `NodeNext`, desativando `declarationMap` sem declarations.
- Corrigida a ordem do build raiz para compilar `shared` e `database` antes das aplicações.
- Corrigidos o tipo Drizzle para transações com `PoolClient`, o acesso opcional ao resultado RAG e o import de `documents` no schema Learning.
- Ajustado o middleware para não acusar parâmetro não utilizado.
- Configurada a porta publicada do DevCore como `5433`, pois `5432` já pertence ao container `sistema-credito-postgres`.
- Criado este arquivo para continuidade.

## Próximos passos obrigatórios

1. Executar `npm.cmd install` e gerar `package-lock.json`.
2. Executar `npm.cmd run build` e corrigir os erros reais de compilação.
3. Fazer o PostgreSQL funcionar via Docker/WSL ou usar um PostgreSQL local equivalente.
4. Aplicar `packages/database/migrations/0000_baseline_patch.sql`.
5. Testar `GET /health`.
6. Adicionar script de testes e instalar/configurar Vitest.
7. Implementar testes D.1.1–D.1.6 de RLS e FKs compostas.
8. Revisar a divergência entre Drizzle schema e migration SQL, principalmente `ai.ts`, `pathways.ts` e `progress.ts`.
9. Implementar o worker real com pg-boss antes de iniciar Drive/parsers/embeddings.
10. Substituir os dados hardcoded da UI por chamadas à API.

## Validação desta etapa

- `npm.cmd install`: concluído; `node_modules` e `package-lock.json` existem.
- `npm.cmd run build`: **verde** em `shared`, `database`, `api`, `worker` e `web`.
- `npm.cmd test`: **verde**, 3 testes de aceite aprovados.
- PostgreSQL/pgvector: migration executada no primeiro bootstrap e conexão do usuário `devcore_app` validada.
- O host já possuía `sistema-credito-postgres` usando a porta `5432`; o DevCore usa `5433` no host e `5432` dentro do container.
- `GET /health`: o endpoint está compilado e registrado; a validação HTTP oscilou porque o daemon Docker reiniciou os containers entre chamadas. A conexão `pg` direta funcionou quando o container estava estável.

## Comandos de validação

```powershell
npm.cmd install
npm.cmd run build
docker compose up -d
docker compose ps
npm.cmd run --workspace=@devcore/api dev
```

Endpoint inicial:

```text
GET http://localhost:4000/health
```

Resposta esperada quando API e banco estiverem disponíveis:

```json
{"status":"ok","service":"api","database":"ok"}
```

## Cuidados

- Não aceitar `googleId`, e-mail ou nome diretamente do cliente; somente claims de um ID token Google validado.
- Nunca usar `set_config('app.current_user_id', ...)` fora de uma transação com terceiro parâmetro `true`.
- Não iniciar RAG antes de haver documentos reais indexados e testes de isolamento.
- Não tratar as métricas atuais da UI como dados reais; elas ainda são mock do Stitch.
