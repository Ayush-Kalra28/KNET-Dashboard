import { NextResponse } from "next/server";
import { SECTIONS, buildPrompt } from "../../../lib/sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "gemini-3.8-flash";

// Keep this below Netlify's function execution window while
// allowing Gemini much more time than the previous 20-second cutoff.
const GEMINI_TIMEOUT_MS = 55_000;

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

  // Psychometric / profile questions
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

  // Scored question validation
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
    section.questionTypes?.length
      ? section.questionTypes
      : ["rule_application"];

  const skills =
    section.skills?.length
      ? section.skills
      : ["reasoning"];

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

  const distractorStrategies = [
    "partial-rule application",
    "single-rule shortcut",
    "misreading a condition",
    "reversing a relationship",
  ];

  return {
    questionType,
    skill,

    // Keep the normal practice target around medium-hard.
    difficulty:
      section.kind === "profile" ? 6 : 7,

    reasoningDepth:
      section.kind === "profile" ? 1 : 3,

    distractorStrategy:
      distractorStrategies[
        Math.floor(
          Math.random() *
            distractorStrategies.length
        )
      ],
  };
}

function buildGenerationPrompt(
  section,
  blueprint
) {
  return `
You are an expert aptitude-test item writer.

Create ONE original KNET-style practice question.

SECTION:
${section.label}

BLUEPRINT:
${JSON.stringify(blueprint)}

${buildPrompt(section, blueprint)}

QUALITY REQUIREMENTS

1. Create exactly ONE original question.
2. There must be exactly one defensible answer for scored sections.
3. Everything required to solve the question must be supplied.
4. Do not require outside factual knowledge.
5. Test comprehension and reasoning, not difficult vocabulary.
6. The answer must NOT be obtainable through simple keyword matching.
7. Do not simply repeat a phrase from the passage in the question.
8. Use multiple relevant pieces of information where appropriate.
9. Wrong options must be plausible.
10. At least two distractors must represent realistic reasoning mistakes.
11. Do not make difficulty come only from passage length.
12. Avoid ambiguity and trick wording.
13. Keep the item suitable for a timed aptitude assessment.
14. Follow the requested difficulty and reasoning depth.
15. Make the scenario original.
16. Mentally solve the question before returning the answer.
17. Return ONLY valid JSON.
18. Do NOT use Markdown code fences.

For scored sections return exactly:

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

For profile sections return exactly the format
specified by the section instructions.
`;
}

/*
 * Gemini streaming endpoint
 *
 * Gemini sends Server-Sent Events.
 * We convert those events into newline-delimited JSON
 * messages that the browser can consume immediately.
 */
async function streamGemini(
  apiKey,
  prompt,
  send
) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, GEMINI_TIMEOUT_MS);

  try {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${MODEL}:streamGenerateContent?alt=sse`;

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

        // Enough room for a complete question,
        // while preventing unnecessarily huge responses.
        maxOutputTokens: 1600,

        // Keep reasoning efficient without forcing
        // the model to rush the actual question writing.
        thinkingConfig: {
          thinkingLevel: "low",
        },
      },
    };

    const response = await fetch(url, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },

      body: JSON.stringify(payload),

      signal: controller.signal,
    });

    const contentType =
      response.headers.get("content-type") || "";

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => "");

      throw new Error(
        `Gemini API error ${response.status}: ${errorText.slice(
          0,
          1200
        )}`
      );
    }

    if (!response.body) {
      throw new Error(
        "Gemini did not return a streaming response."
      );
    }

    if (
      !contentType.includes("text/event-stream")
    ) {
      // Gemini should normally return SSE here.
      // We still attempt to read the body instead of
      // immediately failing if the provider changes headers.
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let lineBuffer = "";
    let fullText = "";

    const processLine = async (rawLine) => {
      const line =
        rawLine.replace(/\r$/, "");

      if (!line.startsWith("data:")) {
        return;
      }

      const jsonText =
        line.slice(5).trim();

      if (
        !jsonText ||
        jsonText === "[DONE]"
      ) {
        return;
      }

      let chunk;

      try {
        chunk = JSON.parse(jsonText);
      } catch {
        // Ignore malformed/incomplete SSE lines.
        return;
      }

      const textParts =
        chunk.candidates?.[0]?.content?.parts
          ?.map(
            (part) =>
              typeof part.text === "string"
                ? part.text
                : ""
          )
          .join("") || "";

      if (!textParts) {
        return;
      }

      fullText += textParts;

      // Send every generated piece immediately.
      await send({
        type: "chunk",
        text: textParts,
      });
    };

    while (true) {
      const { value, done } =
        await reader.read();

      if (done) {
        break;
      }

      lineBuffer += decoder.decode(
        value,
        { stream: true }
      );

      const lines =
        lineBuffer.split("\n");

      lineBuffer =
        lines.pop() || "";

      for (const line of lines) {
        await processLine(line);
      }
    }

    // Flush decoder.
    lineBuffer += decoder.decode();

    if (lineBuffer.trim()) {
      await processLine(lineBuffer);
    }

    return fullText;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Gemini exceeded the 55-second generation window."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req) {
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
    (item) =>
      item.id === body.sectionId
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

  const encoder =
    new TextEncoder();

  const stream =
    new ReadableStream({
      async start(controller) {
        const send = async (payload) => {
          controller.enqueue(
            encoder.encode(
              JSON.stringify(payload) +
                "\n"
            )
          );
        };

        try {
          // Immediately establish the streaming response.
          await send({
            type: "status",
            message:
              "Starting question generation...",
          });

          const blueprint =
            getBlueprint(section);

          await send({
            type: "status",
            message:
              `Building a ${blueprint.difficulty}/10 ${blueprint.questionType.replaceAll(
                "_",
                " "
              )} question...`,
          });

          const prompt =
            buildGenerationPrompt(
              section,
              blueprint
            );

          await send({
            type: "status",
            message:
              "Gemini is writing the question...",
          });

          const rawText =
            await streamGemini(
              apiKey,
              prompt,
              send
            );

          await send({
            type: "status",
            message:
              "Checking question structure...",
          });

          const question =
            parseModelJson(rawText);

          if (!question) {
            throw new Error(
              "Gemini completed generation, but the response was not valid JSON."
            );
          }

          const validation =
            validateQuestion(
              question,
              section
            );

          if (!validation.valid) {
            throw new Error(
              "Generated question failed validation: " +
                validation.issues.join(
                  "; "
                )
            );
          }

          await send({
            type: "complete",
            question,
          });

          controller.close();
        } catch (error) {
          await send({
            type: "error",
            error:
              error?.message ||
              "Unexpected server error.",
          });

          controller.close();
        }
      },
    });

  return new Response(stream, {
    status: 200,

    headers: {
      "Content-Type":
        "application/x-ndjson; charset=utf-8",

      "Cache-Control":
        "no-cache, no-store, must-revalidate",

      "X-Accel-Buffering":
        "no",

      Connection: "keep-alive",
    },
  });
}