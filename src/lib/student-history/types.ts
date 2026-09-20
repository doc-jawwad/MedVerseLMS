export type TestHistoryItem = {
  attempt_id: string;
  test_id: string;
  test_title: string;
  state: string;
  score: number | null;
  max_score: number | null;
  percentage: number | null;
  rank: number | null;
  submitted_at: string | null;
  started_at: string | null;
};

export type PracticePerformanceSummary = {
  answers_count: number;
  correct_count: number;
  accuracy_percent: number | null;
  subjects_practiced: number;
};

export type StudentAnalyticsStats = {
  tests_taken: number;
  average_percentage: number;
  highest_percentage: number;
  last_test_at: string | null;
};

export type PaymentHistoryItem = {
  id: string;
  kind: "application" | "subscription";
  status: string;
  amount: number | null;
  currency: string | null;
  plan_name: string | null;
  created_at: string;
  starts_at: string | null;
  ends_at: string | null;
  review_note: string | null;
};

export type StudentHistoryBundle = {
  test_history: TestHistoryItem[];
  practice: PracticePerformanceSummary;
  analytics: StudentAnalyticsStats;
  payments: PaymentHistoryItem[];
};
