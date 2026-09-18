import { NextResponse } from "next/server";
import { SECTIONS, buildPrompt } from "../../../lib/sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gemini-3.8-flash";
const GEMINI_TIMEOUT_MS = 20000;

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
      Math.floor(
        Math.random() * questionTypes.length
      )
    ];

  const skill =
    skills[
      Math.floor(
        Math.random() * skills.length
      )
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
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, GEMINI_TIMEOUT_MS);

  try {
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

        // Keep generation fast enough for Netlify.
        maxOutputTokens: 1400,

        // Gemini 3.8 supports low / medium / high.
        // Low is sufficient for question generation
        // and substantially reduces latency.
        thinkingConfig: {
          thinkingLevel: "low",
        },
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
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

    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("\n") || "";

    if (!text) {
      throw new Error(
        "Gemini returned an empty response."
      );
    }

    return text;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Gemini took too long to respond. The request was stopped before Netlify's timeout."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildGenerationPrompt(section, blueprint) {
  return `
You are an expert aptitude-test item writer.

Create ONE original KNET-style practice question.

SECTION:
${section.label}

BLUEPRINT:
${JSON.stringify(blueprint)}

${buildPrompt(section, blueprint)}

IMPORTANT:

- Create exactly ONE question.
- Make it self-contained.
- Exactly one defensible answer for scored sections.
- Do not require outside knowledge.
- Test comprehension and reasoning, not vocabulary.
- Do not make the answer solvable through keyword matching.
- Do not simply repeat wording from the passage.
- Use multiple relevant pieces of information when appropriate.
- Make distractors plausible and based on realistic reasoning mistakes.
- Do not use ambiguous wording.
- Do not make difficulty come only from passage length.
- Keep it suitable for a timed aptitude test.
- Mentally solve it before returning the answer.
- Return ONLY valid JSON.

For scored sections return:

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

For profile sections return the exact format
specified by the section instructions.
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
          error: "Invalid request body.",
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
          error: "Unknown section.",
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
      "Unexpected server error.";

    let status = 500;

    if (
      message.includes(
        "Gemini API error 429"
      )
    ) {
      status = 429;
    } else if (
      message.includes(
        "Gemini API error 4"
      )
    ) {
      status = 400;
    } else if (
      message.includes(
        "took too long"
      )
    ) {
      status = 504;
    }

    return NextResponse.json(
      {
        error: message,
      },
      { status }
    );
  }
}