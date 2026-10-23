import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./fixtures";
import { loadE2EEnv, isJwtSecret } from "./load-e2e-env";

/**
 * Issue #3: Test Builder "Add N random from this filter" must apply the same
 * text-search (`q`) and CSV import-set (`import_batch`) filters as the visible
 * pool, and an empty/unknown import batch must yield an EMPTY pool (never the
 * full pool). Disposable fixtures only: one unique topic isolates the pool,
 * so an unfiltered fallback is visible as extra fixture questions.
 *
 * STAGING ONLY — requires an app build containing commits 3fc7224/16a74f4.
 * Run: npm run test:e2e:staging -- tests/e2e/test-builder-random-import-text-filters.spec.ts
 */
const e2e = loadE2EEnv();
const AUTH = e2e.authUrl.replace(/\/$/, "");
const REST = e2e.restUrl.replace(/\/$/, "");
const SERVICE = e2e.serviceRoleKey;
const ANON = e2e.anonKey;

let adminJwtCache: { token: string; userId: string; expMs: number } | null =
  null;

async function adminSession(): Promise<{ token: string; userId: string }> {
  const now = Date.now();
  if (adminJwtCache && adminJwtCache.expMs > now + 60_000) {
    return adminJwtCache;
  }
  const login = await fetch(`${AUTH}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  }).then((r) => r.json());
  if (!login.access_token) {
    throw new Error(`admin login failed: ${JSON.stringify(login)}`);
  }
  adminJwtCache = {
    token: login.access_token as string,
    userId: login.user?.id as string,
    expMs: now + 50 * 60_000,
  };
  return adminJwtCache;
}

async function adminToken(): Promise<string> {
  return (await adminSession()).token;
}

async function bearerHeaders(extra: Record<string, string> = {}) {
  const token = isJwtSecret(SERVICE) ? SERVICE : await adminToken();
  return {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown>
): Promise<T> {
  const token = await adminToken();
  const res = await fetch(`${REST}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${name} ${res.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function insertRow<T = Record<string, unknown>>(
  table: string,
  body: Record<string, unknown> | Record<string, unknown>[]
): Promise<T[]> {
  const res = await fetch(`${REST}/rest/v1/${table}`, {
    method: "POST",
    headers: await bearerHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`insert ${table} ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as T[];
}

type Fixture = {
  tag: string;
  yearId: string;
  topicId: string;
  /** stem word -> question ids */
  quokka: [string, string];
  wombat: [string, string];
  emptyBatchId: string;
  populatedBatchId: string;
  unknownBatchId: string;
  draftIds: string[];
};

let fx: Fixture;

async function createDraft(f: Fixture): Promise<string> {
  const rows = await insertRow<{ id: string }>("tests", {
    title: `TB IMPTXT ${f.tag} ${f.draftIds.length}`,
    year_id: f.yearId,
    status: "draft",
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
    duration_minutes: 60,
    marks_per_question: 1,
    negative_mark: 0,
    min_questions: 1,
  });
  const id = rows[0]?.id;
  if (!id) throw new Error("draft create failed");
  f.draftIds.push(id);
  return id;
}

async function provision(): Promise<Fixture> {
  // Lowercase alphanumerics only: stems are matched via stem_normalized ilike.
  const tag = `e2eimp${Math.random().toString(36).slice(2, 10)}`;

  const banks = await fetch(
    `${REST}/rest/v1/subjects?product_key=not.is.null&select=id,year_id&order=name&limit=1`,
    { headers: await bearerHeaders() }
  ).then((r) => r.json());
  if (!Array.isArray(banks) || banks.length === 0) {
    throw new Error("no product subject available to pick a year");
  }
  const yearId = banks[0].year_id as string;
  const subj = await fetch(
    `${REST}/rest/v1/subjects?year_id=eq.${yearId}&select=id&limit=1`,
    { headers: await bearerHeaders() }
  ).then((r) => r.json());

  const [book] = await insertRow<{ id: string }>("books", {
    subject_id: subj[0].id,
    name: tag,
  });
  const [chapter] = await insertRow<{ id: string }>("chapters", {
    book_id: book.id,
    name: tag,
  });
  const [topic] = await insertRow<{ id: string }>("topics", {
    chapter_id: chapter.id,
    name: tag,
  });

  const opts = ["A", "B", "C", "D"].map((k) => ({ key: k, text: k }));
  const makeQ = (stem: string) =>
    rpc<string>("create_question", {
      p_topic_id: topic.id,
      p_stem: stem,
      p_options: opts,
      p_correct_key: "A",
      p_explanation: "e2e",
      p_reference: "e2e",
      p_difficulty: "medium",
      p_tags: ["e2e", "import-text-filters"],
      p_status: "approved",
      p_mcq_bank_subfolder_id: null,
    });

  const quokka: [string, string] = [
    await makeQ(`${tag} quokka alpha`),
    await makeQ(`${tag} quokka beta`),
  ];
  const wombat: [string, string] = [
    await makeQ(`${tag} wombat alpha`),
    await makeQ(`${tag} wombat beta`),
  ];

  // Policy requires created_by = auth.uid() (migration 20261005030000).
  const { userId } = await adminSession();
  const [emptyBatch] = await insertRow<{ id: string }>("import_batches", {
    filename: `${tag}-empty.csv`,
    created_by: userId,
  });
  const [populatedBatch] = await insertRow<{ id: string }>("import_batches", {
    filename: `${tag}-populated.csv`,
    total_rows: 2,
    inserted: 2,
    created_by: userId,
  });
  // Populated batch holds one quokka + one wombat ("alpha" of each).
  await insertRow("import_rows", [
    {
      batch_id: populatedBatch.id,
      row_number: 1,
      outcome: "inserted",
      question_id: quokka[0],
    },
    {
      batch_id: populatedBatch.id,
      row_number: 2,
      outcome: "inserted",
      question_id: wombat[0],
    },
  ]);

  return {
    tag,
    yearId,
    topicId: topic.id,
    quokka,
    wombat,
    emptyBatchId: emptyBatch.id,
    populatedBatchId: populatedBatch.id,
    unknownBatchId: crypto.randomUUID(),
    draftIds: [],
  };
}

async function cleanup(f: Fixture) {
  const headers = await bearerHeaders();
  for (const id of f.draftIds) {
    await fetch(`${REST}/rest/v1/tests?id=eq.${id}`, {
      method: "DELETE",
      headers,
    });
  }
  for (const id of [f.emptyBatchId, f.populatedBatchId]) {
    // import_rows cascade with the batch.
    await fetch(`${REST}/rest/v1/import_batches?id=eq.${id}`, {
      method: "DELETE",
      headers,
    });
  }
  const allQ = [...f.quokka, ...f.wombat];
  await fetch(`${REST}/rest/v1/questions?id=in.(${allQ.join(",")})`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({
      deleted_at: new Date().toISOString(),
      purge_after: new Date(Date.now() + 7 * 86400_000).toISOString(),
    }),
  });
}

/**
 * Partial-setup safety net: soft-delete any live question in this spec's own
 * `e2eimp*` stem namespace (a failed beforeAll leaves `fx` unset) and delete
 * its `e2eimp*` import batches / draft tests.
 */
async function sweepOwnNamespace() {
  const headers = await bearerHeaders();
  await fetch(
    `${REST}/rest/v1/questions?stem_normalized=like.e2eimp*&deleted_at=is.null`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        deleted_at: new Date().toISOString(),
        purge_after: new Date(Date.now() + 7 * 86400_000).toISOString(),
      }),
    }
  );
  await fetch(`${REST}/rest/v1/import_batches?filename=like.e2eimp*`, {
    method: "DELETE",
    headers,
  });
  await fetch(`${REST}/rest/v1/tests?title=like.TB%20IMPTXT%20e2eimp*`, {
    method: "DELETE",
    headers,
  });
}

async function loginAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(dashboard|admin)/);
}

function tick(page: Page, id: string) {
  return page.getByRole("main").getByTestId(`tick-question-${id}`);
}

async function expectPool(
  page: Page,
  present: string[],
  absent: string[]
) {
  for (const id of present) {
    await expect(tick(page, id).first()).toBeVisible({ timeout: 15000 });
  }
  for (const id of absent) {
    await expect(tick(page, id)).toHaveCount(0);
  }
}

async function addRandom(page: Page, n: number) {
  await page.locator('input[type="number"]').first().fill(String(n));
  await page.getByTestId("add-random-from-filter").click();
}

const questionsHeading = (page: Page) =>
  page.getByRole("main").getByText(/^Questions \(\d+\)$/);

test.describe.serial("Test Builder random: import-batch + text filters", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    fx = await provision();
  });
  test.afterAll(async () => {
    if (fx) await cleanup(fx);
    await sweepOwnNamespace();
  });

  test("control: no import batch keeps the normal pool and random-add", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const testId = await createDraft(fx);
    await loginAdmin(page);
    await page.goto(`/admin/tests/${testId}?topic=${fx.topicId}`);
    await expectPool(page, [...fx.quokka, ...fx.wombat], []);
    await addRandom(page, 10);
    await expect(questionsHeading(page)).toHaveText("Questions (4)", {
      timeout: 20000,
    });
  });

  for (const [label, batch] of [
    ["empty import batch", () => fx.emptyBatchId],
    ["unknown import batch id", () => fx.unknownBatchId],
  ] as const) {
    test(`${label}: pool is empty (not the full pool) and random-add adds zero`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const testId = await createDraft(fx);
      await loginAdmin(page);
      // Same topic as the control: a fallback would show all 4 fixtures.
      await page.goto(
        `/admin/tests/${testId}?topic=${fx.topicId}&import_batch=${batch()}`
      );
      await expect(page.getByTestId("add-random-from-filter")).toBeVisible({
        timeout: 15000,
      });
      await expectPool(page, [], [...fx.quokka, ...fx.wombat]);
      // Random-add is disabled for an empty pool and nothing is on the test.
      await expect(page.getByTestId("add-random-from-filter")).toBeDisabled();
      await expect(questionsHeading(page)).toHaveText("Questions (0)");
    });
  }

  test("populated import batch restricts pool and random-add to its questions", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const testId = await createDraft(fx);
    await loginAdmin(page);
    await page.goto(
      `/admin/tests/${testId}?topic=${fx.topicId}&import_batch=${fx.populatedBatchId}`
    );
    await expectPool(
      page,
      [fx.quokka[0], fx.wombat[0]],
      [fx.quokka[1], fx.wombat[1]]
    );
    await addRandom(page, 10);
    await expect(questionsHeading(page)).toHaveText("Questions (2)", {
      timeout: 20000,
    });
    await page.reload();
    await expect(questionsHeading(page)).toHaveText("Questions (2)");
  });

  test("text search narrows both the pool and random-add", async ({ page }) => {
    test.setTimeout(120_000);
    const testId = await createDraft(fx);
    await loginAdmin(page);
    await page.goto(
      `/admin/tests/${testId}?topic=${fx.topicId}&q=${encodeURIComponent(`${fx.tag} quokka`)}`
    );
    await expectPool(page, [...fx.quokka], [...fx.wombat]);
    await addRandom(page, 10);
    await expect(questionsHeading(page)).toHaveText("Questions (2)", {
      timeout: 20000,
    });
    // No wombat leaked onto the test: its pool entries are gone only because
    // quokkas are now on the test; wombats must still be offered when unfiltered.
    await page.goto(`/admin/tests/${testId}?topic=${fx.topicId}`);
    await expectPool(page, [...fx.wombat], [...fx.quokka]);
  });

  test("import batch + text search combine (intersection)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const testId = await createDraft(fx);
    await loginAdmin(page);
    await page.goto(
      `/admin/tests/${testId}?topic=${fx.topicId}&import_batch=${fx.populatedBatchId}&q=${encodeURIComponent(`${fx.tag} quokka`)}`
    );
    await expectPool(
      page,
      [fx.quokka[0]],
      [fx.quokka[1], fx.wombat[0], fx.wombat[1]]
    );
    await addRandom(page, 10);
    await expect(questionsHeading(page)).toHaveText("Questions (1)", {
      timeout: 20000,
    });
  });
});
