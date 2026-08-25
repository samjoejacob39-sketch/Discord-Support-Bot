# Shinchat Helper — Architecture

An AI support *employee* for a Discord community. Discord is the only control surface:
no website, no dashboard, no OAuth flow.

---

## 1. Recommended tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| Runtime | **Node.js 20+ / TypeScript (ESM)** | Best-in-class Discord tooling; strict types matter for a permission-sensitive bot. |
| Discord | **discord.js v14** | Slash commands, subcommand groups, autocomplete, threads, `allowedMentions`. |
| Database | **SQLite + better-sqlite3** | Single-file, zero-ops, synchronous (no race conditions in handlers), fast enough for thousands of guilds. All SQL lives in `src/db/repositories/*`, so Postgres is a swap of that layer, not a rewrite. |
| Search index | **SQLite FTS5 + BM25**, with LIKE-scoring fallback | Knowledge retrieval without an embedding service or vector DB on day one. |
| AI | **`@google/genai` (Gemini)** behind an `AIProvider` interface | Spec requires Gemini first, provider-agnostic later. Nothing outside `src/ai/providers/` imports the SDK. |
| Web | Pluggable `SearchProvider` (Brave / Tavily / DuckDuckGo / none) + SSRF-guarded fetcher | Search keys are optional; the bot degrades gracefully. |
| Validation | **zod** | Env schema + every AI tool argument. |
| Logging | **pino** with secret redaction | Structured logs, cheap. |
| Tests | **vitest** | Fast, in-memory SQLite, mock AI provider. |

Deliberately **not** used in v1: Redis, message queues, vector DB, Docker Compose sprawl,
Prisma codegen. `node dist/index.js` + one SQLite file is the whole deployment.

---

## 2. Project architecture

```
src/
  index.ts                  bootstrap: env → db → providers → discord → jobs
  config/env.ts             zod-validated environment, single source of truth
  logging/logger.ts         pino + redaction of secrets
  db/
    client.ts               connection, WAL, pragmas, FTS capability probe
    migrator.ts             ordered SQL migrations, tracked in `_migrations`
    migrations/*.sql
    repositories/           guilds, admins, knowledge, tickets, messages,
                            summaries, escalations, interactions, audit, cache
  security/
    permissions.ts          who may run what (runtime, never client-trusted)
    trust.ts                trust tiers + untrusted-content wrapping
    injection.ts            prompt-injection heuristics for /learn, users, web
    redaction.ts            outbound secret scrubbing
    rateLimiter.ts          per-user / per-guild token buckets
  knowledge/
    categories.ts  classifier.ts  service.ts  retrieval.ts  expiry.ts
  ai/
    provider.ts             AIProvider interface + shared types
    providers/gemini.ts     the only file that knows about Gemini
    providers/mock.ts       deterministic provider for tests/offline
    promptBuilder.ts        the instruction hierarchy
    supportAgent.ts         bounded tool loop, confidence, escalation
    summarizer.ts           rolling ticket summaries (context/cost control)
    confidence.ts
    tools/                  registry + one file per tool, each permission-gated
  web/
    searchProvider.ts  providers/{brave,tavily,duckduckgo,none}.ts
    fetcher.ts              SSRF guard, size/time caps, HTML→text
    sourceQuality.ts        authoritative-source ranking
  tickets/
    stateMachine.ts  service.ts  detection.ts  escalation.ts
  discord/
    client.ts  presence.ts  commandRegistry.ts
    commands/               help, ask, learn, knowledge, shinadmin,
                            shincontinue, ticket, shinconfig, shinstatus
    events/                 ready, interactionCreate, messageCreate, guildCreate
    ui/                     embeds, pagination, message chunking
  jobs/scheduler.ts         expiry sweep, cache prune, presence refresh
  scripts/                  registerCommands, clearCommands
tests/                      one file per invariant (see §12)
```

