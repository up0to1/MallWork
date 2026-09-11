# MallWork Local Compose Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run MallWork from its local source directory with the repository's complete Docker Compose stack, preserve configuration and data, and verify health plus one real browser shopping flow.

**Architecture:** Source stays in `H:\Desktop\WorkPlace\Project\Cross_Big_Project\MallWork`; Docker Desktop runs the Linux containers for React/Nginx, FastAPI, worker, Redis, and Qdrant. SQLite, Redis, and Qdrant data remain in named Docker volumes, while the Ubuntu VM and its middleware remain outside this deployment.

**Tech Stack:** Docker Desktop, Docker Compose v2, Python 3.11 container with uv lockfile, Node.js 22 container with npm lockfile, FastAPI, React/Vite/Nginx, Redis 7, Qdrant 1.19.0, SQLite.

**Spec:** `docs/superpowers/specs/2026-09-11-mallwork-local-compose-deployment-design.md`

## Global Constraints

- Use the exact project directory `H:\Desktop\WorkPlace\Project\Cross_Big_Project\MallWork`; leave the existing `Mall work` directory untouched.
- Do not overwrite an existing `.env`, delete `data/`, remove databases, or run `docker compose down -v`.
- Keep existing internal `globex` package, database, API, collection, and volume identifiers during first deployment.
- Use host ports 5173 for the page, 8000 for the API, 6333 for Qdrant, and 6379 for Redis; do not silently choose alternate ports.
- Do not print secret values. Report only whether required configuration fields are present and non-placeholder.
- Do not connect this deployment to the Ubuntu VM at `192.168.59.128` or its MySQL, Redis, MQ, or Docker services.

---

### Task 1: Preflight and credential gate

**Files:**
- Read: `.env.example`
- Preserve or create once: `.env`
- Read: `docker/docker-compose.yaml`

**Interfaces:**
- Consumes: the cloned repository and Windows host state.
- Produces: a non-secret preflight report and a usable root `.env`, or an explicit credential stop.

- [ ] **Step 1: Confirm repository identity and clean-state boundaries**

Run from the project directory:

```powershell
git rev-parse --show-toplevel
git status --short --branch
Test-Path -LiteralPath '.env'
Get-ChildItem -Force -LiteralPath 'data' | Select-Object Name,Length,Mode
```

Expected: the root is the exact `MallWork` directory; tracked catalog data exists; any pre-existing `.env` or data is left unchanged.

- [ ] **Step 2: Check host ports without terminating any process**

```powershell
$rows = @(foreach ($p in 5173,8000,6333,6379) {
  $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)
  if ($listeners.Count) {
    foreach ($listener in $listeners) {
      [pscustomobject]@{ Port=$p; Address=$listener.LocalAddress; PID=$listener.OwningProcess }
    }
  } else {
    [pscustomobject]@{ Port=$p; Address='FREE'; PID='' }
  }
})
$rows | Format-Table -AutoSize
```

Expected: all four ports show `FREE`. If not, stop and report the exact PID; do not kill it.

- [ ] **Step 3: Preserve or create `.env` exactly once**

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Expected: an existing `.env` is byte-for-byte untouched; otherwise a local ignored file is created from the repository example.

- [ ] **Step 4: Validate required model fields without displaying values**

Run a local parser that checks process environment first and `.env` second, treating blank strings and `sk-xxx` as invalid. Report booleans only for `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_FALLBACK_MODEL`, and `EMBEDDING_MODEL`.

Expected: `LLM_API_KEY` is non-empty and not `sk-xxx`; the model gateway supports OpenAI-compatible streaming, tool calls, and embeddings. If the key is missing, stop and ask the user to edit `.env`; never echo the value.

### Task 2: Docker Desktop and Compose validation

**Files:**
- Read: `docker/docker-compose.yaml`
- Preserve: `.env`

**Interfaces:**
- Consumes: the valid credential gate from Task 1.
- Produces: a ready Docker Engine and a Compose configuration that validates without secret expansion output.

- [ ] **Step 1: Check Docker Engine**

```powershell
docker info --format 'ServerVersion={{.ServerVersion}} OSType={{.OSType}} Name={{.Name}}'
```

Expected: Linux engine details. If the named pipe is absent, start Docker Desktop with its installed executable and wait until the same command succeeds.

- [ ] **Step 2: Validate Compose quietly**

```powershell
docker compose --env-file .env -f docker/docker-compose.yaml config --quiet
```

Expected: exit code 0 with no expanded configuration printed.

- [ ] **Step 3: Record pre-existing project volumes without modifying them**

