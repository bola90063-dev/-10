import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LATHAWIYA_TARGETS,
  LATHAWIYA_WORD_BANK,
  buildSequentialWordsSession,
  buildWordsRound,
  getTargetTokenIndices,
  tokenizeLathawiya,
} from './lathawiyaChallenge';

test('tokenizeLathawiya attaches diacritics and marks ث ذ ظ as targets', () => {
  const units = tokenizeLathawiya('ذَهَب');
  assert.equal(units.length, 3);
  assert.equal(units[0].base, 'ذ');
  assert.equal(units[0].extra, 'َ');
  assert.equal(units[0].isTarget, true);
  assert.equal(units[1].isTarget, false);
  assert.equal(units[2].isTarget, false);
});

test('LATHAWIYA_WORD_BANK has accurate has flags matching target letters', () => {
  for (const item of LATHAWIYA_WORD_BANK) {
    const hasTargetLetter = tokenizeLathawiya(item.w).some((u) => u.isTarget);
    assert.equal(hasTargetLetter, item.has, `Mismatch for word ${item.w}`);
  }
});

test('buildWordsRound produces 8 cards with 3 target words (one per ث/ذ/ظ) and 5 distractors', () => {
  const round = buildWordsRound(LATHAWIYA_WORD_BANK, 5);
  assert.equal(round.length, 8);

  const targets = round.filter((item) => item.has);
  const distractors = round.filter((item) => !item.has);
  assert.equal(targets.length, 3);
  assert.equal(distractors.length, 5);

  for (const letter of LATHAWIYA_TARGETS) {
    assert.ok(
      targets.some((t) => t.w.includes(letter)),
      `Round should include a word with ${letter}`
    );
  }
});

test('getTargetTokenIndices and buildSequentialWordsSession produce 8 balanced examples', () => {
  const session = buildSequentialWordsSession(LATHAWIYA_WORD_BANK, 2, 2);
  assert.equal(session.length, 8);
  assert.equal(session.filter((item) => item.has).length, 6);
  assert.equal(session.filter((item) => !item.has).length, 2);

  const units = tokenizeLathawiya('لَذِيذ');
  assert.deepEqual(getTargetTokenIndices(units), [1, 3]);
  assert.deepEqual(getTargetTokenIndices(tokenizeLathawiya('قَمَر')), []);
});
