# DevCore — ARCHITECTURE_DECISIONS.md

Registro de decisões arquiteturais. Nenhuma decisão muda sem uma nova entrada que a substitua.

**Status possíveis:** `Proposta` · `Aprovada` · `Substituída`
**Regra:** só o dono do projeto (Alex) move uma decisão de `Proposta` para `Aprovada`. IA nenhuma altera status.
**Fonte das evidências:** auditoria do zip do Stitch (6 telas + DESIGN.md), proposta arquitetural original, SRS/TDD v1.0.
**Itens [verificar]:** dependem da documentação atual do Google/pgvector e de spike antes de aprovar.

---

## D1 — Origem dos cursos
- **Problema:** o Stitch mostra catálogo curado com instrutores; a arquitetura assume acervo pessoal no Drive.
- **Alternativas:** (A) catálogo da plataforma; (B) acervo pessoal do Drive; (C) híbrido.
- **Decisão:** (B). Pastas do Drive viram curso/módulo/aula, com edição manual. IA sugerindo estrutura fica para depois.
- **Justificativa:** o Alex definiu a DevCore como plataforma individual sobre o Drive próprio.
- **Consequências:** as telas de catálogo precisam ser adaptadas; instrutor passa a ser campo opcional; faltam telas de Knowledge Sources e Configurações.
- **Status:** `Aprovada` (confirmada pelo Alex na proposta original; ratificar ao fechar o TDD).

## D2 — Reprodução de vídeo
- **Problema:** o player do Stitch tem controles próprios (1.5x, PiP, qualidade) e o Drive não é CDN de vídeo.
- **Alternativas:** (a) player próprio com proxy de Range requests; (b) embed/iframe do Drive; (c) CDN externa (Mux, Bunny) com cópia do vídeo.
- **Decisão:** em aberto, depende do spike C2.
- **Consequências:** se for (b), o iframe provavelmente não expõe a posição de reprodução [verificar]. Isso derruba `positionSeconds` do tutor, clique-para-minuto nas notas e progresso por limiar.
- **Status:** `Proposta`.

## D3 — «Dúvidas da aula»
- **Problema:** a tela mostra uma aba com 12 itens; pode ser fórum público ou histórico pessoal.
- **Decisão proposta:** histórico pessoal das conversas do Copilot ancoradas na aula. Sem fórum.
- **Consequências:** reutiliza `conversations`/`messages`; nenhum módulo de moderação.
- **Status:** `Proposta`.

## D4 — Certificados, badges e avaliações
- **Problema:** o Stitch mostra certificados com «Blockchain SHA-256», badges, notas por marco e defesa com banca. Numa plataforma individual não há emissor externo.
- **Decisão proposta:** fora do MVP. Se voltar, começar com conquistas internas, sem alegação de blockchain.
- **Consequências:** tabelas `certificates`, `badges`, `assessments`, `attempts` saem da migration inicial.
- **Status:** `Proposta`.

## D5 — Escopo OAuth do Google
- **Problema:** `drive.file` pode não conceder acesso aos arquivos dentro de uma pasta selecionada no Picker [verificar]; `drive.readonly` é escopo restrito com exigências de verificação [verificar].
- **Alternativas:** `drive.file` + Picker; `drive.readonly`; sem Drive.
- **Decisão proposta:** `drive.file` + Picker, confirmado pelo spike C4. `drive.readonly` só se o spike provar que não atende.
- **Status:** `Proposta`.

## D6 — Runtime de parsing
- **Problema:** a proposta lista PyMuPDF e Docling (Python) numa stack Node/TS.
- **Alternativas:** Node puro; worker Python separado; SaaS (Unstructured.io).
- **Decisão proposta:** Node puro no MVP, medindo qualidade em 15–20 documentos reais. Worker Python só se o benchmark mostrar perda relevante (tabelas, `bbox`).
- **Consequências:** o RF08 do SRS (tabelas e coordenadas em PDF) pode não ser atendido só com Node.
- **Status:** `Proposta`.

