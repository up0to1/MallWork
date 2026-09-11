# Mall Work Compatible Brand Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the public-facing project and product brand from `Globex` to `Mall Work` without changing persistent data or protocol identifiers.

**Architecture:** Treat `Mall Work` as the display name and `mallwork` as the machine-readable package/service slug. Keep every storage, session, authentication, queue, metric, and historical-evidence identifier containing `globex` unchanged so the running Compose stack can be rebuilt against its existing volumes.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, FastAPI, Python 3.11, uv, Docker Compose

**Spec:** `docs/superpowers/specs/2026-09-11-mall-work-brand-rename-design.md`

## Global Constraints

- Display name is exactly `Mall Work`.
- Project directory remains exactly `MallWork`.
- Machine-readable package names are `mallwork-agent` and `mallwork-frontend`.
- Do not edit `.env` or print `LLM_API_KEY`.
- Do not delete or recreate Docker volumes.
- Preserve SQLite `globex.db`, Qdrant `globex_products` and `globex_category_kb`, every Redis `globex:*` key/stream/group, WebSocket/JWT identifiers, browser localStorage keys, Prometheus metrics, OpenTelemetry attribute names, Python prompt filenames, and historical evidence.

---

### Task 1: Lock the Public Brand Contract in Tests

**Files:**
- Modify: `frontend/tests/buyerWorkspace.test.tsx`
- Create: `tests/test_branding.py`

**Interfaces:**
- Consumes: React `App` DOM and `app.presentation.server.build_app()`.
- Produces: regression assertions for the visible `Mall Work` label and FastAPI title.

- [ ] **Step 1: Add the failing frontend brand test**

Append this test to `frontend/tests/buyerWorkspace.test.tsx`:

```tsx
it("展示 Mall Work 品牌且不再展示旧品牌", async () => {
  await mount();
  expect(host.querySelector(".brand-name")?.textContent).toBe("Mall Work");
  expect(host.textContent).not.toContain("Globex");
});
```

- [ ] **Step 2: Add the failing API brand test**

Create `tests/test_branding.py`:

```python
from app.presentation.server import build_app


def test_fastapi_uses_mall_work_public_title():
    assert build_app().title == "Mall Work 跨境电商 Agent"
```

- [ ] **Step 3: Run both tests and verify they fail**

Run:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace ghcr.io/astral-sh/uv:python3.11-bookworm-slim uv run --frozen python -m pytest -q tests/test_branding.py
docker run --rm -v "${PWD}/frontend:/workspace" -w /workspace node:22-alpine npm test -- tests/buyerWorkspace.test.tsx
```

Expected: the API test reports the old `Globex` title and the frontend test reports the old brand text.

- [ ] **Step 4: Commit the failing contract tests**

```powershell
git add frontend/tests/buyerWorkspace.test.tsx tests/test_branding.py
git commit -m "test: define Mall Work public brand"
```

### Task 2: Rename Runtime User-Facing Branding

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/index.html`
- Modify: `app/presentation/server.py`

**Interfaces:**
- Consumes: the exact brand contract from Task 1.
- Produces: visible UI copy and API metadata using `Mall Work`; no storage or protocol changes.

- [ ] **Step 1: Replace only user-facing UI occurrences**

In `frontend/src/App.tsx`, replace the eight visible `Globex` strings with `Mall Work`, including the home label, desktop/mobile brand, conversation guidance, composer label, and footer. Do not change `VIEW_KEY` or `FAVORITES_KEY`.

- [ ] **Step 2: Replace browser metadata**

In `frontend/index.html`, set:

```html
<meta name="description" content="告诉 Mall Work 你的用途和预算，一起发现适合你的环球好物。" />
<title>Mall Work 环球好物 · 从容选购</title>
```

- [ ] **Step 3: Replace API display metadata**

In `app/presentation/server.py`, set:

```python
api = FastAPI(title="Mall Work 跨境电商 Agent", version="0.4.0", lifespan=lifespan)
```

Do not change the `globex:turns:` Redis key.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run the two commands from Task 1.

Expected: both tests pass.

- [ ] **Step 5: Commit runtime branding**

```powershell
git add frontend/src/App.tsx frontend/index.html app/presentation/server.py
git commit -m "feat: rename public brand to Mall Work"
```

### Task 3: Rename Project and Service Metadata

