/**
 * Content adapters — load Question Bank / pearl_points rows without duplication.
 * Progress state lives in PracticeProgressStore (Data Spine), not here.
 */

import type { PracticeItemKind, PracticeScope } from "./types.ts";

export type PracticeMcqContent = {
  itemId: string;
  itemKind: "mcq";
  questionVersionId: string;
  stem: string;
  options: { key: string; text: string }[];
  difficulty: string;
};

export type PracticePearlContent = {
  itemId: string;
  itemKind: "pearl";
  prompt: string;
  subjectId: string;
  subjectName?: string | null;
  accessible: boolean;
};

export type PracticeAnswerFeedback = {
  isCorrect: boolean;
  correctKey: string;
  explanation: string;
  reference: string;
};

export type PearlRevealPayload = {
  answer: string;
  explanation: string;
};

/** Lists item ids in a practice folder/scope. Data Spine may replace this. */
export interface PracticeCatalogAdapter {
  listItemIds(scope: PracticeScope): Promise<string[]>;
}

/** Fetches MCQ payload from Question Bank (current approved version). */
export interface PracticeMcqContentAdapter {
  loadBatch(
    scope: PracticeScope,
    limit: number
  ): Promise<PracticeMcqContent[]>;
  submitAnswer(
    questionVersionId: string,
    selectedKey: string
  ): Promise<PracticeAnswerFeedback>;
}

export interface PracticePearlContentAdapter {
  reveal(pearlId: string): Promise<PearlRevealPayload>;
}

export type ProgressAwareItem = {
  itemId: string;
  itemKind: PracticeItemKind;
};
