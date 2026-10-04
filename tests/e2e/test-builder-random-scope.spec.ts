import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from "./fixtures";
import { loadE2EEnv, isJwtSecret } from "./load-e2e-env";

/**
 * Test Creation random selection must honor exact MCQ Bank folder/subfolder scope.
 * Fixture layout makes scope violations obvious; draft cleaned up in teardown.
 */
const e2e = loadE2EEnv();
const AUTH = e2e.authUrl.replace(/\/$/, "");
const REST = e2e.restUrl.replace(/\/$/, "");
const SERVICE = e2e.serviceRoleKey;
const ANON = e2e.anonKey;

let adminJwtCache: { token: string; expMs: number } | null = null;

async function adminToken(): Promise<string> {
  const now = Date.now();
  if (adminJwtCache && adminJwtCache.expMs > now + 60_000) {
    return adminJwtCache.token;
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
    expMs: now + 50 * 60_000,
  };
  return adminJwtCache.token;
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
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    throw new Error(`${name} ${res.status}: ${text.slice(0, 400)}`);
  }
  return json as T;
}

type ScopeFixture = {
  tag: string;
  yearId: string;
  bankId: string;
  folderA: string;
  folderB: string;
  subA1: string;
  subA2: string;
  subB1: string;
  qA1: string[];
  qA2: string[];
  qB1: string[];
  qOutside: string[];
  topicId: string;
  testId: string;
};

async function provisionScopeFixture(): Promise<ScopeFixture> {
  const tag = `E2E_RND_${Math.random().toString(36).slice(2, 10)}`;
  const headers = await bearerHeaders({ Prefer: "return=representation" });

  // Prefer a year that already has product banks (MCQ Bank Blocks).
  const banks = await fetch(
    `${REST}/rest/v1/subjects?product_key=not.is.null&select=id,name,year_id,product_key&order=name&limit=20`,
    { headers: await bearerHeaders() }
  ).then((r) => r.json());
  if (!Array.isArray(banks) || banks.length === 0) {
    throw new Error("no product subjects available for MCQ Bank scope e2e");
  }
  const bank = banks[0] as { id: string; year_id: string; name: string };
  const yearId = bank.year_id as string;

  const subjRes = await fetch(
    `${REST}/rest/v1/subjects?year_id=eq.${yearId}&select=id&limit=1`,
    { headers: await bearerHeaders() }
  ).then((r) => r.json());
  const subjectId = subjRes[0].id as string;

  const book = await fetch(`${REST}/rest/v1/books`, {
    method: "POST",
    headers,
    body: JSON.stringify({ subject_id: subjectId, name: tag }),
  }).then((r) => r.json());
  const chapter = await fetch(`${REST}/rest/v1/chapters`, {
    method: "POST",
    headers,
    body: JSON.stringify({ book_id: book[0].id, name: tag }),
  }).then((r) => r.json());
  const topic = await fetch(`${REST}/rest/v1/topics`, {
    method: "POST",
    headers,
    body: JSON.stringify({ chapter_id: chapter[0].id, name: tag }),
  }).then((r) => r.json());
  const topicId = topic[0].id as string;

  const folderA = await rpc<string>("admin_create_mcq_bank_folder", {
    p_product_subject_id: bank.id,
    p_name: `${tag}_FA`,
  });
  const folderB = await rpc<string>("admin_create_mcq_bank_folder", {
    p_product_subject_id: bank.id,
    p_name: `${tag}_FB`,
  });
  const subA1 = await rpc<string>("admin_create_mcq_bank_subfolder", {
    p_folder_id: folderA,
    p_name: `${tag}_A1`,
  });
  const subA2 = await rpc<string>("admin_create_mcq_bank_subfolder", {
    p_folder_id: folderA,
    p_name: `${tag}_A2`,
  });
  const subB1 = await rpc<string>("admin_create_mcq_bank_subfolder", {
    p_folder_id: folderB,
    p_name: `${tag}_B1`,
  });

  const opts = [
    { key: "A", text: "A" },
    { key: "B", text: "B" },
    { key: "C", text: "C" },
    { key: "D", text: "D" },
  ];

  async function makeQ(stem: string, subfolderId: string | null) {
    const id = await rpc<string>("create_question", {
      p_topic_id: topicId,
      p_stem: stem,
      p_options: opts,
      p_correct_key: "A",
      p_explanation: "e2e",
      p_reference: "e2e",
      p_difficulty: "medium",
      p_tags: ["e2e", "random-scope"],
      p_status: "approved",
      p_mcq_bank_subfolder_id: subfolderId,
    });
    return id;
  }

  const qA1 = [
    await makeQ(`${tag} IN_A1 one`, subA1),
    await makeQ(`${tag} IN_A1 two`, subA1),
    await makeQ(`${tag} IN_A1 three`, subA1),
  ];
  const qA2 = [await makeQ(`${tag} IN_A2 sibling`, subA2)];
  const qB1 = [await makeQ(`${tag} IN_B1 other-folder`, subB1)];
  const qOutside = [await makeQ(`${tag} OUTSIDE unassigned`, null)];

  const testRows = await fetch(`${REST}/rest/v1/tests`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: `TB RND ${tag}`,
      year_id: yearId,
      status: "draft",
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
      duration_minutes: 60,
      marks_per_question: 1,
      negative_mark: 0,
      min_questions: 1,
    }),
  }).then((r) => r.json());
  const testId = testRows[0]?.id as string;
  if (!testId) throw new Error(`draft create failed: ${JSON.stringify(testRows)}`);

  return {
    tag,
    yearId,
    bankId: bank.id,
    folderA,
    folderB,
    subA1,
    subA2,
    subB1,
    qA1,
    qA2,
    qB1,
    qOutside,
    topicId,
    testId,
  };
}

