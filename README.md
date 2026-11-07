# Dialstack — AI Lead Generation & Automated Calling Agent

A multi-tenant SaaS where a business trains an AI sales agent on its own knowledge. The agent discovers and scores leads, then calls approved prospects. It discloses that it's an AI, answers questions from the knowledge base, handles objections, books meetings and honours opt-outs. Every call is recorded, transcribed, summarised and tracked in a CRM with analytics.

**Stack:** React 18 + TypeScript + Tailwind + Zustand + Recharts · Node 22 + Express 5 + TypeScript · MongoDB (Mongoose) · JWT + RBAC · Mongo-backed job queue · pluggable AI, telephony, lead-data, email and calendar providers.

---

## 1. Run the demo (one command)

Requires **Node.js 20+** (22 recommended).

```bash
npm install
npm run demo
```

Open **http://localhost:4000** and sign in with **`demo@dialstack.dev` / `Demo1234!`**.

`npm run demo` builds the UI, starts an embedded MongoDB (downloaded automatically on first run, ~100 MB) and seeds a workspace called "GlowDesk" (salon booking software selling to the US and UK). The seed includes business settings, a knowledge base, 2 AI agents, about 60 salon leads plus a few NGO leads, and two campaigns with two weeks of simulated calls, transcripts, summaries and appointments. Data is lost on restart unless you set `MONGO_URI`.

The demo company is **GlowDesk**, a salon-software business calling salons in the **US (+1)** and **UK (+44)**.

Things to try:
- **Today:** callbacks due, upcoming meetings, leads to approve, "follow up later", and what prospects told us.
- **AI Agents:** pick a natural voice (Sarah, Lily…), preview it, or clone your own. Then use **Test call**: try "Wait, are you a real person?", "How much is it?", "Not now, maybe in two months", "Call me tomorrow at 4pm" or "Don't call again". Turn on the speaker icon to hear the replies.
- **Leads:** tabs for *Meetings · Call back · Interested · Follow up later · Busy/no answer · Not interested · Do not call*, with every next step shown in the prospect's local time. Download any view as a PDF.
- **Campaigns → New campaign:** e.g. "hair salons" in "Austin, TX" + 🇺🇸 USA, researched daily until an end date.
- **Calls & Recordings:** open an answered call and press Play. The two-lane timeline and the transcript stay in sync.
- **Lead Generation:** pick Sandbox, then Start discovery, then Review leads. Select leads, approve them, and add them to a campaign.
- **Knowledge Base:** upload a PDF, DOCX or TXT, or import a website, then ask it questions.

## What's new in v2

- **Sounds like a real salesperson, stays honest.** Each agent has a senior account-executive persona and a natural, casual speaking style with varied phrasing, short turns and confident closes. Calls open with one casual line saying it's an AI assistant (required for AI-voice calls in the US after the FCC's Feb 2024 ruling, and in some states). If a prospect asks, the agent always confirms it's an AI and never claims to be human.
- **Natural voices and voice cloning (ElevenLabs).** There's a curated set of male and female US and UK voices with in-app previews. You can also record or upload 1–3 minutes of your own voice, with a consent checkbox, to clone it. On Twilio calls the audio plays via `<Play>`; on Vapi the voice is passed as an `11labs` voice. Without a key, previews use the browser's voice and calls use the carrier's neural voices.
- **Local caller ID per country.** Add a +1 number for the US and Canada, +44 for the UK, and so on (Settings → Calling & compliance). Each prospect is dialled from the number for their country, and countries without a number are never dialled on real calls.
- **The prospect's local time everywhere.** Calling windows, legal hours (US TCPA, UK, Canada, Australia, India TRAI) and meeting times use the prospect's time zone. US, Canadian and Australian states are mapped to the right zones.
- **Campaign auto-research.** A campaign can search for new prospects daily, weekly or monthly (e.g. salons in Texas). It auto-approves leads above a fit score, adds them to the call queue, and stops on the end date.
- **What each prospect wants.** Every lead has an outcome: Meeting · Call back (at their time) · Interested · Follow up later (e.g. "in two months") · Busy · No answer · Not interested (closed, never called again) · Do not call. Callbacks and "later" follow-ups are dialled automatically when they're due.
- **PDF reports.** Analytics, leads (any outcome filter), follow-up schedule, each campaign, and each call with its transcript.
- **Redesigned UI.** A "Today" view, outcome tabs, a 4-step campaign wizard, an agent profile and voice studio, and grouped navigation.

> **Before calling the US/UK for real:** cold calls with an AI or artificial voice to US *mobile* numbers generally need prior express written consent (TCPA). Scrub your lists against the US National DNC registry and the UK TPS/CTPS, and import them on the Do-Not-Call page. Business landlines are lower risk, but state laws vary. Get local legal advice before scaling.

