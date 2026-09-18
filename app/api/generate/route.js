import { NextResponse } from "next/server";
import { SECTIONS, buildPrompt } from "../../../lib/sections";

// Use a current Flash model.
// Keep this fixed so an outdated GEMINI_MODEL environment variable
// cannot override it.
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
      return JSON.parse(
        cleaned.slice(start, end + 1)
      );
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

  // Psychometric/profile section
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
      options.map((o) =>
        o.text.trim().toLowerCase()
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
    `${MODEL}:generateContent?key=${apiKey}`;

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

  if (!response.ok) {
    const errorText = await response
      .text()
      .catch(() => "");

    throw new Error(
      `Gemini API error ${response.status}: ${errorText.slice(
        0,
        700
      )}`
    );
  }

  const data = await response.json();

  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n") || ""
  );
}

function buildGenerationPrompt(section, blueprint) {
  return `
You are an expert aptitude-test item writer creating
original KNET-style practice questions.

SECTION
${section.label}

BLUEPRINT
${JSON.stringify(blueprint)}

${buildPrompt(section, blueprint)}

IMPORTANT QUALITY RULES

1. Create exactly ONE original question.
2. There must be exactly one defensible answer.
3. Do not require outside factual knowledge.
4. Everything needed to solve the question must be supplied.
5. Test comprehension and reasoning, not difficult vocabulary.
6. The answer must NOT be obtainable by simple keyword matching.
7. Do not simply repeat wording from the passage in the question.
8. Use multiple relevant pieces of information where appropriate.
9. Wrong options must be plausible.
10. Each distractor should correspond to a realistic reasoning mistake.
11. Do not make a question harder merely by making the passage longer.
12. Keep the language natural and suitable for a timed aptitude test.
13. Avoid ambiguity and trick wording.
14. Follow the requested difficulty and reasoning depth.
15. Recheck your own answer before returning the JSON.

For scored questions use:

{
  "question": "...",
  "options": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "explanation": "...",
  "difficulty": 7,
  "questionType": "...",
  "skill": "...",
  "reasoningDepth": 3
}

For profile/psychometric sections use the format
required by the section instead.

Return ONLY valid JSON.
`;
}

export async function POST(req) {
  let body;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid request body",
      },
      {
        status: 400,
      }
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
      {
        status: 400,
      }
    );
  }

  const apiKey =
    body.apiKey ||
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No Gemini API key found. Add one in Settings or configure GEMINI_API_KEY in Netlify.",
      },
      {
        status: 400,
      }
    );
  }

  try {
    const blueprint =
      getBlueprint(section);

    const prompt =
      buildGenerationPrompt(
        section,
        blueprint
      );

    // ONE Gemini request per question.
    const rawResponse =
      await callGemini(
        apiKey,
        prompt
      );

    const question =
      parseModelJson(rawResponse);

    const validation =
      validateQuestion(
        question,
        section
      );

    if (!validation.valid) {
      return NextResponse.json(
        {
          error:
            "Gemini returned an invalid question: " +
            validation.issues.join("; "),
        },
        {
          status: 502,
        }
      );
    }

    return NextResponse.json({
      question,
    });
  } catch (error) {
    const message =
      error?.message ||
      "Unexpected server error";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status:
          message.includes(
            "Gemini API error 429"
          )
            ? 429
            : 500,
      }
    );
  }
}