## D7 — ORM
- **Problema:** pgvector, `tsvector` gerado e RLS exigem SQL além do que o ORM modela.
- **Decisão proposta:** Drizzle + migrations SQL revisadas à mão.
- **Status:** `Proposta`.

## D8 — Login
- **Problema:** o Stitch mostra Google, GitHub e Magic Link; a arquitetura previa só Google.
- **Decisão proposta:** só Google no MVP. O rótulo «SSH / PAT» do botão GitHub é impreciso para OAuth.
- **Status:** `Proposta`.

## D9 — Hospedagem
- **Problema:** a proposta dizia «Vercel + worker» e não dizia onde roda a API NestJS.
- **Decisão proposta:** Next.js na Vercel; API e worker em host Node persistente.
- **Status:** `Proposta`.

## D10 — Laboratório Sandbox
- **Problema:** o player referencia `interactive-sandbox` sem tela nem backend; execução de código é o maior risco de segurança e custo.
- **Decisão proposta:** adiar. Rota desabilitada.
- **Status:** `Proposta`.

## D11 — Reranking e transcrição automática (ASR)
- **Decisão proposta:** ambos opcionais, ativados por métrica (MRR/Recall) e orçamento. No MVP, transcrição só de arquivos existentes (.vtt/.srt/.txt).
- **Status:** `Proposta`.

## D12 — Métricas e selos da interface
- **Problema:** «98% de confiança», «<15 ms», «SLA 99.98%», SOC2/ISO, «blockchain» e «3.842 online» são decorativos. Score de reranker também não é confiança calibrada.
- **Decisão proposta:** remover ou rotular como demonstrativo; exibir só medições reais.
- **Status:** `Proposta`.

---

## Decisões novas surgidas da revisão do SRS

## D13 — Modelo de RLS e papéis do banco
- **Problema:** o SRS diz «todas as tabelas» com RLS, mas só 9 têm; tabelas filhas não têm `user_id`; sem `FORCE` e sem papel não-dono da tabela o RLS é ignorado; o cast de `current_setting` falha com valor vazio.
- **Decisão proposta:** `user_id` em todas as tabelas do usuário (com FK composta nas filhas), `ENABLE` + `FORCE ROW LEVEL SECURITY`, papel de aplicação sem `BYPASSRLS` e sem ser dono das tabelas, função `app_user_id()` com `NULLIF`. Workers usam o mesmo papel e definem o usuário por job. Teste automatizado obrigatório de vazamento entre usuários.
- **Consequências:** ver patch SQL (`SRS_PATCH.md`).
- **Status:** `Proposta`.

## D14 — Modelo de embeddings e dimensão
- **Problema:** o SRS fixa `VECTOR(1536)` e um modelo OpenAI antes do benchmark; a proposta original dizia para não fixar.
- **Decisão proposta:** manter `VECTOR(1536)` apenas como placeholder até a Fase 0. Escolher o modelo por benchmark com perguntas reais. Trocar de modelo = nova coluna/índice + reindexação, com `model_version` em cada vetor.
- **Status:** `Proposta`.

## D15 — Banco gerenciado (Supabase ou não)
- **Problema:** o audit v1–v3 atribuiu Supabase à proposta original, que não o previa.
- **Decisão proposta:** PostgreSQL gerenciado genérico com pgvector, auth Google própria no NestJS. Supabase só entra por decisão explícita nova, que substituiria esta.
- **Status:** `Proposta`.

## D16 — Versão ativa de chunks e filtros de recuperação
- **Problema:** durante a troca de versão, chunks antigos e novos coexistem; a busca do SRS não filtra por status nem por versão.
- **Decisão proposta:** `documents.active_parser_version`; embeddings carregam `document_id`, `is_active` e `parser_version` para a busca vetorial ficar numa tabela só; a troca é atômica numa transação.
- **Status:** `Proposta`.

