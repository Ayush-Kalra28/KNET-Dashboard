import { NextResponse } from "next/server";
import { SECTIONS, buildPrompt } from "../../../lib/sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gemini-3.8-flash";

function cleanJsonText(text) {
  const cleaned = String(text || "").trim();

  const fenced = cleaned.match(
    /```(?:json)?\s*([\s\S]*?)\s*```/i
  );

  return fenced ? fenced[1].trim() : cleaned;
}

function parseModelJson(text) {
  const cleaned = cleanJsonText(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function validateQuestion(question, section) {
  if (!question || typeof question !== "object") {
    return {
      valid: false,
      issues: ["Missing question object"],
    };
  }

  if (section.kind === "profile") {
    const options = Array.isArray(question.options)
      ? question.options
      : [];

    const issues = [];

    if (
      !question.scenario ||
      typeof question.scenario !== "string"
    ) {
      issues.push("Missing scenario");
    }

    if (options.length !== 4) {
      issues.push("Must contain exactly four options");
    }

    for (const option of options) {
      if (
        !option ||
        typeof option.text !== "string" ||
        typeof option.trait !== "string"
      ) {
        issues.push("Invalid profile option format");
        break;
      }
    }

    const uniqueOptions = new Set(
      options.map((option) =>
        option.text.trim().toLowerCase()
      )
    );

    if (uniqueOptions.size !== options.length) {
      issues.push("Duplicate options");
    }

    if (
      !question.insight ||
      typeof question.insight !== "string"
    ) {
      issues.push("Missing insight");
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  const options = Array.isArray(question.options)
    ? question.options
    : [];

  const issues = [];

  if (
    !question.question ||
    typeof question.question !== "string"
  ) {
    issues.push("Missing question text");
  }

  if (options.length !== 4) {
    issues.push("Must contain exactly four options");
  }

  if (
    options.some(
      (option) =>
        typeof option !== "string" ||
        !option.trim()
    )
  ) {
    issues.push("Invalid option");
  }

  const uniqueOptions = new Set(
    options.map((option) =>
      option.trim().toLowerCase()
    )
  );

  if (uniqueOptions.size !== options.length) {
    issues.push("Duplicate options");
  }

  if (
    !Number.isInteger(question.correctIndex) ||
    question.correctIndex < 0 ||
    question.correctIndex > 3
  ) {
    issues.push("Invalid correctIndex");
  }

  if (
    !question.explanation ||
    typeof question.explanation !== "string"
  ) {
    issues.push("Missing explanation");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function getBlueprint(section) {
  const questionTypes =
    section.questionTypes || ["rule_application"];

  const skills =
    section.skills || ["reasoning"];

  const questionType =
    questionTypes[
      Math.floor(Math.random() * questionTypes.length)
    ];

  const skill =
    skills[
      Math.floor(Math.random() * skills.length)
    ];

  return {
    questionType,
    skill,
    difficulty:
      section.kind === "profile" ? 6 : 7,
    reasoningDepth:
      section.kind === "profile" ? 1 : 3,
    distractorStrategy:
      [
        "partial-rule application",
        "single-rule shortcut",
        "misreading a condition",
        "reversing a relationship",
      ][
        Math.floor(Math.random() * 4)
      ],
  };
}

async function callGemini(apiKey, prompt) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `Gemini API error ${response.status}: ${responseText.slice(
        0,
        1000
      )}`
    );
  }

  let data;

  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(
      `Gemini returned a non-JSON response: ${responseText.slice(
        0,
        500
      )}`
    );
  }

  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n") || ""
  );
}

function buildGenerationPrompt(section, blueprint) {
  return `
You are an expert aptitude-test item writer creating
an original KNET-style practice question.

SECTION:
${section.label}

BLUEPRINT:
${JSON.stringify(blueprint)}

${buildPrompt(section, blueprint)}

QUALITY REQUIREMENTS:

1. Create exactly ONE original question.
2. There must be exactly one defensible answer.
3. Everything needed to solve the question must be supplied.
4. Do not require outside factual knowledge.
5. Test reasoning and comprehension rather than difficult vocabulary.
6. The answer must not be obtainable through simple keyword matching.
7. Do not directly repeat a phrase from the passage as the answer.
8. Use multiple relevant pieces of information where appropriate.
9. Wrong options must be plausible.
10. At least two distractors must represent realistic reasoning mistakes.
11. Do not make the question difficult merely by making it longer.
12. Avoid ambiguity.
13. Keep the question appropriate for a timed aptitude assessment.
14. Follow the requested difficulty and reasoning depth.
15. Check the answer yourself before returning it.

Return ONLY valid JSON.

For scored sections:

{
  "topic": "...",
  "question": "...",
  "options": [
    "...",
    "...",
    "...",
    "..."
  ],
  "correctIndex": 0,
  "explanation": "...",
  "patternNote": "...",
  "questionType": "...",
  "difficulty": 7,
  "reasoningDepth": 3,
  "skill": "..."
}

For profile sections, use the format specified by
the section instructions.
`;
}

export async function POST(req) {
  try {
    let body;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          error: "Invalid request body",
        },
        { status: 400 }
      );
    }

    const section = SECTIONS.find(
      (item) => item.id === body.sectionId
    );

    if (!section) {
      return NextResponse.json(
        {
          error: "Unknown section",
        },
        { status: 400 }
      );
    }

    const apiKey =
      body.apiKey ||
      process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "No Gemini API key found. Add your Gemini API key in Settings.",
        },
        { status: 400 }
      );
    }

    const blueprint =
      getBlueprint(section);

    const prompt =
      buildGenerationPrompt(
        section,
        blueprint
      );

    const rawResponse =
      await callGemini(
        apiKey,
        prompt
      );

    const question =
      parseModelJson(rawResponse);

    if (!question) {
      return NextResponse.json(
        {
          error:
            "Gemini returned invalid JSON.",
        },
        { status: 502 }
      );
    }

    const validation =
      validateQuestion(
        question,
        section
      );

    if (!validation.valid) {
      return NextResponse.json(
        {
          error:
            "Generated question failed validation: " +
            validation.issues.join("; "),
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        question,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store, max-age=0",
        },
      }
    );
  } catch (error) {
    const message =
      error?.message ||
      "Unexpected server error";

    const status =
      message.includes("Gemini API error 429")
        ? 429
        : message.includes("Gemini API error 4")
          ? 400
          : 500;

    return NextResponse.json(
      {
        error: message,
      },
      { status }
    );
  }
}