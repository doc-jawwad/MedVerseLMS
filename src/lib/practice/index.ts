export type {
  PracticeDeckItem,
  PracticeFilter,
  PracticeFilterCounts,
  PracticeItemKind,
  PracticeItemState,
  PracticeProgressRecord,
  PracticeScope,
  PracticeScopeType,
  PracticeSessionReport,
  PracticeSessionStats,
} from "./types.ts";

export {
  PRACTICE_SCOPE_TYPES,
  isPracticeScopeType,
} from "./types.ts";

export {
  parsePracticeScopeParam,
  practiceBatchAccessMessage,
} from "./scope.ts";

export type { PracticeProgressStore } from "./progress-store.ts";
export { progressKey } from "./progress-store.ts";
export { createMemoryProgressStore } from "./memory-progress-store.ts";
export { createLocalProgressStore } from "./local-progress-store.ts";
export {
  createSpineProgressStore,
  toSpineItemKind,
  fromSpineItemKind,
  startPracticeSessionRpc,
  endPracticeSessionRpc,
} from "./spine-progress-store.ts";

export {
  accuracyPercent,
  buildSessionReport,
  bumpSessionStats,
  clampIndex,
  completionPercent,
  deckCompletionPercent,
  defaultProgressRecord,
  filterCounts,
  filterDeck,
  markItemDone,
  matchesFilter,
  mergeDeck,
  navigateIndex,
  orderItemIds,
  replaceDeckItem,
  resetDoneInDeck,
  resolveIndexAfterChange,
  setItemMarked,
  setItemState,
  shuffleIds,
  toggleItemMarked,
} from "./engine.ts";

export {
  elapsedMs,
  formatElapsed,
  formatReportDuration,
} from "./timer.ts";

export type {
  PracticeAnswerFeedback,
  PracticeCatalogAdapter,
  PracticeMcqContent,
  PracticeMcqContentAdapter,
  PracticePearlContent,
  PracticePearlContentAdapter,
  PearlRevealPayload,
} from "./content.ts";
