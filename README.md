# Microservices Chat App

A three-service chat backend built on Node.js + Express with **RabbitMQ** as
the durable message backbone and **Redis** as the presence + caching store.
The design goal was to demonstrate the smallest self-contained microservices
system that still exercises the interesting failure modes: async pub/sub,
consumer restarts, unacked message replay, JWT-authenticated calls across
service boundaries, and per-service Prometheus metrics.

---

## Elevator pitch

> "Three Node.js services — **auth**, **chat**, and **notification** —
> communicate over HTTP for synchronous requests and over a RabbitMQ topic
> exchange for asynchronous fan-out. Each service is a separate Docker
> image with its own port and its own health/metrics endpoints. Chat
> messages are published as **persistent** AMQP messages to a **durable**
> queue with **manual ACKs**, a **dead-letter exchange** for poison pills,
> and a **retry counter** that dead-letters after N failed handler runs.
> Presence is a Redis key with a TTL that the chat service refreshes on
> heartbeats. Every service exposes latency + queue-depth metrics on
> `/metrics` in Prometheus format."

---

## Architecture

```
                              +---------------------+
                              |     Client / SPA    |
                              +----+------+---------+
                                   |      |
                        REST       |      |  REST
                     (auth flows)  |      |  (send/list messages,
                                   |      |   presence heartbeat)
                                   v      v
                        +----------+--+   +--+-----------+
                        |    Auth     |   |    Chat      |
                        |  service    |   |  service     |
                        |  :4001      |   |  :4002       |
                        +------+------+   +-----+----+---+
                               |                |    |
                       JWT verified             |    | HGET presence:*
                        by shared lib           |    v
                                                |  +-+-----+
                                                |  | Redis |
                                                |  +-+-----+
                                                |    ^
                                                |    | isOnline() lookup
                                     publish    |    |
                                (persistent,    |    |
                                 confirm ch.)   v    |
                                        +-------+-+  |
                                        |         |  |
                                        | RabbitMQ|  |
                                        | topic   |  |
                                        | exchange|  |
                                        +----+----+  |
                                             |       |
                                    routing_key      |
                                    = message.sent   |
                                             v       |
                                        +----+-------+---+
                                        |  Notification  |
                                        |  service :4003 |
                                        |  (consumer)    |
                                        +----------------+
```

- Solid arrows are synchronous HTTP.
- The arrow into RabbitMQ is a **publisher-confirmed, persistent** publish.
- The arrow out of RabbitMQ is a **prefetch-16 manual-ACK consumer** with
  a dead-letter path.

---

## Services at a glance

| Service | Port | Responsibility | Persistent state |
|---|---|---|---|
| `auth` | 4001 | Register / login / verify. Issues JWTs. | In-memory user map (portfolio demo; swap for Postgres). |
| `chat` | 4002 | Send + list messages, presence heartbeats, publishes `message.sent`. | In-memory message log per room; presence in Redis. |
| `notification` | 4003 | Consumes `message.sent`, resolves recipient presence, delivers via `realtime` or `push`. | In-memory audit log of recently delivered notifications. |
| `rabbit` | 5672/15672 | Message broker (management UI on 15672, guest/guest). | Durable topology on volume. |
| `redis` | 6379 | Presence keys + cache. | Ephemeral (TTL-driven). |

Every HTTP service also exposes:

- `GET /healthz` → liveness JSON.
- `GET /metrics` → Prometheus exposition (`http_request_duration_seconds`,
  `rabbit_queue_depth`, `chat_messages_published_total`,
  `chat_messages_consumed_total`, `notification_handle_seconds`).

---

## HTTP API surface

### Auth service

| Verb | Path | Body / Query | Auth | Purpose |
|---|---|---|---|---|
| `POST` | `/register` | `{username, password}` (password ≥ 6 chars) | — | Create user + return JWT |
| `POST` | `/login` | `{username, password}` | — | Return JWT on valid creds |
| `GET` | `/verify` | — | Bearer JWT | Introspect the caller's token |
| `GET` | `/users/:id` | — | Bearer JWT | Look up a user by id |

### Chat service

| Verb | Path | Body / Query | Auth | Purpose |
|---|---|---|---|---|
| `POST` | `/rooms/:roomId/messages` | `{body}` (≤ 4096 chars) | Bearer JWT | Store + publish a message |
| `GET` | `/rooms/:roomId/messages` | `?limit=50&before=<iso>` | Bearer JWT | Paginated history |
| `POST` | `/presence/heartbeat` | — | Bearer JWT | Refresh presence TTL for the caller |
| `GET` | `/presence?userIds=a,b,c` | — | Bearer JWT | Batch online-status lookup |

### Notification service

| Verb | Path | Body / Query | Auth | Purpose |
|---|---|---|---|---|
| `GET` | `/notifications/recent` | — | — | Last 50 delivered notifications (audit / demo) |

---

## Message-queue topology

The queue design is the interesting part of this project — it is what
prevents notification-service crashes from dropping in-flight chat messages.

