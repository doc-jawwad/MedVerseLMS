"use client";

import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  type TestStudentAudience,
  canPublishToStudents,
  testAudienceFromEntitlement,
} from "@/lib/study/test-audience";

type TestDraftAudienceContextValue = {
  audience: TestStudentAudience;
  setAudience: (audience: TestStudentAudience) => void;
  canPublish: boolean;
};

const TestDraftAudienceContext =
  createContext<TestDraftAudienceContextValue | null>(null);

export function TestDraftAudienceProvider({
  entitlement,
  status,
  children,
}: {
  entitlement: string | null | undefined;
  status: string;
  children: ReactNode;
}) {
  const [audience, setAudience] = useState<TestStudentAudience>(() =>
    testAudienceFromEntitlement(entitlement, status)
  );

  return (
    <TestDraftAudienceContext.Provider
      value={{
        audience,
        setAudience,
        canPublish: canPublishToStudents(audience),
      }}
    >
      {children}
    </TestDraftAudienceContext.Provider>
  );
}

export function useTestDraftAudience() {
  const ctx = useContext(TestDraftAudienceContext);
  if (!ctx) {
    throw new Error(
      "useTestDraftAudience must be used within TestDraftAudienceProvider"
    );
  }
  return ctx;
}