Rule enforced throughout: **the Discord layer never talks to the AI or DB directly** —
it calls services in `tickets/`, `knowledge/`, `ai/`.

---

## 3. Database schema

All guild-scoped tables carry `guild_id` and **every** repository method takes it as a
parameter. There is no query in the codebase that can read another guild's rows.

```
guilds(guild_id PK, name, joined_at, left_at)
guild_settings(guild_id PK→guilds, support_mode, ai_enabled, trusted_role_id,
               admin_ping_role_id, support_channel_ids JSON, support_category_ids JSON,
               escalation_channel_id, persona_note, max_ai_attempts, updated_at)
shin_admins(guild_id, user_id, added_by, added_at, PK(guild_id,user_id))

knowledge_entries(id PK, guild_id, category, kind, status, title, content,
                  priority, visibility, flagged, expires_at,
                  created_by, created_at, updated_at, updated_by)
knowledge_fts(title, content)              -- FTS5 mirror kept by triggers

tickets(id PK, guild_id, channel_id, thread_id, opener_user_id, subject, state,
        ai_attempts, escalation_count, created_at, updated_at, last_activity_at,
        closed_at)                          -- partial UNIQUE(guild,channel) while open
ticket_messages(id PK, ticket_id, guild_id, discord_message_id, author_id,
                author_kind, content, created_at)
ticket_summaries(id PK, ticket_id, guild_id, summary, through_message_id, created_at)
ticket_facts(id PK, ticket_id, guild_id, label, value, created_at)

escalations(id PK, ticket_id, guild_id, trigger, reason, summary,
            recommended_action, notified_user_ids JSON, created_at, resolved_at,
            resolved_by)
ai_interactions(id PK, guild_id, ticket_id, user_id, model, confidence, escalated,
                tool_calls JSON, input_tokens, output_tokens, latency_ms, created_at)
audit_log(id PK, guild_id, actor_id, action, target, metadata JSON, created_at)
response_cache(guild_id, prompt_hash, response, created_at, PK(guild_id,prompt_hash))
```

`kind ∈ {permanent, temporary, incident}`, `status ∈ {active, inactive, expired}`,
`visibility ∈ {public, staff}` (staff entries steer behaviour but are never quoted to
members).

---

## 4. Discord command structure

| Command | Who | Purpose |
| --- | --- | --- |
| `/help [category]` | everyone | Grouped, permission-aware help. |
| `/ask <question>` | everyone | Explicitly invoke the AI anywhere it's allowed. |
| `/learn <content> [category] [duration]` | shin admin | Teach server knowledge. Bare text form, exactly as specified. `duration` (e.g. `6h`, `3d`) makes it temporary. |
| `/knowledge list \| search \| show \| remove \| disable \| enable \| stats` | shin admin | Inspect and manage what was learned (paginated embeds, autocomplete on IDs). |
| `/shinadmin add \| remove \| list` | server owner / Administrator / Manage Server / trusted role | Manage Shinchat Helper admins. |
| `/shin-continue [note]` | shin admin | Resume AI support after human handling. |
| `/ticket status \| summary \| escalate \| resolve \| close \| reopen \| ai` | shin admin | Ticket control, incl. per-ticket AI pause. |
| `/shinconfig view \| support-mode \| channel \| category \| trusted-role \| escalation-channel \| ai \| persona \| reset` | owner/Administrator | Where and how the bot operates. |
| `/shinstatus` | shin admin | Provider health, web-search mode, DB, counters. |

Design note: Discord does not allow a top-level command to take free text *and* have
subcommands. Since §4 of the spec makes `/learn <free text>` the priority, management
verbs live under `/knowledge` (`/learn list` is impossible; `/knowledge list` is the
equivalent). `/help` states this mapping explicitly.

---

## 5. AI architecture