```
                        exchange
                    ---------------
                     chat.events
                     (topic, durable)
                          |
        routing_key: message.sent
                          |
                          v
                    +---------------+
                    | notifications.q|
                    |  durable       |    "if any consumer is down or
                    |  DLX -> chat.  |     restarting, messages sit here
                    |  events.dlx    |     and are re-delivered on reconnect"
                    +--------+------+
                             |
                        (handler fails 5 times)
                             |
                             v
                    +---------------+
                    | chat.events   |
                    |    .dlx       |  ------> notifications.dead.q
                    | (topic,       |          (operator inspection)
                    |  durable)     |
                    +---------------+
```

### Guarantees this gives us

| Failure mode | What happens |
|---|---|
| Notification service crashes mid-message | `channel.ack` was never called → RabbitMQ re-queues to another consumer or replays on reconnect. Message is not lost. |
| Notification service goes down completely | Messages accumulate in the durable queue with `x-message-ttl` = ∞ by default. `rabbit_queue_depth` gauge reflects backlog; on restart, messages replay. |
| Handler throws on one specific message | Message is `nack`ed with `requeue=true` and an attempt counter in the headers; after 5 tries, `reject(requeue=false)` sends it to the DLX for operator inspection. |
| Publisher (chat) can't reach rabbit | `channel.publish` uses **publisher confirms**; the HTTP `POST /messages` returns 502 rather than pretending success. Client sees the failure and can retry. |
| Rabbit itself restarts | Exchange, queues, and DLX are all `durable: true`; messages published with `persistent: true` survive broker restart. |

### Why every hop is idempotent-safe

- The publisher uses a `messageId` = the app-level message UUID, letting
  the consumer detect duplicate deliveries if we later add a dedup store.
- The consumer uses **manual ACKs** and only ACKs *after* the handler
  returns. A crash between "handler returned" and "ACK sent" causes a
  duplicate delivery; the notification handler is written to be safe under
  duplicates (append to a log, not increment a counter).

---

## Data flow: sending a chat message

```
   Client                Chat svc           Rabbit             Notification svc
     |                      |                  |                       |
     |  POST /rooms/r1/msg  |                  |                       |
     |  { body: "hi" }      |                  |                       |
     |--------------------->|                  |                       |
     |          (JWT verified via shared lib)  |                       |
     |                      | append to store  |                       |
     |                      |----------------->|                       |
     |                      |  publish (persistent, confirm)           |
     |                      |----------------->|                       |
     |                      |    <---- confirm |                       |
     |     201 + message    |                  |  deliver              |
     |<---------------------|                  |---------------------->|
     |                      |                  |                       | handle()
     |                      |                  |                       |  -- redis presence lookup
     |                      |                  |                       |  -- pick channel
     |                      |                  |                       |  -- append audit log
     |                      |                  |    ACK                |
     |                      |                  |<----------------------|
```

If the notification service is down when the message is published, the
**client still gets 201** — the persistence guarantee lives at the broker,
not at the delivery. The message will fan out when notification-svc comes
back.

---

## Repository layout

```
prior-projects/07-microservices-chat/
+- package.json                # workspace root
+- docker-compose.yml
+- .gitignore
+- README.md                   # this file
+- shared/                     # @chat/shared — imported by all 3 services
|  +- package.json
|  +- src/
|     +- index.js
|     +- logger.js             # pino JSON logger factory
|     +- rabbit.js             # connect + assertTopology + publisher + consumer
|     +- redis.js              # ioredis client + presence + cache helpers
|     +- auth.js               # scrypt password hash + JWT sign/verify + middleware
|     +- metrics.js            # prom-client registry factory
|     +- config.js             # env-var typed config
+- services/
|  +- auth/
|  |  +- package.json
|  |  +- Dockerfile
|  |  +- src/{index.js, app.js, users.js}
|  +- chat/
|  |  +- package.json
|  |  +- Dockerfile
|  |  +- src/{index.js, app.js, messages.js}
|  +- notification/
|     +- package.json
|     +- Dockerfile
|     +- src/{index.js, app.js, handler.js}
+- tests/
   +- shared.test.js           # scrypt + JWT roundtrips
   +- auth.test.js             # register/login/verify HTTP flows
   +- chat.test.js             # publish path, oversize/unauth failure modes
   +- notification.test.js     # handler behavior + presence routing
```

---

## Running locally

### With Docker (recommended)

```bash
cd prior-projects/07-microservices-chat
docker compose up --build
```

That brings up **RabbitMQ**, **Redis**, and the three services. The
RabbitMQ management UI is at http://localhost:15672 (guest / guest) — you
can watch `notifications.q` fill up if you stop the notification container
while sending messages, and watch it drain when you restart it.

### Without Docker (dev loop)

Install workspace deps once:

```bash
npm install
```

Then run each service in its own shell:

```bash
npm run start:auth
npm run start:chat
npm run start:notif
```

You still need Rabbit + Redis running locally on the default ports.

### Try the full flow