## D17 — Retenção e histórico preservado
- **Problema:** `ON DELETE CASCADE` apagaria notas do aluno e histórico de citações, contra a regra RN06.
- **Decisão proposta:** notas e citações usam `ON DELETE SET NULL` com snapshots (títulos, locator, revisão). Chunks inativos são purgados fisicamente em até 30 dias (prazo a calibrar).
- **Status:** `Proposta`.

## D18 — Limiar de «não encontrei»
- **Problema:** a RN04 usa o score RRF como limiar; RRF é relativo (máx. ≈ 0,033), não mede relevância absoluta.
- **Decisão proposta:** limiar sobre similaridade de cosseno do melhor candidato vetorial ou sobre o score do reranker, calibrado no conjunto de avaliação.
- **Status:** `Proposta`.

---

## D19 — Provisionamento de login sob RLS
- **Problema:** com `FORCE ROW LEVEL SECURITY`, achar ou criar o usuário no retorno do Google acontece antes de existir contexto de usuário, e o RLS devolve zero linhas.
- **Alternativas:** papel com `BYPASSRLS` (exige superuser em muitos provedores); gerar o UUID na aplicação antes de qualquer consulta; função `SECURITY DEFINER` de um papel sem login com política própria.
- **Decisão proposta:** função `get_or_create_user`, de propriedade do papel `devcore_auth` (sem login, sem `BYPASSRLS`), com políticas `TO devcore_auth` só em `users` e `auth_identities`. Só aceita e-mail verificado.
- **Consequências:** nenhum papel da aplicação ignora o RLS. A função é a única porta de entrada sem contexto e precisa de teste próprio.
- **Status:** `Proposta`.

## D20 — Referências entre tabelas do usuário usam FK composta
- **Problema:** o PostgreSQL não aplica RLS dentro de verificações de chave estrangeira. Uma FK de uma coluna aceita o ID de um recurso de outro usuário.
- **Decisão proposta:** toda referência entre tabelas do usuário inclui `user_id` (FK composta). Onde a regra é «preservar o histórico», usa `ON DELETE SET NULL (coluna)`, que exige PostgreSQL 15 ou superior.
- **Consequências:** versão mínima do banco = 15. Todo recurso novo nasce com `user_id` e `UNIQUE (id, user_id)`.
- **Status:** `Proposta`.

## D21 — Picker do Google e token no navegador
- **Problema:** o Google Picker roda no navegador e precisa de um token OAuth lá, o que conflita com «nenhuma credencial Google no frontend».
- **Decisão proposta:** o navegador obtém um token de acesso curto, só com `drive.file`, exclusivamente para o Picker; o refresh token continua só no backend, criptografado.
- **Consequências:** o fluxo exato (e se o backend pode entregar esse token) precisa ser confirmado no spike C4 [verificar]. A regra de «sem credencial no navegador» passa a ter essa única exceção documentada.
- **Status:** `Proposta`.

---

## Resumo de status

| ID | Tema | Status |
|----|------|--------|
| D1 | Origem dos cursos | Aprovada |
| D2 | Vídeo | Proposta (depende de spike C2) |
| D3 | Dúvidas da aula | Proposta |
| D4 | Certificados/badges/avaliações | Proposta |
| D5 | Escopo OAuth | Proposta (depende de spike C4) |
| D6 | Runtime de parsing | Proposta (depende de benchmark) |
| D7 | ORM | Proposta |
| D8 | Login | Proposta |
| D9 | Hospedagem | Proposta |
| D10 | Sandbox | Proposta |
| D11 | Reranking e ASR | Proposta |
| D12 | Métricas/selos | Proposta |
| D13 | RLS e papéis | Proposta |
| D14 | Embeddings | Proposta (depende de benchmark) |
| D15 | Banco/Supabase | Proposta |
| D16 | Versão ativa de chunks | Proposta |
| D17 | Retenção | Proposta |
| D18 | Limiar «não encontrei» | Proposta |
| D19 | Provisionamento de login sob RLS | Proposta |
| D20 | FKs compostas entre tabelas do usuário | Proposta |
| D21 | Picker do Google e token no navegador | Proposta (depende de spike C4) |