## What's new in v5: a sales agent trained on how top reps sell

The voice agent now follows a playbook built from published cold-call research (Gong's analysis of millions of calls) and proven methods (problem-centred pitching, Voss-style labelling, "sell the test drive"):

1. **Opener:** a one-line AI disclosure, then the *reason for the call* and a request for 30 seconds. It never asks "is this a bad time?".
2. **Problem menu:** "Most nonprofits I talk to are dealing with one of three things — …". The customer picks.
3. **Label and quantify:** "Sounds like the website is the real headache. Roughly how many donors reach out through it in a week?" Then it says their number back.
4. **Pitch one fix:** the single product that solves *their* problem, plus a real result taken from your business description (never invented).
5. **Easy close:** a free 15-minute Google Meet, offered as "Tomorrow or Wednesday?"
6. **Objections:** it agrees, asks a question, then offers a low-pressure next step. It handles "not interested", "is this a sales call?", "how did you get my number?", "send me an email", "we already use X" (no competitor bashing; it asks what they'd change), "too expensive", "need to ask my partner" and "too small". After a second no it stops, thanks them and leaves the door open.

**No settings to fill in.** The agent works out the pitch for every campaign from the campaign's **category** (salons, NGOs, dentists, restaurants, law firms, gyms, schools, hotels, trades and ~20 more, plus any other name) and **what your business sells** (booking, websites, marketing, CRM, accounting, IT, staffing, fundraising…). With an `OPENAI_API_KEY` it also tailors the pitch to each campaign once (`campaign.salesProfile`). Each campaign page shows "How Sarah pitches nonprofits", and the agent test call can practise as any campaign.

**Sales coaching:** every call gets a scorecard (A–D, out of 100) graded like a sales manager would: disclosure, reason for call, discovery, pain found, impact quantified, tailored pitch, objection handling and next step, with a coaching tip for anything missed. It's shown on the call page and in the Calls list. See `server/src/services/calls/scorecard.ts`.

Tested against 17 scripted tough customers (`server/tests/unit/sales-scenarios.test.ts`, run with `PRINT=1` to read the conversations), and the simulator now includes skeptics, competitor users, "send me an email", price shoppers and happy-with-current-setup prospects.

## What's new in v4

- **Pick where to call from lists**: in a new campaign choose a country, then a state/region, then tap cities (or "All of Texas"). Any other city can be typed. Served from `GET /api/lead-generation/geo` (`server/src/lib/geo.ts`).
- **Finding new prospects is the default**: the wizard is now 3 steps (Who to call → How to call → Review & launch). Adding existing leads is an optional section on the last step.
- **Existing leads grouped by category**: e.g. Salons, NGO. Inside each category, group by result (not contacted yet, interested, call back, later, busy/no answer, meeting booked, not interested) or by the campaign that contacted them. Each category and group has a select-all checkbox. Endpoint: `GET /api/leads/picker`. Do-not-call leads and leads queued in a running campaign are never shown.
- Fix: multi-control form fields no longer sit inside a `<label>`, which made clicks toggle the wrong country chip.
- Fix: simulated prospects now get an even mix of personalities in every demo.

## What's new in v3

- **Smarter conversations.** The agent tracks what it just asked. So "Thursday at 11am works" books the meeting, "Tomorrow" on its own makes it ask *what time*, and "No thanks" after "anything else?" ends warmly with the meeting kept. It links the prospect's own words to the specific product that fixes their problem, and "I'd like to talk to the owner" books a Google Meet with the founder. For truly free-form understanding, add `OPENAI_API_KEY`.
- **Google Calendar and Meet.** Calendar → *Connect Google Calendar* (per business, via Google sign-in). Booked meetings are created on your calendar with a Google Meet link and an invite to the prospect. The Calendar page shows them next to your existing events, with who each meeting is with and a meeting brief.
- **Meeting brief.** After every conversation the lead gets a brief: summary, pain points, what the AI offered, quotes, objections and talking points. Open it from the Leads list, the campaign detail or the Calendar.
- **Categories and priority by need.** Campaigns and leads have a category (e.g. Salons, Dentists). Settings → *Lead priorities* defines P1, P2 and P3. Templates include *Website development* (no site → P1, basic site → P2, good site that needs maintenance → P3) and *Booking software*. Each lead's website is checked automatically for whether it exists, mobile-friendliness, HTTPS, freshness, online booking and contact form.
- **Campaign wizard.** Nothing is pre-filled. A category is required. The lead picker shows only that category's leads that are still available: not closed, not booked, not already in another running campaign. Closing a half-filled form asks before discarding, and a focus bug that sent typing to the close button is fixed.
- **Clear campaign results.** Each campaign shows a stacked bar of outcomes (meetings, callbacks, interested, later, not interested…) and a meetings count, with outcome filters in the campaign detail.
- **CSV import example.** There's a sample table and a downloadable `lead-import-sample.csv` (an optional `category` column per row).

### Google Calendar setup (one time, about 10 minutes)
1. In Google Cloud Console, create a project, enable the **Google Calendar API**, and configure the OAuth consent screen (add yourself as a test user).
2. Create credentials → **OAuth client ID** → *Web application*. Under *Authorized redirect URIs* add `PUBLIC_BASE_URL/api/integrations/google/callback` (e.g. `http://localhost:4000/api/integrations/google/callback`).
3. Put the ID and secret in `server/.env` as `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`, restart, then open **Calendar → Connect Google Calendar**.

## 2. Development

```bash
cp server/.env.example server/.env   # optional; empty MONGO_URI = embedded DB
npm install
npm run dev          # API on :4000 (tsx watch) + Vite UI on :5173 (proxies /api)
npm run seed         # seed the demo workspace into MONGO_URI
```

## 3. Going live (real AI, calls and data)

| Capability | Without keys (default) | With keys |
|---|---|---|
| Conversation / reasoning | Deterministic rule-based dialogue manager | `OPENAI_API_KEY` → OpenAI-compatible LLM (JSON-mode turns, call analysis, keyword expansion) |
| Embeddings / RAG | Local hashed n-gram embeddings | `text-embedding-3-small` |
| Telephony + STT/TTS | `simulator`: synthetic prospects, no real calls | `TELEPHONY_PROVIDER=twilio` (Gather speech STT + Polly/Google TTS, recording, AMD, transfer) or `vapi` (streaming voice AI with tool calls) |
| Lead discovery | Sandbox (fictional companies, reserved 555 numbers) | `GOOGLE_PLACES_API_KEY` (business directory), `APOLLO_API_KEY` (decision-makers), CSV import |
| Natural voices / cloning | Browser preview + carrier neural voices | `ELEVENLABS_API_KEY` |
| Email | Console log | `SMTP_*` |
| Calendar | `.ics` invite by email | Google Calendar via OAuth refresh token |

**Webhooks:** set `PUBLIC_BASE_URL` to a public HTTPS URL (for local work, use a tunnel such as ngrok).
- Twilio: `/api/webhooks/twilio/{voice|gather|status|recording}/:callId`. These are configured automatically on each call and every request is signature-validated.
- Vapi: `/api/webhooks/vapi`. Set `VAPI_WEBHOOK_SECRET`.

Sandbox leads can only be dialled with the simulator, never with a real carrier.

## 4. Architecture

```
client/ (React SPA)  ──REST/JSON──►  server/ Express API ──► MongoDB
                                      │  routes → services → providers (swappable)
                                      ├─ queue/ Mongo job queue (atomic claim, retries, backoff, stale-lock recovery)
                                      ├─ campaign scheduler (windows, daily limits, concurrency, per-campaign lease)
                                      └─ webhooks ◄── Twilio / Vapi
```

- `server/src/services/agent/engine.ts`: the conversation engine shared by live calls, the simulator and the test chat. Compliance guards (AI disclosure, opt-out, human transfer) are deterministic and run before the LLM.
- `services/knowledge/*`: extraction (PDF, DOCX, TXT, MD, CSV, website crawl that respects robots.txt and blocks SSRF), chunking, embeddings, hybrid vector + lexical retrieval and grounded answers.
- `services/leads/*`: normalisation (E.164 phones, domains), de-duplication (phone/email blind index, domain, company key) and an explainable 0–100 fit score (industry 25, need 20, contactability 20, location 15, role 15, size 5).
- `services/calls/*`: compliance gate, call lifecycle, retries, recordings, post-call analysis (summary, sentiment, intent, next action) and appointments.
- Scale-out: run the API with `RUN_WORKERS=false` and any number of `node dist/worker.js` processes.

## 5. Security & compliance

- JWT auth. Membership is re-checked on every request, so revoked users lose access immediately. Accounts lock for 15 minutes after 5 failed logins. bcrypt cost 12.
- RBAC roles: owner, admin, manager, agent, viewer. The permission matrix is in `middleware/rbac.ts` and on the Team page.
- **Tenant isolation:** a Mongoose plugin rejects any query or aggregate on a tenant model that doesn't filter by `businessId`. Tests cover this.
- PII (lead phone and email, call numbers, recording URLs) is encrypted with AES-256-GCM, with HMAC blind indexes for search and de-duplication.
- Recordings are streamed through short-lived signed URLs tied to the call and the user's role, with Range support. Downloads need a separate permission. Plays and downloads are audit-logged.
- Helmet, CORS, rate limits (global and auth), zod validation, NoSQL-operator stripping, upload type and size limits, audit log.
- Every call opens with an AI disclosure and a recording notice. Recording can start only after consent (Twilio). Opt-outs are detected deterministically and in post-call analysis; they go onto the Do-Not-Call list and are never dialled again (customer opt-outs can't be removed). Manual and registry DNC import is supported.
- Calling windows: business hours ∩ campaign schedule ∩ statutory limits in the callee's timezone (India/TRAI 09:00–21:00, US/TCPA 08:00–21:00). A hard cap applies on attempts per lead per 7 days. Only approved leads can be called.

## 6. Database collections

`users, businesses, teammembers, businessknowledges, knowledgechunks, ai_agents, leads, leadsources (discovery runs), activities, reminders, campaigns, campaignleads, calls, callrecordings, calltranscripts, appointments, notifications, dncentries, auditlogs, jobs`. Every business record carries an indexed `businessId`. Schemas are in `server/src/models/index.ts`.

## 7. API reference (all under `/api`, Bearer JWT unless noted)

| Area | Endpoints |
|---|---|
| Auth (public) | `POST auth/register`, `POST auth/login`, `POST auth/accept-invite`, `GET auth/me`, `POST auth/switch`, `POST auth/change-password` |
| Business | `GET/PATCH business` |
| Team | `GET team`, `POST team/invite`, `PATCH/DELETE team/:id` |
| Knowledge | `GET knowledge`, `GET knowledge/:id`, `POST knowledge/upload` (multipart), `POST knowledge/website`, `POST knowledge/text`, `POST knowledge/:id/reindex`, `DELETE knowledge/:id`, `POST knowledge/query`, `POST knowledge/search` |
| Agents | `GET/POST agents`, `GET/PATCH/DELETE agents/:id`, `POST agents/:id/test-chat` |
| Lead generation | `GET lead-generation/providers`, `GET/POST lead-generation/runs`, `GET lead-generation/preview-query`, `POST lead-generation/import` (CSV) |
| Leads | `GET leads` (search, filters, sort, paging), `GET leads/pipeline`, `GET leads/export`, `POST leads`, `GET/PATCH leads/:id`, `POST leads/bulk` (approve, reject, status, assign, delete, rescore), `POST leads/:id/notes`, `POST leads/:id/reminders`, `PATCH leads/:id/reminders/:rid` |
| Campaigns | `GET/POST campaigns`, `GET/PATCH/DELETE campaigns/:id`, `POST campaigns/:id/{start,pause,resume,complete}`, `POST campaigns/:id/leads`, `DELETE campaigns/:id/leads/:leadId` |
| Calls | `GET calls`, `GET calls/:id`, `POST calls` (call now), `POST calls/:id/hangup`, `POST calls/:id/recording-url`, `GET calls/appointments`, `PATCH calls/appointments/:id`, `GET media/recordings/:callId?token=` |
| Reports (PDF) | `GET reports/analytics.pdf?from&to`, `GET reports/leads.pdf?outcome=…`, `GET reports/follow-ups.pdf`, `GET reports/campaigns/:id.pdf`, `GET reports/calls/:id.pdf` |
| Voice | `POST agents/:id/voice-preview`, `POST agents/:id/voice-clone` (multipart, consent required) |
| Analytics & other | `GET analytics?from&to`, `GET notifications`, `POST notifications/read`, `GET/POST compliance/dnc`, `POST compliance/dnc/import`, `DELETE compliance/dnc/:id`, `GET compliance/audit`, `GET system/status` |

## 8. Testing

```bash
npm test                 # server: 119 unit + integration tests (real MongoDB) · client: component tests
npm run test:e2e         # Playwright end-to-end; boots the demo server automatically
```

The integration suites cover: auth and lockout, RBAC, tenant isolation, PII encryption, knowledge upload/website/RAG accuracy, discovery, de-duplication and scoring, CRM flows, full simulated campaigns, retries, opt-out, calling windows, pause/resume, daily limits and concurrent schedulers (no double-dialling), Twilio and Vapi webhook flows with signature checks, recording streaming and permissions, and analytics.

## 9. Deployment

```bash
cp server/.env.example server/.env   # fill in secrets (JWT_SECRET and ENCRYPTION_KEY are required in production)
docker compose up --build            # MongoDB + API serving the built UI on :4000
```

Put it behind HTTPS (for example Nginx, Caddy or a cloud load balancer). Back up MongoDB and the `storage/` volume, which holds recordings and uploads. To store files in S3 or GCS, implement the four methods in `providers/storage`.