```bash
# 1. Register (auth service on :4001)
curl -s -X POST http://localhost:4001/register \
  -H 'content-type: application/json' \
  -d '{"username":"alice","password":"hunter2"}' | tee /tmp/reg.json

TOKEN=$(jq -r .token /tmp/reg.json)

# 2. Send a message (chat service on :4002)
curl -s -X POST http://localhost:4002/rooms/general/messages \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"body":"hello world"}'

# 3. See it get delivered (notification service on :4003)
curl -s http://localhost:4003/notifications/recent | jq
```

### The failure-mode demo (the interesting one)

```bash
# 1. Kill notification-svc while chat is running.
docker compose stop notification

# 2. Send 100 messages. All 201s — rabbit is still up.
for i in $(seq 1 100); do
  curl -s -X POST http://localhost:4002/rooms/general/messages \
    -H "authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"body\":\"msg $i\"}" > /dev/null
done

# 3. Watch notifications.q at http://localhost:15672 — depth should be ~100.

# 4. Bring notification-svc back.
docker compose start notification

# 5. Queue drains; /notifications/recent shows all 100.
```

---

## Testing

```bash
npm test
```

Uses Node's built-in `node --test` runner. **13 tests, all passing**,
covering:

| File | Coverage |
|---|---|
| `tests/shared.test.js` | scrypt password roundtrip, salt uniqueness, JWT sign/verify, JWT-wrong-secret rejection |
| `tests/auth.test.js` | register / login / verify HTTP flow, duplicate-username 409, weak-password 400 |
| `tests/chat.test.js` | authenticated send publishes to (fake) exchange, missing bearer → 401, oversized body → 400, publisher failure → 502 |
| `tests/notification.test.js` | handler happy path, malformed-message rejection (so rabbit retries), presence-based channel selection |

The Rabbit / Redis paths are covered by dependency-injecting a **fake
publisher** and a **fake presence module** so the fast tests don't need a
running broker.

---

## Observability

Every service exposes Prometheus metrics on `/metrics`:

| Metric | Type | Labels | What it tells you |
|---|---|---|---|
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Per-endpoint p50/p95/p99 latency. Spot the auth → chat handshake if it becomes the bottleneck. |
| `chat_messages_published_total` | Counter | `routing_key` | Throughput of the publish path in chat-svc. |
| `chat_messages_consumed_total` | Counter | `queue`, `outcome` | Consumer throughput split by ACK / NACK / dead-letter. |
| `notification_handle_seconds` | Histogram | — | Handler latency inside notification-svc. |
| `rabbit_queue_depth` | Gauge | `queue` | Backlog per queue — the "am I falling behind?" signal. |

Point Prometheus at all three `/metrics` endpoints and you can graph
end-to-end message latency (`publish → consume`) alongside queue depth.

---

## Design decisions

| Question | Choice | Why |
|---|---|---|
| Sync or async between services? | Auth → chat is **sync HTTP** (JWT verify is fast, has to fail fast). Chat → notification is **async pub/sub** (a notification-svc outage should not block a user's send). | Two different tolerances for latency + failure. |
| Persistent messages? | **Yes**, `persistent: true` + `durable: true` queue. | Broker restart must not lose in-flight chat. |
| Manual ACK or auto-ACK? | **Manual**, ACK after handler returns. | Auto-ACK loses the message if the consumer crashes mid-handle. |
| Dead-letter path? | **Yes**, after 5 handler failures. | Poison pills should be quarantined, not retried forever. |
| Publisher confirms? | **Yes**, `createConfirmChannel`. | The HTTP 201 to the client is a lie unless the broker acknowledged the publish. |
| Where does presence live? | **Redis key with TTL**, refreshed on client heartbeat. | Presence is small, ephemeral, and read from two services — perfect fit for a cache with TTL. |
| Password hashing? | **scrypt** (Node core `crypto`). | No native bcrypt dep, still memory-hard. Salt is per-user, timing-safe compare on verify. |
| Auth transport between services? | **Bearer JWT**, verified with the shared secret. | Zero-DB verification in the chat/notif services. |
| Store choice? | **In-memory** maps for users and messages. | Portfolio scope; the store class is a single-purpose object so swapping in Postgres is a 50-line change. |
| Test framework? | Node core `node:test`. | Zero extra runtime deps; keeps `node_modules` small. |
| Metrics format? | **Prometheus exposition** via `prom-client`. | Boring, standard, works with any dashboard. |

---





---

## Status

| Milestone | State |
|---|---|
| Three services + shared lib | Done |
| Docker + docker-compose full stack | Done |
| JWT auth across services | Done |
| RabbitMQ topic exchange + DLX + manual ACK + retry counter | Done |
| Redis presence + batch lookup | Done |
| Prometheus `/metrics` on every service | Done |
| Test suite (13 tests, `node --test`) | Done |
| CI (GitHub Actions) | Not yet wired |
| Grafana dashboard JSON | Not yet |
| WebSocket push (currently synthesized as `channel: realtime`) | Not yet |
| Postgres-backed user + message stores | Not yet (in-memory for demo) |