```powershell
docker volume ls --format '{{.Name}}' --filter label=com.docker.compose.project=mallwork
```

Expected: existing volume names are recorded and retained; an empty result is valid for a first deployment.

### Task 3: Build and start the complete stack

**Files:**
- Read: `Dockerfile`
- Read: `frontend/Dockerfile`
- Read: `uv.lock`
- Read: `frontend/package-lock.json`

**Interfaces:**
- Consumes: validated Compose configuration and a ready Docker Engine.
- Produces: running `app`, `worker`, `redis`, `qdrant`, and `frontend` services under the stable Compose project name `mallwork`.

- [ ] **Step 1: Build and start all services**

```powershell
docker compose -p mallwork --env-file .env -f docker/docker-compose.yaml up -d --build
```

Expected: dependency installation comes from `uv.lock` and `package-lock.json`; all five services are created without modifying host Python or Node environments.

- [ ] **Step 2: Inspect authoritative service state**

```powershell
docker compose -p mallwork --env-file .env -f docker/docker-compose.yaml ps
```

Expected: five services are running and Redis reports healthy.

- [ ] **Step 3: Inspect bounded startup logs**

```powershell
docker compose -p mallwork --env-file .env -f docker/docker-compose.yaml logs --tail 150 app worker redis qdrant frontend
```

Expected: no fatal startup error, credential rejection, database failure, or repeated container restart. Do not print the Compose-expanded environment.

### Task 4: API and persistence verification

**Files:**
- Read: runtime container logs and `/health` response.

**Interfaces:**
- Consumes: the running stack from Task 3.
- Produces: evidence that the API and enabled dependencies are healthy and named volumes remain attached.

- [ ] **Step 1: Poll the API health endpoint with a bounded deadline**

```powershell
$deadline = (Get-Date).AddMinutes(5)
do {
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 10
    if ($health.status -eq 'ok') { break }
  } catch {}
  Start-Sleep -Seconds 3
} while ((Get-Date) -lt $deadline)
if (-not $health -or $health.status -ne 'ok') { throw 'MallWork health check did not become ready' }
$health | ConvertTo-Json -Depth 8
```

Expected: HTTP 200 and top-level `status` equal to `ok`; enabled Redis/Qdrant/database details do not report failure.

- [ ] **Step 2: Verify frontend proxy health**

```powershell
$proxyHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5173/health' -TimeoutSec 10
if ($proxyHealth.status -ne 'ok') { throw 'Frontend health proxy failed' }
```

Expected: Nginx reaches the same healthy app service.

- [ ] **Step 3: Verify named volumes are attached**

```powershell
docker inspect mallwork-app-1 mallwork-redis-1 mallwork-qdrant-1 --format '{{.Name}} {{range .Mounts}}{{.Name}}:{{.Destination}} {{end}}'
```

Expected: the application, Redis, and Qdrant containers show their respective named data volumes.

### Task 5: Real browser shopping verification and handoff

**Files:**
- Read: rendered page state, browser network behavior, and bounded application logs.

**Interfaces:**
- Consumes: healthy API and frontend endpoints.
- Produces: one verified real model-backed shopping result and the final access report.

- [ ] **Step 1: Open the real page in a browser**

Use the computer-use workflow to open `http://127.0.0.1:5173` and keep the same origin throughout the test.

Expected: the React shopping interface renders without an error banner.

- [ ] **Step 2: Submit the acceptance request**

Enter and send exactly:

```text
预算 300 元以内，找一个寄到中国的轻便背包
```

Expected: the page shows streaming progress followed by a completed response with structured product cards.

- [ ] **Step 3: Perform one real selection interaction**

Open or select one returned product card and verify its product/SKU details render. If a comparison or favorite control is the available selection affordance, activate it once and verify visible state changes.

Expected: at least one actual candidate is interacted with; the page does not merely display a static shell or mocked fixture.

- [ ] **Step 4: Correlate the browser result with backend logs**

```powershell
docker compose -p mallwork --env-file .env -f docker/docker-compose.yaml logs --since 10m app worker
```

Expected: the accepted request reached the backend and completed without model authentication, embedding, retrieval, or SSE failure.

- [ ] **Step 5: Report access and preservation evidence**

Report these addresses:

```text
Page: http://127.0.0.1:5173
API health: http://127.0.0.1:8000/health
API docs: http://127.0.0.1:8000/docs
Qdrant: http://127.0.0.1:6333
```

Also report Compose service state, named volume names, whether `.env` was preserved or newly created, the exact shopping request and observed product interaction, and any missing optional fields. Keep the stack running for the user unless they explicitly ask to stop it.