async function cleanupScopeFixture(f: ScopeFixture) {
  const headers = await bearerHeaders();
  await fetch(`${REST}/rest/v1/tests?id=eq.${f.testId}`, {
    method: "DELETE",
    headers,
  });
  const allQ = [...f.qA1, ...f.qA2, ...f.qB1, ...f.qOutside];
  if (allQ.length) {
    await fetch(
      `${REST}/rest/v1/questions?id=in.(${allQ.join(",")})`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          deleted_at: new Date().toISOString(),
          purge_after: new Date(Date.now() + 7 * 86400_000).toISOString(),
        }),
      }
    );
  }
}

test.describe("Test Builder random selection scope", () => {
  test("subfolder random excludes siblings, other folders, and unassigned", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const fixture = await provisionScopeFixture();

    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(ADMIN_EMAIL);
      await page.getByLabel("Password").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/(dashboard|admin)/);

      const qs = new URLSearchParams({
        bank: fixture.bankId,
        folder: fixture.folderA,
        subfolder: fixture.subA1,
      });
      await page.goto(`/admin/tests/${fixture.testId}?${qs.toString()}`);
      await expect(page.getByText(`TB RND ${fixture.tag}`)).toBeVisible();

      await expect(page.getByTestId("filter-mcq-bank")).toHaveValue(
        fixture.bankId
      );
      await expect(page.getByTestId("filter-mcq-folder")).toHaveValue(
        fixture.folderA
      );
      await expect(page.getByTestId("filter-mcq-subfolder")).toHaveValue(
        fixture.subA1
      );

      // Pool should only show A1 questions (3)
      await expect(page.getByText(`${fixture.tag} IN_A1 one`)).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(`${fixture.tag} IN_A2 sibling`)).toHaveCount(
        0
      );
      await expect(
        page.getByText(`${fixture.tag} IN_B1 other-folder`)
      ).toHaveCount(0);
      await expect(
        page.getByText(`${fixture.tag} OUTSIDE unassigned`)
      ).toHaveCount(0);

      const nInput = page.locator('input[type="number"]').first();
      await nInput.fill("10");
      await page.getByTestId("add-random-from-filter").click();
      const questionsHeading = page
        .getByRole("main")
        .getByText(/^Questions \(\d+\)$/);
      await expect(questionsHeading).toHaveText("Questions (3)", {
        timeout: 20000,
      });

      await expect(page.getByText(`${fixture.tag} IN_A1 one`)).toBeVisible();
      await expect(page.getByText(`${fixture.tag} IN_A1 two`)).toBeVisible();
      await expect(page.getByText(`${fixture.tag} IN_A1 three`)).toBeVisible();
      await expect(page.getByText(`${fixture.tag} IN_A2 sibling`)).toHaveCount(
        0
      );
      await expect(
        page.getByText(`${fixture.tag} IN_B1 other-folder`)
      ).toHaveCount(0);
      await expect(
        page.getByText(`${fixture.tag} OUTSIDE unassigned`)
      ).toHaveCount(0);

      // Refresh preserves questions
      await page.reload();
      await expect(
        page.getByRole("main").getByText("Questions (3)")
      ).toBeVisible({
        timeout: 15000,
      });

      // Manual selection still works when scope cleared to sibling-visible pool
      await page.goto(
        `/admin/tests/${fixture.testId}?bank=${fixture.bankId}&folder=${fixture.folderA}`
      );
      await expect(
        page.getByTestId(`tick-question-${fixture.qA2[0]}`)
      ).toBeVisible({ timeout: 15000 });
      await page.getByTestId(`tick-question-${fixture.qA2[0]}`).click();
      await page.getByTestId("add-selected-questions").click();
      await expect(
        page.getByRole("main").getByText("Questions (4)")
      ).toBeVisible({
        timeout: 15000,
      });
      await expect(page.getByText(`${fixture.tag} IN_A2 sibling`)).toBeVisible();
      // Sibling folder still not on test
      await expect(
        page.getByText(`${fixture.tag} IN_B1 other-folder`)
      ).toHaveCount(0);
    } finally {
      await cleanupScopeFixture(fixture);
    }
  });
});
