import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  folderRoundCompleteHint,
  isMcqBankFolderPracticeScope,
  MCQ_FOLDER_PRACTICE_BATCH_SIZE,
  practiceSessionMeterLabel,
  practiceSessionPositionLabel,
  practiceSetEmptyCopy,
} from "../../src/lib/practice/session-labels.ts";

describe("MCQ practice session labels", () => {
  it("labels folder scopes as This round, not Folder complete", () => {
    assert.equal(practiceSessionMeterLabel("mcq_bank_folder"), "This round");
    assert.equal(
      practiceSessionMeterLabel("mcq_bank_folder_favorites"),
      "This round"
    );
    assert.equal(
      practiceSessionMeterLabel("mcq_bank_folder_incorrect"),
      "This round"
    );
    assert.equal(practiceSessionMeterLabel("subject"), "Session progress");
  });

  it("positions folder batch as in this round", () => {
    assert.equal(
      practiceSessionPositionLabel({
        index: 0,
        filteredLength: 50,
        scopeType: "mcq_bank_folder",
      }),
      "1 of 50 in this round"
    );
    assert.equal(
      practiceSessionPositionLabel({
        index: 2,
        filteredLength: 10,
        scopeType: "topic",
      }),
      "3 of 10"
    );
  });

  it("distinguishes empty vs cleared Favorites/Incorrect copy", () => {
    const emptyFav = practiceSetEmptyCopy({
      mode: "favorites",
      clearedThisSession: false,
    });
    const clearedFav = practiceSetEmptyCopy({
      mode: "favorites",
      clearedThisSession: true,
    });
    assert.match(emptyFav.body, /yet/i);
    assert.match(clearedFav.title, /complete/i);

    const emptyInc = practiceSetEmptyCopy({
      mode: "incorrect",
      clearedThisSession: false,
    });
    const clearedInc = practiceSetEmptyCopy({
      mode: "incorrect",
      clearedThisSession: true,
    });
    assert.match(emptyInc.title, /No incorrect/i);
    assert.match(clearedInc.title, /cleared/i);
  });

  it("hints when a folder round finishes with remaining outside the batch", () => {
    assert.equal(MCQ_FOLDER_PRACTICE_BATCH_SIZE, 50);
    assert.ok(isMcqBankFolderPracticeScope("mcq_bank_folder"));
    const withMore = folderRoundCompleteHint({
      folderRemaining: 70,
      loadedCount: 50,
    });
    assert.match(withMore ?? "", /70 unfinished/);
    const exactBatchUnknown = folderRoundCompleteHint({
      folderRemaining: null,
      loadedCount: 50,
    });
    assert.match(exactBatchUnknown ?? "", /Return to the folder/);
    const finished = folderRoundCompleteHint({
      folderRemaining: 0,
      loadedCount: 12,
    });
    assert.match(finished ?? "", /every unfinished/);
  });
});
