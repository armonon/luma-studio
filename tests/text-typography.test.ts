import assert from "node:assert/strict";
import test from "node:test";
import { pixelAt, testCanvas } from "./canvas-harness.ts";
import { createDocument, createTextLayer } from "../app/engine/document.ts";
import type { TextStyle } from "../app/engine/document.ts";
import { renderClean } from "../app/engine/renderer.ts";

const SIZE = 400;

function render(style: Partial<TextStyle>) {
  const doc = createDocument(SIZE, SIZE);
  doc.layers = [createTextLayer("type", {
    text: "AV",
    font: "40px sans-serif",
    color: "#ffffff",
    align: "left",
    lineHeight: 1.2,
    x: 20,
    y: 60,
    ...style,
  })];
  const target = testCanvas(SIZE, SIZE);
  renderClean(doc, target);
  return target;
}

/** The rightmost column holding any ink, or -1 when the canvas is blank. */
function inkRight(canvas: ReturnType<typeof testCanvas>) {
  for (let x = SIZE - 1; x >= 0; x -= 1) {
    for (let y = 0; y < SIZE; y += 1) if (pixelAt(canvas, x, y).a > 8) return x;
  }
  return -1;
}

/** The lowest row holding any ink, or -1 when the canvas is blank. */
function inkBottom(canvas: ReturnType<typeof testCanvas>) {
  for (let y = SIZE - 1; y >= 0; y -= 1) {
    for (let x = 0; x < SIZE; x += 1) if (pixelAt(canvas, x, y).a > 8) return y;
  }
  return -1;
}

function inkLeft(canvas: ReturnType<typeof testCanvas>) {
  for (let x = 0; x < SIZE; x += 1) {
    for (let y = 0; y < SIZE; y += 1) if (pixelAt(canvas, x, y).a > 8) return x;
  }
  return -1;
}

// --- tracking ---------------------------------------------------------------

test("tracking widens the run and is proportional to the point size", () => {
  const plain = inkRight(render({}));
  const tracked = inkRight(render({ tracking: 200 }));
  assert.ok(tracked > plain + 4, `tracking should push the run wider: ${plain} -> ${tracked}`);

  // 200/1000 em at 40px is 8px between two glyphs; at 80px it is 16px, so the
  // extra width must scale with the font rather than being a fixed pixel step.
  const bigPlain = inkRight(render({ font: "80px sans-serif" }));
  const bigTracked = inkRight(render({ font: "80px sans-serif", tracking: 200 }));
  assert.ok(
    bigTracked - bigPlain > (tracked - plain) * 1.5,
    `tracking should scale with the font: ${tracked - plain}px at 40px vs ${bigTracked - bigPlain}px at 80px`,
  );
});

test("negative tracking tightens the run", () => {
  assert.ok(inkRight(render({ tracking: -100 })) < inkRight(render({})));
});

test("centred text stays on its anchor when tracked", () => {
  // Canvas adds the spacing after the final glyph as well, so an uncorrected
  // centred run drifts left by half a step. Measure how far the ink's midpoint
  // moves rather than trusting the alignment to be free.
  const middle = (tracking: number) => {
    const canvas = render({ align: "center", x: 200, tracking });
    return (inkLeft(canvas) + inkRight(canvas)) / 2;
  };
  assert.ok(Math.abs(middle(300) - middle(0)) <= 2, `centre drifted to ${middle(300)} from ${middle(0)}`);
});

test("vertical type tracks down the column, not across it", () => {
  const plain = render({ layout: "vertical", text: "AV" });
  const tracked = render({ layout: "vertical", text: "AV", tracking: 300 });
  assert.ok(inkBottom(tracked) > inkBottom(plain) + 4, "the column should get taller");
  assert.ok(
    Math.abs(inkRight(tracked) - inkRight(plain)) <= 2,
    "and no wider — horizontal letter spacing is the wrong axis here",
  );

  // Centred is where leaving horizontal letter spacing on would show: each
  // glyph is its own one-character run, and canvas would centre it against a
  // width inflated by a trailing step it never draws.
  const centred = (tracking: number) => {
    const canvas = render({ layout: "vertical", text: "AV", align: "center", x: 200, tracking });
    return (inkLeft(canvas) + inkRight(canvas)) / 2;
  };
  assert.ok(
    Math.abs(centred(300) - centred(0)) <= 2,
    `the column drifted sideways to ${centred(300)} from ${centred(0)}`,
  );
});

// --- paragraph spacing ------------------------------------------------------