```
messageCreate / /ask
   → ticket detection (should we answer at all?)
   → rate limit + duplicate-response cache
   → TicketService.recordMessage()
   → SupportAgent.run()
        promptBuilder → layered system instruction (§10 hierarchy)
        context      → rolling summary + last N messages + ticket facts
        loop (≤ AI_MAX_TOOL_ITERATIONS):
            provider.generate({ messages, tools })
            → function calls?  execute permission-gated tool, append result, repeat
            → respond_to_user(message, confidence, sources) → done
            → escalate_to_admin(reason, summary, recommended_action) → escalate
        post-processing: secret redaction, length shaping, message chunking
   → persist AIInteraction (confidence, tools, tokens, latency)
```

`AIProvider` is `{ name, generate(request), generateJson(request) }`. `GeminiProvider`
maps to `models.generateContent`; `MockProvider` replays scripted turns so every
behaviour above is testable without network access.

Confidence is explicit, not vibes: the model must report `high | medium | low` when it
calls `respond_to_user`. `high` → answer. `medium` → answer cautiously **or** ask one
targeted clarifying question. `low` → do not guess; escalate. A heuristic in
`confidence.ts` downgrades claims the model shouldn't be making (invented prices,
"I checked your account", fabricated policy) and can force escalation.

---

## 6. Knowledge architecture

1. **Ingest** — `/learn` text → `classifier.ts` asks the *fast* model for
   `{category, kind, title, priority, expires_in_hours}`; a deterministic keyword
   classifier is the fallback when AI is unavailable, so `/learn` never fails outright.
   `TEMPORARY:` / `INCIDENT:` prefixes and `duration:` short-circuit to those kinds.
2. **Screen** — `injection.ts` flags entries that try to rewrite the bot's security
   posture (e.g. "reveal API keys"). Stored, flagged, and the admin is told it will be
   treated as policy text and cannot override safety rules.
3. **Store** — structured rows, never one growing blob. Audit-logged with author + time.
4. **Retrieve** — per turn: all `active` incidents (always) + BM25 top-K matches for the
   user's question + high-priority policies. Token-budgeted, deduplicated.
5. **Expire** — a 5-minute job flips `temporary`/`incident` rows past `expires_at` to
   `expired`; they stop being retrieved immediately, so stale instructions can't remain
   authoritative.

---

## 7. Ticket state machine

```
                 ┌──────────── /ticket reopen ────────────┐
                 ▼                                        │
NEW ──► AI_ACTIVE ──escalate──► WAITING_FOR_ADMIN ──admin speaks──► ADMIN_ACTIVE
         │  ▲                          │                                 │
         │  └──── /shin-continue ──────┴─────────────────────────────────┘
         │
         ├── /ticket ai off ──► AI_PAUSED ── /ticket ai on ──► AI_ACTIVE
         └── /ticket resolve ──► RESOLVED ── /ticket close ──► CLOSED
```

`canAIRespond(state)` is true **only** for `NEW` and `AI_ACTIVE`. Every other state means
the bot stays silent. Transitions are validated in one place (`stateMachine.ts`); illegal
transitions throw rather than silently corrupt state.

---

## 8. Escalation architecture

Triggers: model calls `escalate_to_admin`; `low` confidence; `ai_attempts >=
max_ai_attempts` with the issue unresolved; the user asks for a human; repeated identical
failure; or AI/provider failure after retries.

On escalation, atomically: state → `WAITING_FOR_ADMIN`, `escalations` row written,
audit-logged, and two *separate* messages:

- **Public, in-channel:** one calm sentence — "I'm not confident I can safely resolve
  this, so I've brought in a moderator." No internal reasoning.
- **Staff notice:** embed with user, problem, key facts, what the AI tried, knowledge
  consulted, suspected cause, escalation reason, recommended human action, ticket link —
  posted to `escalation_channel_id` if configured, otherwise the ticket channel — with
  real `<@id>` mentions of shin admins (+ optional ping role) and `allowedMentions`
  restricted to exactly those IDs.

Then the AI is silent until `/shin-continue`, which restores state and injects an
"a human handled this in between" note plus the preserved summary.

