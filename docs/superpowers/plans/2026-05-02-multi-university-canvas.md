# Multi-University Canvas Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Cursus invite-only while letting each allowlisted user connect the Canvas host used by their own university.

**Architecture:** Add a focused backend Canvas-domain validator, use it in onboarding before any outbound Canvas request, and persist the normalized host on the user row. Add a small authenticated account endpoint for frontend prefill, then update onboarding/settings to submit `{ pat, canvas_base_url }`.

**Tech Stack:** FastAPI, SQLAlchemy async, httpx, pytest/httpx-mock, React 18, TanStack Query, Vitest, Testing Library, Vite.

---

## File Structure

- Create `backend/studybuddy/canvas/domains.py`: normalize and validate user-submitted Canvas hosts, including DNS-based public-address checks.
- Create `backend/tests/test_canvas_domains.py`: unit tests for normalization and SSRF protections.
- Modify `backend/studybuddy/api/onboarding.py`: accept `canvas_base_url`, validate it, use it for `/api/v1/users/self`, and save it.
- Modify `backend/studybuddy/auth/routes.py`: add authenticated `/api/auth/me`.
- Modify `backend/tests/test_onboarding.py`: prove non-EUR hosts are used and saved.
- Modify `backend/tests/test_auth_routes.py`: prove `/api/auth/me` returns account state.
- Create `frontend-v2/src/api/onboarding.ts`: typed payload helpers for account and PAT submission.
- Create `frontend-v2/src/api/onboarding.test.ts`: API payload tests.
- Modify `frontend-v2/src/api/queries.ts`: expose `useAccount` and accept the new PAT payload.
- Modify `frontend-v2/src/pages/Onboarding.tsx`: collect Canvas domain and PAT.
- Modify `frontend-v2/src/pages/Settings.tsx`: prefill Canvas domain and submit it with the replacement PAT.
- Create `frontend-v2/src/pages/Onboarding.test.tsx`: form behavior test.
- Create `frontend-v2/src/pages/Settings.test.tsx`: prefill and submit behavior test.

## Task 1: Backend Canvas Host Validator

**Files:**
- Create: `backend/studybuddy/canvas/domains.py`
- Test: `backend/tests/test_canvas_domains.py`

- [ ] **Step 1: Write failing tests**

```python
import pytest
from studybuddy.canvas.domains import InvalidCanvasHost, normalize_canvas_base_url, validate_canvas_host


def test_normalize_accepts_host_and_https_url():
    assert normalize_canvas_base_url("Canvas.Example.EDU") == "canvas.example.edu"
    assert normalize_canvas_base_url("https://canvas.example.edu/profile/settings") == "canvas.example.edu"


@pytest.mark.parametrize("value", ["", "http://canvas.example.edu", "https://user@canvas.example.edu", "https://canvas.example.edu:8443", "localhost", "127.0.0.1", "school.local"])
def test_normalize_rejects_invalid_or_unsafe_hosts(value):
    with pytest.raises(InvalidCanvasHost):
        normalize_canvas_base_url(value)


@pytest.mark.asyncio
async def test_validate_rejects_private_dns_results(monkeypatch):
    async def fake_resolve(host: str) -> list[str]:
        return ["10.0.0.5"]

    monkeypatch.setattr("studybuddy.canvas.domains._resolve_host_ips", fake_resolve)

    with pytest.raises(InvalidCanvasHost):
        await validate_canvas_host("canvas.example.edu")


@pytest.mark.asyncio
async def test_validate_returns_public_host(monkeypatch):
    async def fake_resolve(host: str) -> list[str]:
        return ["93.184.216.34"]

    monkeypatch.setattr("studybuddy.canvas.domains._resolve_host_ips", fake_resolve)

    assert await validate_canvas_host("https://Canvas.Example.EDU/path") == "canvas.example.edu"
```

- [ ] **Step 2: Run tests to verify red**

Run: `cd backend; uv run --extra dev pytest tests/test_canvas_domains.py -q`

Expected: import failure because `studybuddy.canvas.domains` does not exist.

- [ ] **Step 3: Implement minimal validator**