test("paragraph spacing separates paragraphs without touching wrapped lines", () => {
  const twoParagraphs = { text: "one\ntwo", font: "20px sans-serif" };
  const tight = inkBottom(render(twoParagraphs));
  const loose = inkBottom(render({ ...twoParagraphs, paragraphSpacing: 1.5 }));
  assert.ok(loose > tight + 10, `the second paragraph should drop: ${tight} -> ${loose}`);

  // A single paragraph has nothing after it to space, so it must not move.
  const single = { text: "one", font: "20px sans-serif" };
  assert.equal(inkBottom(render(single)), inkBottom(render({ ...single, paragraphSpacing: 1.5 })));
});

test("paragraph spacing applies inside a text box too, not just to point text", () => {
  // Two paragraphs that each wrap, so the gap has to land between paragraphs
  // rather than between every line.
  const boxed = {
    text: "the quick brown fox jumps over the lazy dog\nand then it does the whole thing again",
    font: "20px sans-serif",
    layout: "paragraph" as const,
    boxWidth: 200,
    x: 20,
    y: 40,
  };
  const tight = inkBottom(render(boxed));
  const loose = inkBottom(render({ ...boxed, paragraphSpacing: 2 }));
  assert.ok(loose > tight + 20, `the second paragraph should drop: ${tight} -> ${loose}`);
});

// --- justification ----------------------------------------------------------

const PARAGRAPH = {
  text: "the quick brown fox jumps over the lazy dog again and again",
  font: "20px sans-serif",
  layout: "paragraph" as const,
  boxWidth: 300,
  x: 20,
  y: 40,
};

test("justified text reaches the right edge of its box", () => {
  const ragged = inkRight(render(PARAGRAPH));
  const flush = inkRight(render({ ...PARAGRAPH, justify: true }));
  assert.ok(flush > ragged, `justified should extend past the ragged edge: ${ragged} -> ${flush}`);
  assert.ok(
    Math.abs(flush - (PARAGRAPH.x + PARAGRAPH.boxWidth)) < 12,
    `justified lines should end near the measure at ${PARAGRAPH.x + PARAGRAPH.boxWidth}, got ${flush}`,
  );
});

test("the last line of a paragraph is not stretched", () => {
  // One short paragraph is a single line, which is its own last line. Nothing
  // about it should change when justification is switched on.
  const single = { ...PARAGRAPH, text: "short line" };
  assert.equal(inkRight(render({ ...single, justify: true })), inkRight(render(single)));
});

test("a line already wider than the measure is left alone rather than squeezed", () => {
  const narrow = { ...PARAGRAPH, boxWidth: 40, text: "unwrappablesinglewordhere and more" };
  const plain = inkRight(render(narrow));
  const justified = inkRight(render({ ...narrow, justify: true }));
  assert.equal(justified, plain);
});

test("justification lands on the same measure whether or not it is tracked", () => {
  // Word widths are measured with letter spacing on, and that carries a
  // trailing step the word never draws. Whether it is subtracted has to be
  // decided the same way in the sum and in the cursor step: get it right in
  // only one of the two and the line lands a whole tracking step off.
  //
  // Comparing tracked against untracked rather than against the box edge
  // keeps the last glyph's right side bearing out of the assertion.
  const measure = (tracking: number) => inkRight(render({ ...PARAGRAPH, justify: true, tracking }));
  const plain = measure(0);
  for (const tracking of [150, 400]) {
    assert.ok(
      Math.abs(measure(tracking) - plain) <= 2,
      `tracked ${tracking} justified to ${measure(tracking)}, untracked to ${plain}`,
    );
  }
  assert.ok(
    Math.abs(plain - (PARAGRAPH.x + PARAGRAPH.boxWidth)) < 6,
    `and both should be on the measure at ${PARAGRAPH.x + PARAGRAPH.boxWidth}, got ${plain}`,
  );
});

test("the box height still clips overflow, now counting paragraph gaps", () => {
  const tall = { ...PARAGRAPH, boxHeight: 200 };
  const unclipped = inkBottom(render(tall));
  // The same text with a large gap after each paragraph pushes lines past the
  // box; the clip has to notice, or text spills out of its own frame.
  const gapped = inkBottom(render({ ...tall, text: "one\ntwo\nthree\nfour\nfive", paragraphSpacing: 3 }));
  assert.ok(gapped <= tall.y + tall.boxHeight, `clipped text reached ${gapped}, past the box`);
  assert.ok(unclipped > 0, "the control case should have rendered something");
});

test("text with no typography set renders exactly as it did before", () => {
  const bare = render({});
  const explicitDefaults = render({ tracking: 0, paragraphSpacing: 0, justify: false });
  assert.equal(inkRight(bare), inkRight(explicitDefaults));
  assert.equal(inkBottom(bare), inkBottom(explicitDefaults));
});
