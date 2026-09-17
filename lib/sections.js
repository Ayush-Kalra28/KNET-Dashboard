export const SECTIONS = [
  {
    id: "learnability",
    label: "Learnability & Comprehension",
    short: "Learnability",
    query: "reading comprehension and learnability aptitude test",
    kind: "scored",
    accent: "#C68A1F",
    questionTypes: [
      "rule_application",
      "multi_rule_application",
      "inference",
      "conditional_reasoning",
      "information_filtering",
      "exception_detection",
      "process_understanding",
      "counterfactual_application",
    ],
    skills: [
      "extracting rules",
      "applying multiple conditions",
      "making evidence-based inferences",
      "distinguishing relevant from irrelevant information",
      "handling exceptions",
      "understanding procedures",
      "reasoning about hypothetical changes",
    ],
  },
  {
    id: "problem-solving",
    label: "Problem Solving (Logical & Analytical)",
    short: "Problem Solving",
    query: "logical and analytical reasoning aptitude test",
    kind: "scored",
    accent: "#2E5C8A",
    questionTypes: [
      "constraint_satisfaction",
      "sequence_pattern",
      "arrangement",
      "deduction",
      "set_relationships",
      "data_logic",
      "conditional_logic",
      "optimization",
    ],
    skills: [
      "deduction",
      "pattern recognition",
      "constraint handling",
      "conditional reasoning",
      "logical elimination",
      "multi-step analysis",
    ],
  },
  {
    id: "communication",
    label: "Communication (English)",
    short: "Communication",
    query: "English grammar vocabulary and error-spotting aptitude test",
    kind: "scored",
    accent: "#5B7553",
    questionTypes: [
      "grammar_in_context",
      "sentence_improvement",
      "error_detection",
      "vocabulary_in_context",
      "reading_inference",
      "sentence_ordering",
      "tone_and_intent",
    ],
    skills: [
      "grammar in context",
      "meaning and usage",
      "sentence clarity",
      "reading inference",
      "tone and intent",
    ],
  },
  {
    id: "psychometric",
    label: "Psychometric Assessment",
    short: "Psychometric",
    query: "psychometric situational judgement personality test",
    kind: "profile",
    accent: "#A93F35",
    questionTypes: [
      "situational_judgement",
      "teamwork",
      "ownership",
      "conflict_handling",
      "adaptability",
      "integrity",
      "initiative",
    ],
    skills: [
      "teamwork",
      "ownership",
      "adaptability",
      "initiative",
      "integrity",
      "conflict handling",
    ],
  },
];

function pick(arr, seed = 0) {
  return arr[seed % arr.length];
}

export function buildPrompt(section, blueprint = {}) {
  if (section.kind === "profile") {
    return `You are an expert psychometric and situational-judgement item writer.

Create ONE original situational-judgement item for ${section.label}.

QUESTION BLUEPRINT
- Question type: ${blueprint.questionType || pick(section.questionTypes)}
- Target difficulty: ${blueprint.difficulty || 6}/10
- Primary skill/trait: ${blueprint.skill || pick(section.skills)}

QUALITY REQUIREMENTS
1. Use a realistic school, project, internship, or early-career situation.
2. The scenario should require judgement rather than obvious moral correctness.
3. Give four genuinely plausible actions with meaningful trade-offs.
4. Do not make one option obviously heroic, rude, lazy, or absurd.
5. Do not require specialist knowledge outside the scenario.
6. Keep the scenario concise enough for an aptitude test.
7. There is no single objectively correct personality answer. The item is for response profiling.
8. Options should differ in approach, not merely wording.

Return ONLY valid JSON in exactly this shape:
{"scenario":"...","options":[{"text":"...","trait":"..."},{"text":"...","trait":"..."},{"text":"...","trait":"..."},{"text":"...","trait":"..."}],"insight":"one sentence on what this item is designed to reveal"}`;
  }

  return `You are an expert aptitude-test item writer creating an original ${section.label} question for a KNET-style practice assessment.

QUESTION BLUEPRINT
- Question type: ${blueprint.questionType || pick(section.questionTypes)}
- Target difficulty: ${blueprint.difficulty || 7}/10
- Reasoning depth: ${blueprint.reasoningDepth || 3} meaningful reasoning steps
- Primary skill: ${blueprint.skill || pick(section.skills)}
- Distractor strategy: ${blueprint.distractorStrategy || "plausible options based on realistic partial or incorrect reasoning"}

CORE QUALITY STANDARD
The question must test reasoning and comprehension, not simply the student's ability to find repeated keywords.

REQUIREMENTS
1. The problem must be fully self-contained: every fact needed to solve it must be provided.
2. There must be exactly ONE defensible correct answer.
3. The answer must require the requested reasoning depth. Do not make it difficult merely by using long passages or obscure vocabulary.
4. Do not make the answer directly copy a phrase from the passage/question.
5. At least two distractors must represent realistic reasoning mistakes, such as applying only one condition, reversing a relationship, overlooking an exception, or using irrelevant information.
6. Every distractor must be plausible after a quick read; avoid joke answers or obviously extreme alternatives.
7. Avoid ambiguous wording such as "best" unless the passage establishes a clear decision rule.
8. Do not require outside factual knowledge unless it is explicitly supplied.
9. Vary the scenario and structure from common textbook examples. The question must be original.
10. Keep the item appropriate for a timed entrance/aptitude test.
11. If research is available, use it only to understand broad assessment style and question families; do not copy wording or specific questions.
12. Before returning, mentally solve the question yourself and verify that the keyed answer follows from the supplied information alone.

ANTI-KEYWORD CHECK
Ask yourself: "Could a student get this right by matching words between the passage and the question without understanding the relationships?"
If yes, rewrite it.

Return ONLY valid JSON in exactly this shape:
{"topic":"short topic label","question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"why the correct answer is correct, 1-2 sentences","patternNote":"one short sentence describing the assessment pattern used, without claiming this exact question appeared in a real exam","questionType":"...","difficulty":7,"reasoningDepth":3,"skill":"..."}`;
}
