"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, Check, X, AlertCircle, Search, Zap, Settings, ChevronRight } from "lucide-react";
import { SECTIONS } from "../lib/sections";

/* ---------- Storage helpers (localStorage — this is a real deployed app) ---------- */
function loadHistory(sectionId) {
  try {
    const raw = localStorage.getItem(`knet:history:${sectionId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveHistory(sectionId, history) {
  try {
    localStorage.setItem(`knet:history:${sectionId}`, JSON.stringify(history.slice(-200)));
  } catch {
    /* non-fatal */
  }
}
function loadApiKey() {
  try {
    return localStorage.getItem("knet:geminiKey") || "";
  } catch {
    return "";
  }
}
function saveApiKey(key) {
  try {
    localStorage.setItem("knet:geminiKey", key);
  } catch {
    /* non-fatal */
  }
}

async function generateQuestion(
  sectionId,
  apiKey,
  onProgress
) {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sectionId,
      apiKey,
    }),
  });

  if (!res.ok) {
    const raw = await res.text();

    let message = `Request failed (${res.status})`;

    try {
      const data = JSON.parse(raw);
      message =
        data?.error || message;
    } catch {
      // Response was not JSON.
    }

    throw new Error(message);
  }

  if (!res.body) {
    throw new Error(
      "The server did not provide a streaming response."
    );
  }

  const reader =
    res.body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";
  let completedQuestion = null;

  const processLine = (rawLine) => {
    const line = rawLine.trim();

    if (!line) return;

    let event;

    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (event.type === "status") {
      onProgress?.(event.message);
      return;
    }

    if (event.type === "chunk") {
      onProgress?.("Writing question...");
      return;
    }

    if (event.type === "complete") {
      completedQuestion =
        event.question;

      onProgress?.(
        "Question ready."
      );

      return;
    }

    if (event.type === "error") {
      throw new Error(
        event.error ||
          "Question generation failed."
      );
    }
  };

  while (true) {
    const { value, done } =
      await reader.read();

    if (done) break;

    buffer += decoder.decode(
      value,
      { stream: true }
    );

    const lines =
      buffer.split("\n");

    buffer =
      lines.pop() || "";

    for (const line of lines) {
      processLine(line);
    }
  }

  buffer += decoder.decode();

  if (buffer.trim()) {
    processLine(buffer);
  }

  if (!completedQuestion) {
    throw new Error(
      "The server finished streaming without returning a question."
    );
  }

  return completedQuestion;
}

/* ---------- Dial (signature element) ---------- */
function Dial({ value, accent, size = 64, label }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const ticks = Array.from({ length: 12 });
  return (
    <div style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {ticks.map((_, i) => {
          const angle = (i / 12) * 2 * Math.PI;
          const x1 = size / 2 + (r + 4) * Math.cos(angle);
          const y1 = size / 2 + (r + 4) * Math.sin(angle);
          const x2 = size / 2 + (r + 7) * Math.cos(angle);
          const y2 = size / 2 + (r + 7) * Math.sin(angle);
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#DEDAD0"
              strokeWidth="1.5"
              style={{ transform: "rotate(90deg)", transformOrigin: `${size / 2}px ${size / 2}px` }}
            />
          );
        })}
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#EDEAE2" strokeWidth="5" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={accent}
          strokeWidth="5"
          fill="none"
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.5s ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: size * 0.24, color: "#1B1E24" }}>
          {label}
        </span>
      </div>
    </div>
  );
}

function ScoredCard({ q, onAnswer, answered, chosenIndex }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {q.patternNote && (
        <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12.5, color: "#767B87" }}>
          <Search size={13} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>{q.patternNote}</span>
        </div>
      )}
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 12, color: "#C68A1F", letterSpacing: 0.4, textTransform: "uppercase" }}>
        {q.topic}
      </div>
      <div style={{ fontSize: 17, lineHeight: 1.5, color: "#1B1E24", fontWeight: 500 }}>{q.question}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {q.options.map((opt, i) => {
          const isCorrect = i === q.correctIndex;
          const isChosen = i === chosenIndex;
          let bg = "#FFFFFF";
          let border = "#DEDAD0";
          let textColor = "#1B1E24";
          if (answered) {
            if (isCorrect) {
              bg = "#EEF4EE";
              border = "#5B7553";
            } else if (isChosen && !isCorrect) {
              bg = "#F8ECEA";
              border = "#A93F35";
            } else {
              textColor = "#9BA0AA";
            }
          }
          return (
            <button
              key={i}
              onClick={() => !answered && onAnswer(i)}
              disabled={answered}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 10,
                border: `1.5px solid ${border}`,
                background: bg,
                color: textColor,
                fontSize: 14.5,
                cursor: answered ? "default" : "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{opt}</span>
              {answered && isCorrect && <Check size={16} color="#5B7553" />}
              {answered && isChosen && !isCorrect && <X size={16} color="#A93F35" />}
            </button>
          );
        })}
      </div>
      {answered && q.explanation && (
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.55,
            background: "#F4F3EF",
            border: "1px solid #DEDAD0",
            borderRadius: 10,
            padding: "12px 14px",
            color: "#40444C",
          }}
        >
          <strong style={{ color: "#1B1E24" }}>Why: </strong>
          {q.explanation}
        </div>
      )}
    </div>
  );
}

function ProfileCard({ q, onAnswer, answered, chosenIndex }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 12, color: "#A93F35", letterSpacing: 0.4, textTransform: "uppercase" }}>
        Situational Judgement
      </div>
      <div style={{ fontSize: 16, lineHeight: 1.55, color: "#1B1E24", fontWeight: 500 }}>{q.scenario}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {q.options.map((opt, i) => {
          const isChosen = i === chosenIndex;
          return (
            <button
              key={i}
              onClick={() => !answered && onAnswer(i)}
              disabled={answered}
              style={{
                textAlign: "left",
                padding: "12px 14px",
                borderRadius: 10,
                border: `1.5px solid ${isChosen ? "#A93F35" : "#DEDAD0"}`,
                background: isChosen ? "#F8ECEA" : "#FFFFFF",
                color: "#1B1E24",
                fontSize: 14.5,
                cursor: answered ? "default" : "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{opt.text}</span>
              {answered && isChosen && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: "#A93F35", flexShrink: 0, marginLeft: 10 }}>
                  {opt.trait}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {answered && q.insight && (
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.55,
            background: "#F4F3EF",
            border: "1px solid #DEDAD0",
            borderRadius: 10,
            padding: "12px 14px",
            color: "#40444C",
          }}
        >
          <strong style={{ color: "#1B1E24" }}>What this probes: </strong>
          {q.insight}
        </div>
      )}
    </div>
  );
}

export default function Page() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const [histories, setHistories] = useState({});
  const [current, setCurrent] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progressMessage, setProgressMessage] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [questionStartedAt, setQuestionStartedAt] = useState(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    const h = {};
    SECTIONS.forEach((s) => (h[s.id] = loadHistory(s.id)));
    setHistories(h);
    const k = loadApiKey();
    setApiKey(k);
    setKeyDraft(k);
  }, []);

  const active = SECTIONS.find((s) => s.id === activeId);
  const activeHistory = histories[activeId] || [];
  const activeCurrent = current[activeId];

    const handleGenerate = useCallback(
    async () => {
      if (!apiKey) {
        setShowSettings(true);
        setError(
          "Add your Gemini API key in Settings first."
        );
        return;
      }

      setLoading(true);
      setError("");
      setProgressMessage(
        "Starting question generation..."
      );

      try {
        const q = await generateQuestion(
          activeId,
          apiKey,
          (message) => {
            setProgressMessage(message);
          }
        );

        setCurrent((c) => ({
          ...c,
          [activeId]: {
            question: q,
            answered: false,
            chosenIndex: null,
          },
        }));

        setQuestionStartedAt(
          Date.now()
        );

        setProgressMessage("");
      } catch (e) {
        setError(
          e?.message ||
            "Something went wrong"
        );

        setProgressMessage("");
      } finally {
        setLoading(false);
      }
    },
    [activeId, apiKey]
  );

  const handleAnswer = useCallback(
    (i) => {
      const q = activeCurrent.question;
      const correct = active.kind === "scored" ? i === q.correctIndex : null;
      setCurrent((c) => ({ ...c, [activeId]: { ...c[activeId], answered: true, chosenIndex: i } }));
      setHistories((h) => {
        const answeredAt = Date.now();
        const responseTimeMs = questionStartedAt ? Math.max(0, answeredAt - questionStartedAt) : null;
        const next = [...(h[activeId] || []), { correct, responseTimeMs, difficulty: q.difficulty ?? null, questionType: q.questionType ?? null, skill: q.skill ?? null, ts: answeredAt }];
        saveHistory(activeId, next);
        return { ...h, [activeId]: next };
      });
    },
    [active, activeId, activeCurrent, questionStartedAt]
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F4F3EF", fontFamily: "'Inter', sans-serif", color: "#1B1E24" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 20px",
          borderBottom: "1px solid #DEDAD0",
          background: "#FFFFFF",
        }}
      >
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 19, letterSpacing: -0.3 }}>
            KNET Control Panel
          </div>
          <div style={{ fontSize: 12, color: "#767B87", marginTop: 1 }}>
            Calibrating four instruments before the interview round · powered by Gemini
          </div>
        </div>
        <button
          onClick={() => {
            setKeyDraft(apiKey);
            setShowSettings(true);
          }}
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            border: "1px solid #DEDAD0",
            background: apiKey ? "#EEF4EE" : "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
          aria-label="Settings"
        >
          <Settings size={17} color={apiKey ? "#5B7553" : "#767B87"} />
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, padding: "16px 16px 4px", maxWidth: 720, margin: "0 auto" }}>
        {SECTIONS.map((s) => {
          const hist = histories[s.id] || [];
          const val = s.kind === "scored" ? (hist.length ? hist.filter((h) => h.correct).length / hist.length : 0) : Math.min(1, hist.length / 10);
          const label = s.kind === "scored" ? (hist.length ? `${Math.round(val * 100)}` : "—") : `${hist.length}`;
          const isActive = s.id === activeId;
          return (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 14,
                border: `1.5px solid ${isActive ? s.accent : "#DEDAD0"}`,
                background: isActive ? "#FFFFFF" : "#FAF9F6",
                cursor: "pointer",
                textAlign: "left",
                boxShadow: isActive ? "0 2px 10px rgba(0,0,0,0.05)" : "none",
              }}
            >
              <Dial value={val} accent={s.accent} size={44} label={label} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 }}>{s.short}</div>
                <div style={{ fontSize: 10.5, color: "#767B87", marginTop: 2 }}>
                  {s.kind === "scored" ? `${hist.length} attempted` : `${hist.length} profiled`}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ padding: "16px 16px 32px", maxWidth: 720, margin: "0 auto" }}>
        <div style={{ background: "#FFFFFF", border: "1px solid #DEDAD0", borderRadius: 16, padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 15.5 }}>{active.label}</div>
            <button
              onClick={handleGenerate}
              disabled={loading}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 13px",
                borderRadius: 9,
                border: "none",
                background: loading ? "#EDEAE2" : "#1B1E24",
                color: loading ? "#9BA0AA" : "#FFFFFF",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: loading ? "default" : "pointer",
              }}
            >
              {loading ? (
  <>
   <RefreshCw
      size={13}
      className="knet-spin"
    />
    {progressMessage || "Generating…"}
  </>
) : (
                <>
                  <Zap size={13} /> {activeCurrent ? "New question" : "Generate"}
                </>
              )}
            </button>
          </div>

          {error && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                background: "#F8ECEA",
                border: "1px solid #E3B8B2",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 12.5,
                color: "#A93F35",
                marginBottom: 14,
              }}
            >
              <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {!activeCurrent && !loading && (
            <div style={{ textAlign: "center", padding: "36px 12px", color: "#9BA0AA", fontSize: 13.5 }}>
              No question loaded yet. Gemini will generate
              an original question from a controlled
              assessment blueprint and validate its
              structure before showing it to you.
            </div>
          )}

          {loading && (
  <div
    style={{
      textAlign: "center",
      padding: "36px 12px",
      color: "#767B87",
      fontSize: 13.5,
    }}
  >
    <div
      style={{
        fontWeight: 600,
        color: "#1B1E24",
        marginBottom: 6,
      }}
    >
      {progressMessage ||
        "Generating question…"}
    </div>

    <div>
      Gemini is generating the question
      progressively. The completed question
      will appear once generation finishes.
    </div>
  </div>
)}

          {activeCurrent && !loading && active.kind === "scored" && (
            <ScoredCard q={activeCurrent.question} answered={activeCurrent.answered} chosenIndex={activeCurrent.chosenIndex} onAnswer={handleAnswer} />
          )}
          {activeCurrent && !loading && active.kind === "profile" && (
            <ProfileCard q={activeCurrent.question} answered={activeCurrent.answered} chosenIndex={activeCurrent.chosenIndex} onAnswer={handleAnswer} />
          )}
        </div>

        {activeHistory.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 11.5, color: "#9BA0AA", textAlign: "center" }}>
            {activeHistory.length} question{activeHistory.length === 1 ? "" : "s"} logged in this section · saved to this browser
          </div>
        )}
      </div>

      <style>{`
        .knet-spin { animation: knet-spin 0.9s linear infinite; }
        @keyframes knet-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        button:focus-visible { outline: 2px solid #C68A1F; outline-offset: 2px; }
      `}</style>

      {showSettings && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(27,30,36,0.45)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 50,
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#FFFFFF",
              borderRadius: "18px 18px 0 0",
              padding: 20,
              width: "100%",
              maxWidth: 480,
              boxShadow: "0 -4px 24px rgba(0,0,0,0.12)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 600, fontSize: 16 }}>
                Your Gemini API key
              </div>
              <button
                onClick={() => setShowSettings(false)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}
              >
                <X size={18} color="#767B87" />
              </button>
            </div>
            <p style={{ fontSize: 12.5, color: "#767B87", lineHeight: 1.5, marginTop: 6 }}>
              Saved only in this browser's local storage. It's sent to your own server on each
              question request, which forwards it to Gemini — it never goes anywhere else. Get a
              free key at{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" style={{ color: "#2E5C8A" }}>
                aistudio.google.com/apikey
              </a>
              .
            </p>
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="AIza…"
              style={{
                width: "100%",
                marginTop: 12,
                padding: "11px 13px",
                borderRadius: 10,
                border: "1.5px solid #DEDAD0",
                fontSize: 13.5,
                fontFamily: "'IBM Plex Mono', monospace",
                boxSizing: "border-box",
              }}
            />
            <button
              onClick={() => {
                setApiKey(keyDraft.trim());
                saveApiKey(keyDraft.trim());
                setShowSettings(false);
                setError("");
              }}
              style={{
                width: "100%",
                marginTop: 14,
                padding: "12px",
                borderRadius: 10,
                border: "none",
                background: "#1B1E24",
                color: "#FFFFFF",
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              Save key <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
