"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setResourceEntitlement } from "@/lib/actions/enrollment";
import { upsertTestPrepGuidelines } from "@/lib/actions/tests";
import {
  canPublishToStudents,
  entitlementForTestAudience,
  TEST_STUDENT_AUDIENCE_OPTIONS,
} from "@/lib/study/test-audience";
import { useTestDraftAudience } from "./test-draft-audience-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function TestStudentAccessForm({
  testId,
  entitlement: _entitlement,
  status,
  readOnly,
}: {
  testId: string;
  entitlement: string;
  status: string;
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const { audience, setAudience, canPublish } = useTestDraftAudience();

  return (
    <div className="grid max-w-xl gap-3">
      <p className="text-sm text-muted-foreground">
        Free and Both store as entitlement=free (subscription never removes
        free access). Neither keeps the test unpublished.
      </p>
      {TEST_STUDENT_AUDIENCE_OPTIONS.map((opt) => (
        <label key={opt.value} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="student-audience"
            checked={audience === opt.value}
            disabled={readOnly || pending}
            onChange={() => setAudience(opt.value)}
          />
          <span>
            <span className="font-medium">{opt.label}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {opt.hint}
            </span>
          </span>
        </label>
      ))}
      {!canPublish && (
        <p className="text-sm text-destructive">
          Neither — do not publish. The Publish button stays disabled until
          you choose Free, Both, or Paid.
        </p>
      )}
      {!readOnly && (
        <Button
          className="w-fit"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (!canPublishToStudents(audience) && status !== "draft") {
                toast.error(
                  "Unpublish is not available here. Keep the test as draft instead."
                );
                return;
              }
              const next = entitlementForTestAudience(audience);
              if (!next) {
                toast.success(
                  "Leave this test as draft so students never see it."
                );
                return;
              }
              const { error } = await setResourceEntitlement(
                "test",
                testId,
                next
              );
              if (error) toast.error(error);
              else toast.success("Student access saved");
            })
          }
        >
          Save student access
        </Button>
      )}
    </div>
  );
}

export function TestPrepGuidelinesForm({
  testId,
  initial,
  readOnly,
}: {
  testId: string;
  initial: string;
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState(initial);
  return (
    <div className="grid max-w-2xl gap-3">
      <Label>Preparation guidelines (optional)</Label>
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={readOnly || pending}
        className="min-h-40"
        placeholder="What students should revise before this test. Visible after they are entitled, including before the window opens and on Test History."
      />
      {!readOnly && (
        <Button
          className="w-fit"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const { error } = await upsertTestPrepGuidelines(testId, body);
              if (error) toast.error(error);
              else toast.success("Guidelines saved");
            })
          }
        >
          Save guidelines
        </Button>
      )}
      {readOnly && (
        <p className="text-sm text-muted-foreground">
          Preparation guidelines freeze after publish, like the rest of the test config.
        </p>
      )}
    </div>
  );
}
