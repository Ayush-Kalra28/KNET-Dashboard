import { NextResponse } from "next/server";
import { SECTIONS, buildPrompt } from "../../../lib/sections";

const MODEL = "gemini-2.5-flash";
const MAX_GENERATION_ATTEMPTS = 3;

function cleanJsonText(text) {
  const cleaned = String(text || "").trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1].trim() : cleaned;
}

function parseModelJson(text) {
  const cleaned = cleanJsonText(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function validateQuestion(question, section) {
  if (!question || typeof question !== "object") return { valid: false, issues: ["Missing question object"] };
  if (section.kind === "profile") {
    const options = Array.isArray(question.options) ? question.options : [];
    const issues = [];
    if (!question.scenario || typeof question.scenario !== "string") issues.push("Missing scenario");
    if (options.length !== 4) issues.push("Must have exactly four options");
    if (options.some((o) => !o || typeof o.text !== "string" || typeof o.trait !== "string")) issues.push("Invalid profile option shape");
    if (new Set(options.map((o) => o.text?.trim().toLowerCase())).size !== options.length) issues.push("Duplicate options");
    if (!question.insight || typeof question.insight !== "string") issues.push("Missing insight");
    return { valid: issues.length === 0, issues };
  }

  const options = Array.isArray(question.options) ? question.options : [];
  const issues = [];
  if (!question.question || typeof question.question !== "string") issues.push("Missing question text");
  if (options.length !== 4) issues.push("Must have exactly four options");
  if (options.some((o) => typeof o !== "string" || !o.trim())) issues.push("Invalid option");
  if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) issues.push("Duplicate options");
  if (!Number.isInteger(question.correctIndex) || question.correctIndex < 0 || question.correctIndex > 3) issues.push("Invalid correctIndex");
  if (!question.explanation || typeof question.explanation !== "string") issues.push("Missing explanation");
  return { valid: issues.length === 0, issues };
}

async function callGemini(apiKey, prompt, useSearch = false, temperature = 0.75) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
    },
  };
  if (useSearch) payload.tools = [{ google_search: {} }];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") || "";
}

function makeBlueprint(section, attempt) {
  const difficulty = section.kind === "profile" ? 6 : Math.min(8, 7 + (attempt % 2));
  const type = section.questionTypes[attempt % section.questionTypes.length];
  const skill = section.skills[attempt % section.skills.length];
  const reasoningDepth = section.kind === "profile" ? 1 : 3 + (attempt % 2);
  const distractorStrategies = [
    "one-step shortcut, one partial-rule application, one reversal of a relationship",
    "correct use of one rule but failure to combine it with the second rule, plus two plausible inference errors",
    "confusion between necessary and sufficient conditions, overlooking an exception, and using an irrelevant fact",
  ];
  return {
    questionType: type,
    difficulty,
    reasoningDepth,
    skill,
    distractorStrategy: distractorStrategies[attempt % distractorStrategies.length],
  };
}

async function validateWithModel(apiKey, question, section, blueprint) {
  const prompt = `You are a ruthless quality auditor for a KNET-style aptitude question.

Audit the following generated item against the blueprint and return JSON only.

BLUEPRINT
${JSON.stringify(blueprint)}

ITEM
${JSON.stringify(question)}

CHECK ALL OF THESE:
1. Exactly one defensible answer for scored questions.
2. All required information is present in the item itself.
3. The answer requires genuine comprehension/reasoning rather than keyword matching.
4. The target difficulty is plausible for the requested level.
5. The requested reasoning depth is actually present.
6. Distractors are plausible and correspond to realistic reasoning mistakes.
7. No ambiguity, contradiction, accidental alternate answer, or missing condition.
8. The explanation supports the keyed answer.
9. The item is concise and natural for a timed aptitude test.
10. It is original in wording and scenario.

For psychometric items, do not demand a single correct answer; instead verify that all four actions are plausible and meaningfully distinct.

Return exactly:
{"valid":true,"issues":[],"difficulty":7,"reasoningDepth":3,"keywordSolvable":false,"ambiguity":0,"distractorQuality":8,"needsRevision":false}`;

  const text = await callGemini(apiKey, prompt, false, 0.15);
  const audit = parseModelJson(text);
  if (!audit) return { valid: false, issues: ["Validator returned invalid JSON"] };
  return audit;
}

async function reviseQuestion(apiKey, question, audit, section, blueprint) {
  const prompt = `Revise this KNET-style aptitude item so it passes the quality audit.

SECTION: ${section.label}
BLUEPRINT: ${JSON.stringify(blueprint)}
CURRENT ITEM: ${JSON.stringify(question)}
AUDIT: ${JSON.stringify(audit)}

Fix every listed issue. Preserve the required output shape. Do not add unnecessary complexity. Make the reasoning genuine rather than vocabulary-heavy. Ensure exactly one defensible answer for scored sections and plausible, distinct options.

Return ONLY valid JSON.`;
  const text = await callGemini(apiKey, prompt, false, 0.45);
  return parseModelJson(text);
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const section = SECTIONS.find((s) => s.id === body.sectionId);
  if (!section) return NextResponse.json({ error: "Unknown section" }, { status: 400 });

  const apiKey = body.apiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Gemini API key found. Add one in the Settings panel, or set GEMINI_API_KEY on the server." },
      { status: 400 }
    );
  }

  try {
    let lastIssues = [];

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const blueprint = makeBlueprint(section, attempt);
      const researchInstruction = `Use Google Search only to understand broad question style and assessment patterns for ${section.label}. Do not copy any source question or wording.`;
      const generationPrompt = `${researchInstruction}\n\n${buildPrompt(section, blueprint)}\n\nOutput raw JSON only.`;

      const text = await callGemini(apiKey, generationPrompt, true, 0.75);
      let question = parseModelJson(text);
      let structural = validateQuestion(question, section);
      if (!structural.valid) {
        lastIssues = structural.issues;
        continue;
      }

      let audit = await validateWithModel(apiKey, question, section, blueprint);
      if (audit.valid && !audit.needsRevision && audit.keywordSolvable === false && Number(audit.ambiguity || 0) <= 2) {
        return NextResponse.json({ question });
      }

      lastIssues = audit.issues || ["Question did not pass quality audit"];
      question = await reviseQuestion(apiKey, question, audit, section, blueprint);
      structural = validateQuestion(question, section);
      if (!structural.valid) {
        lastIssues = structural.issues;
        continue;
      }

      audit = await validateWithModel(apiKey, question, section, blueprint);
      if (audit.valid && !audit.needsRevision && audit.keywordSolvable === false && Number(audit.ambiguity || 0) <= 2) {
        return NextResponse.json({ question });
      }
      lastIssues = audit.issues || ["Revised question did not pass quality audit"];
    }

    return NextResponse.json(
      { error: `Could not produce a sufficiently reliable question after ${MAX_GENERATION_ATTEMPTS} attempts. ${lastIssues.join("; ")}` },
      { status: 502 }
    );
  } catch (e) {
    return NextResponse.json({ error: e.message || "Unexpected server error" }, { status: 500 });
  }
}
