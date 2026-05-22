import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")!;

const ENDPOINT = `${SUPABASE_URL}/functions/v1/grade-ela`;

// Source passage: clearly about SENTIMENTAL value (a grandmother's worn locket).
const SOURCE_PASSAGE = `The Locket

When Maya's grandmother passed away, she left behind a small, tarnished silver locket.
The chain was broken in two places and the clasp barely worked. A jeweler had once
told the family it was worth almost nothing — perhaps five dollars in scrap. But to
Maya, the locket was priceless. Inside it was a tiny photograph of her grandmother as
a young woman, taken the day she arrived in this country with nothing but a suitcase
and a dream. Maya wore the locket every day, not because of what it was made of, but
because of who it had belonged to and what it represented: courage, love, and the long
journey that had made her family possible.`;

// Student response that misreads the passage as being about MONETARY value,
// and fabricates a quote that does not appear in the source.
const STUDENT_WORK_MISREAD = `In the story "The Locket," the author shows how valuable
the locket is because it is made of expensive silver and worth a lot of money. The
story says "the locket was extremely valuable and worth thousands of dollars," which
proves that Maya kept it because it would make her rich one day. The main theme of the
story is that old jewelry is a good financial investment and people should hold onto
valuables because they increase in price over time.`;

Deno.test({
  name: "grade-ela echoes source_material_meta with filenames and char count",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        student_work: STUDENT_WORK_MISREAD,
        student_name: "Test Student",
        grade_level: "7th Grade",
        assignment_type: "Literary Response",
        assignment_doc_text: SOURCE_PASSAGE,
        source_material_filenames: ["the-locket.pdf"],
        dry_run: true,
      }),
    });

    assertEquals(res.status, 200);
    const data = await res.json();

    console.log("source_material_meta:", data.source_material_meta);
    console.log("score:", data.score, "percent:", data.percent);
    console.log("teacher_notes:", data.teacher_notes);

    assertEquals(data.dry_run, true);
    assert(data.source_material_meta, "expected source_material_meta in response");
    assertEquals(data.source_material_meta.sourceMaterialUsed, true);
    assertEquals(
      data.source_material_meta.sourceMaterialCharacterCount,
      SOURCE_PASSAGE.length,
    );
    assertEquals(data.source_material_meta.sourceMaterialFileNames, ["the-locket.pdf"]);
  },
});

Deno.test({
  name: "grade-ela detects misread + false quote when source material is provided",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        student_work: STUDENT_WORK_MISREAD,
        student_name: "Test Student",
        grade_level: "7th Grade",
        assignment_type: "Literary Response",
        assignment_doc_text: SOURCE_PASSAGE,
        source_material_filenames: ["the-locket.pdf"],
        dry_run: true,
      }),
    });

    assertEquals(res.status, 200);
    const data = await res.json();

    const allFeedback = [
      data.teacher_notes ?? "",
      ...(data.areas_for_improvement ?? []),
      ...(data.strengths ?? []),
      data.next_step ?? "",
      JSON.stringify(data.criterion_breakdown ?? []),
    ].join("\n").toLowerCase();

    console.log("---- feedback ----");
    console.log(allFeedback);
    console.log("---- /feedback ----");

    // Should flag the misread (sentimental vs monetary) somewhere in feedback.
    const flagsMisread =
      /misread|misinterpret|misunderstand|fundamental misread|sentimental|not about money|does not say|fabricat|false quote|unsupported|inaccurate/i
        .test(allFeedback);
    assert(
      flagsMisread,
      "expected feedback to flag the misread / false quote when source material is provided",
    );

    // Percent should reflect the misread (below 65 per calibration rules).
    if (typeof data.percent === "number") {
      assert(
        data.percent < 65,
        `expected percent < 65 for a fundamental misread, got ${data.percent}`,
      );
    }
  },
});