Implement `InvalidCanvasHost`, `normalize_canvas_base_url`, async `_resolve_host_ips`, and async `validate_canvas_host`.

- [ ] **Step 4: Run tests to verify green**

Run: `cd backend; uv run --extra dev pytest tests/test_canvas_domains.py -q`

Expected: all tests pass.

## Task 2: Backend Onboarding Uses Per-User Canvas Host

**Files:**
- Modify: `backend/studybuddy/api/onboarding.py`
- Test: `backend/tests/test_onboarding.py`

- [ ] **Step 1: Write failing tests**

Add tests proving:

```python
async def test_onboarding_validates_against_submitted_canvas_host_and_saves_it(...):
    # POST {"pat": "valid_pat", "canvas_base_url": "https://canvas.other.edu/profile/settings"}
    # httpx_mock expects GET https://canvas.other.edu/api/v1/users/self
    # assert user.canvas_base_url == "canvas.other.edu"
```

and:

```python
async def test_onboarding_missing_canvas_host_uses_saved_host(...):
    # user starts with canvas_base_url="canvas.saved.edu"
    # POST {"pat": "valid_pat"}
    # httpx_mock expects GET https://canvas.saved.edu/api/v1/users/self
```

- [ ] **Step 2: Run tests to verify red**

Run: `cd backend; uv run --extra dev pytest tests/test_onboarding.py -q`

Expected: request body with `canvas_base_url` is ignored, so the test still calls `canvas.eur.nl`.

- [ ] **Step 3: Implement onboarding changes**

Change `PATPayload` to:

```python
class PATPayload(BaseModel):
    pat: str
    canvas_base_url: str | None = None
```

Resolve and validate host:

```python
requested_host = payload.canvas_base_url or user.canvas_base_url or settings.canvas_base_url
canvas_host = await validate_canvas_host(requested_host)
```

Use `canvas_host` in the Canvas validation URL and save it to `user.canvas_base_url` after Canvas accepts the PAT.

- [ ] **Step 4: Run tests to verify green**

Run: `cd backend; uv run --extra dev pytest tests/test_onboarding.py tests/test_canvas_domains.py -q`

Expected: all selected tests pass.

## Task 3: Account API for Frontend Prefill

**Files:**
- Modify: `backend/studybuddy/auth/routes.py`
- Test: `backend/tests/test_auth_routes.py`

- [ ] **Step 1: Write failing test**

Add:

```python
async def test_me_returns_authenticated_account_state(client, db):
    user = User(email="a@eur.nl", canvas_base_url="canvas.other.edu", pat_encrypted=b"x", pat_nonce=b"y")
    # create session and call GET /api/auth/me
    # assert email, canvas_base_url, has_pat
```

- [ ] **Step 2: Run test to verify red**

Run: `cd backend; uv run --extra dev pytest tests/test_auth_routes.py::test_me_returns_authenticated_account_state -q`

Expected: 404 because `/api/auth/me` does not exist.

- [ ] **Step 3: Implement `/api/auth/me`**

Add a response model and route using `current_user`:

```python
class MeResponse(BaseModel):
    email: EmailStr
    canvas_base_url: str
    has_pat: bool

@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(current_user)):
    return MeResponse(
        email=user.email,
        canvas_base_url=user.canvas_base_url,
        has_pat=user.pat_encrypted is not None and user.pat_nonce is not None,
    )
```

- [ ] **Step 4: Run test to verify green**

Run: `cd backend; uv run --extra dev pytest tests/test_auth_routes.py -q`

Expected: auth route tests pass.

## Task 4: Frontend API Helpers

**Files:**
- Create: `frontend-v2/src/api/onboarding.ts`
- Create: `frontend-v2/src/api/onboarding.test.ts`
- Modify: `frontend-v2/src/api/queries.ts`

- [ ] **Step 1: Write failing API tests**

Test that `submitPat({ pat, canvas_base_url })` posts both fields and `getAccount()` calls `/api/auth/me`.

- [ ] **Step 2: Run tests to verify red**

Run: `cd frontend-v2; npm.cmd run test -- src/api/onboarding.test.ts`

Expected: import failure because the helper does not exist.

- [ ] **Step 3: Implement API helper and query hook**