**Files:**
- Modify: `README.md`
- Modify: `pyproject.toml`
- Modify: `uv.lock`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `docker/docker-compose.yaml`

**Interfaces:**
- Consumes: display name `Mall Work`, directory `MallWork`, slugs `mallwork-agent` and `mallwork-frontend`.
- Produces: consistent repository, package, and observable service metadata.

- [ ] **Step 1: Rename README project references**

Change the README heading to `# Mall Work · 跨境电商选购 Agent`, add one sentence explaining that legacy `globex` storage/protocol identifiers are intentionally retained, and change executable directory examples from `globex-agent` to `MallWork`. Keep the documented database path `data/globex.db` and `GLOBEX_REDIS_SERVER_BIN` unchanged.

- [ ] **Step 2: Rename Python package metadata**

Set `pyproject.toml` project name to `mallwork-agent` and start its description with `Mall Work`. Update only the root package entry in `uv.lock` from `globex-agent` to `mallwork-agent`; do not relock third-party dependency versions.

- [ ] **Step 3: Rename npm package metadata**

Set the package name to `mallwork-frontend` in `frontend/package.json`, the lockfile top-level `name`, and `packages[""].name`. Do not modify dependency versions, integrity hashes, or registry URLs.

- [ ] **Step 4: Rename Compose documentation and service display metadata**

Change the Compose header to `Mall Work`, the example directory to `MallWork`, and `OTEL_SERVICE_NAME` values to `mallwork-api` and `mallwork-worker`. Keep database URLs, Qdrant collection defaults, service keys, and volume names unchanged.

- [ ] **Step 5: Validate metadata and compatibility markers**

Run:

```powershell
docker compose -p mallwork --env-file .env -f docker/docker-compose.yaml config --quiet
rg -n -i "globex" frontend/src frontend/index.html README.md pyproject.toml frontend/package.json docker/docker-compose.yaml
```

Expected: remaining matches are only the explicitly preserved compatibility identifiers and README compatibility explanation; there are no visible old-brand strings.

- [ ] **Step 6: Commit metadata changes**

```powershell
git add README.md pyproject.toml uv.lock frontend/package.json frontend/package-lock.json docker/docker-compose.yaml
git commit -m "chore: rename project metadata to Mall Work"
```

### Task 4: Rebuild and Verify Without Data Loss

**Files:**
- Verify only; do not modify `.env` or Docker volumes.

**Interfaces:**
- Consumes: current `.env`, Compose project `mallwork`, and existing named volumes.
- Produces: rebuilt running services and acceptance evidence.

- [ ] **Step 1: Run automated regressions**

Run:

```powershell
docker run --rm -v "${PWD}/frontend:/workspace" -w /workspace node:22-alpine npm test
docker run --rm -v "${PWD}/frontend:/workspace" -w /workspace node:22-alpine npm run build
docker run --rm -v "${PWD}:/workspace" -w /workspace ghcr.io/astral-sh/uv:python3.11-bookworm-slim uv run --frozen python -m pytest -q tests/test_branding.py
```

Expected: all commands exit 0.

- [ ] **Step 2: Capture current named volume mounts**

Run `docker compose -p mallwork --env-file .env -f docker/docker-compose.yaml ps` and `docker inspect` for the app, Redis, and Qdrant containers. Record that `mallwork_app-data`, `mallwork_redis-data`, and `mallwork_qdrant-data` remain mounted.

- [ ] **Step 3: Rebuild in place**

Run:

```powershell
docker compose -p mallwork --env-file .env -f docker/docker-compose.yaml up -d --build
```

Do not run `docker compose down -v`.

- [ ] **Step 4: Verify health and logs**

Check `http://127.0.0.1:8000/health` and `http://127.0.0.1:5173/health`, confirm all five services are running, and inspect recent app/worker logs for errors.

- [ ] **Step 5: Perform a real browser shopping acceptance**

Open `http://127.0.0.1:5173`, confirm the browser title and visible brand say `Mall Work`, submit `预算 300 元以内，找一个寄到中国的轻便背包`, wait for real streamed product cards, open one product detail, and confirm the console has no errors.

- [ ] **Step 6: Final repository audit**

Run `git diff --check`, `git status --short --branch`, and inspect the recent commits. Expected: clean worktree, current branch ahead only by intentional local commits, with all services left running.