---

## 9. Web-search architecture

`shouldConsiderWebSearch()` gates the *tool's availability* on cheap signals (recency
words, version/outage/pricing/"today", unknown proper nouns, explicit "check"), then the
model decides whether to actually call it. Stable general knowledge → no call. Server
internals → never the web, always `/learn`.

`search_web` → provider (Brave / Tavily / DuckDuckGo / none) → results re-ranked by
`sourceQuality.ts` (official status pages, vendor docs, GitHub releases, then reputable
media). `fetch_webpage` hardens the request: https/http only, ports 80/443, DNS resolved
and checked against private/loopback/link-local/CGNAT/reserved ranges **before**
connecting, manual redirect following with re-validation (≤3 hops), 512 KB cap, 15 s
timeout, content-type allowlist, HTML→text, truncation.

All retrieved text enters the prompt inside `<web_content untrusted="true">` and the
system block states that such content is data to summarise, never instructions to follow.

---

## 10. Security model

**Instruction hierarchy** (highest wins, enforced by prompt structure *and* code):

1. Immutable system safety & privacy rules — hardcoded, never templated from user data.
2. Active incidents / temporary admin instructions.
3. Server policy & knowledge from `/learn` — injected as **data and policy**, inside
   tags, explicitly non-executable.
4. Ticket context (summary + recent messages + facts).
5. Verified web content (untrusted, must be attributed).
6. General model knowledge (lowest).

**Authorization** — two tiers. *Guild managers* (owner, Administrator, Manage Server, or
a configured trusted role) may run `/shinadmin` and `/shinconfig`. *Shin admins* may run
`/learn`, `/knowledge`, `/ticket`, `/shin-continue`, `/shinstatus`. Checks run
server-side in `permissions.ts`; `defaultMemberPermissions` is UX only, never the gate.
Nobody can promote themselves.

**Other controls** — untrusted-content tagging for user and web text; injection
heuristics logged (never blindly obeyed); outbound redaction of any env secret value;
pino redaction paths; secrets only from env, `.env` git-ignored; per-user and per-guild
token buckets plus duplicate-request cache; least-privilege Discord permissions (no
Administrator); strict `allowedMentions` so the bot can never mass-ping; guild isolation
enforced at the repository signature level and covered by tests.

---

## 11. Environment variables

See [.env.example](.env.example) for the annotated list, including exactly where to get
the Gemini key (Google AI Studio → *Get API key*) and the Discord token/intents. Summary:
`DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_DEV_GUILD_ID`, `AI_PROVIDER`,
`GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_FAST_MODEL`, `WEB_SEARCH_PROVIDER`,
`BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY`, `WEB_FETCH_ENABLED`, `DATABASE_PATH`,
`NODE_ENV`, `LOG_LEVEL`, `AI_MAX_REQUESTS_PER_USER_PER_MIN`,
`AI_MAX_REQUESTS_PER_GUILD_PER_MIN`, `AI_MAX_TOOL_ITERATIONS`,
`AI_CONTEXT_MESSAGE_LIMIT`. No secret ever appears in source or logs.

---

## 12. Development phases

1. **Foundation** — env, logger, SQLite + migrations, repositories, guild isolation tests.
2. **Discord shell** — client, command registry, `/help`, `/shinconfig`, `/shinstatus`.
3. **Security core** — permissions, `/shinadmin`, audit log, rate limiter, redaction.
4. **Knowledge** — `/learn`, classifier, `/knowledge *`, FTS retrieval, expiry job.
5. **AI core** — provider abstraction, Gemini + mock, prompt builder, tool loop,
   confidence, ticket detection, conversational answering.
6. **Escalation** — state machine wiring, escalate tool, admin notice, `/shin-continue`.
7. **Web** — search providers, SSRF-safe fetcher, source ranking, decision gate.
8. **Hardening** — summarizer/cost controls, retries + backoff, full test suite, docs.