Define:

```ts
export interface SubmitPatPayload {
  pat: string;
  canvas_base_url: string;
}

export interface AccountResponse {
  email: string;
  canvas_base_url: string;
  has_pat: boolean;
}
```

Add `submitPat`, `getAccount`, `useAccount`, and update `useSubmitPat` to accept `SubmitPatPayload`.

- [ ] **Step 4: Run tests to verify green**

Run: `cd frontend-v2; npm.cmd run test -- src/api/onboarding.test.ts`

Expected: API tests pass.

## Task 5: Frontend Onboarding and Settings UI

**Files:**
- Modify: `frontend-v2/src/pages/Onboarding.tsx`
- Modify: `frontend-v2/src/pages/Settings.tsx`
- Create: `frontend-v2/src/pages/Onboarding.test.tsx`
- Create: `frontend-v2/src/pages/Settings.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Onboarding test:

```tsx
// render in MemoryRouter + QueryClientProvider
// fill Canvas URL or domain and Canvas token
// submit
// expect useSubmitPat mutation to receive { pat, canvas_base_url }
```

Settings test:

```tsx
// mock useAccount to return canvas_base_url: "canvas.other.edu"
// assert input is prefilled
// submit changed domain and PAT
// expect mutation payload includes both fields
```

- [ ] **Step 2: Run tests to verify red**

Run: `cd frontend-v2; npm.cmd run test -- src/pages/Onboarding.test.tsx src/pages/Settings.test.tsx`

Expected: tests fail because the domain fields are not present.

- [ ] **Step 3: Implement UI changes**

Onboarding:

- Add `canvasBaseUrl` state defaulting to `canvas.eur.nl`.
- Add a required text input labelled `Canvas URL or domain`.
- Generate settings link from the current input.
- Call `mutateAsync({ pat, canvas_base_url: canvasBaseUrl })`.

Settings:

- Load `useAccount`.
- Prefill `canvasBaseUrl` when account data arrives.
- Submit `{ pat, canvas_base_url: canvasBaseUrl }`.
- Preserve logout/session behavior.

- [ ] **Step 4: Run tests to verify green**

Run: `cd frontend-v2; npm.cmd run test -- src/api/onboarding.test.ts src/pages/Onboarding.test.tsx src/pages/Settings.test.tsx`

Expected: selected frontend tests pass.

## Task 6: Full Verification

**Files:** no new files.

- [ ] **Step 1: Backend focused tests**

Run: `cd backend; uv run --extra dev pytest tests/test_canvas_domains.py tests/test_onboarding.py tests/test_auth_routes.py -q`

Expected: pass.

- [ ] **Step 2: Full backend tests**

Run: `cd backend; uv run --extra dev pytest`

Expected: pass.

- [ ] **Step 3: Full frontend tests**

Run: `cd frontend-v2; npm.cmd run test`

Expected: pass.

- [ ] **Step 4: Production frontend build**

Run: `cd frontend-v2; $env:VITE_API_BASE_URL='http://localhost:8000'; npm.cmd run build`

Expected: TypeScript and Vite build pass.

## Task 7: Commit and Push

**Files:** all changed files.

- [ ] **Step 1: Review diff**

Run: `git diff --stat` and `git diff --check`.

- [ ] **Step 2: Commit**

Run:

```powershell
git add backend/studybuddy/canvas/domains.py backend/studybuddy/api/onboarding.py backend/studybuddy/auth/routes.py backend/tests/test_canvas_domains.py backend/tests/test_onboarding.py backend/tests/test_auth_routes.py frontend-v2/src/api/onboarding.ts frontend-v2/src/api/onboarding.test.ts frontend-v2/src/api/queries.ts frontend-v2/src/pages/Onboarding.tsx frontend-v2/src/pages/Onboarding.test.tsx frontend-v2/src/pages/Settings.tsx frontend-v2/src/pages/Settings.test.tsx docs/superpowers/plans/2026-05-02-multi-university-canvas.md
git commit -m "feat: support multiple Canvas universities"
```

- [ ] **Step 3: Push**

Run: `git push origin main`

Expected: GitHub receives the commit so Vercel can deploy from GitHub.
