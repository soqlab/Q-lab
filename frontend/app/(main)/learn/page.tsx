"use client";

import { useState, useEffect, useCallback } from "react";
import {
  listLearningPaths,
  getLearningPath,
  enrollInPath,
  completeModule,
  getLearningProgress,
  type LearningPath,
  type LearningModule,
  type LearningProgress,
} from "@/lib/api";

const LEVEL_STYLES: Record<string, { background: string; color: string }> = {
  beginner: { background: "rgba(6,78,59,0.6)", color: "#6ee7b7" },
  intermediate: { background: "rgba(120,53,15,0.6)", color: "#fcd34d" },
  advanced: { background: "rgba(127,29,29,0.6)", color: "#fca5a5" },
};

const MODULE_TYPE_ICON: Record<string, string> = {
  video: "▶",
  reading: "📄",
  exercise: "✎",
  quiz: "?",
};

function LevelBadge({ level }: { level: string }) {
  const levelStyle = LEVEL_STYLES[level] ?? { background: "var(--line)", color: "var(--muted)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textTransform: "capitalize",
        background: levelStyle.background,
        color: levelStyle.color,
      }}
    >
      {level}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div
      style={{
        width: "100%",
        background: "var(--line)",
        borderRadius: 999,
        height: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "var(--strong)",
          width: `${Math.min(100, Math.max(0, pct))}%`,
        }}
      />
    </div>
  );
}

function ModuleRow({
  mod,
  isCompleted,
  onComplete,
  completing,
}: {
  mod: LearningModule;
  isCompleted: boolean;
  onComplete: () => void;
  completing: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: 8,
        paddingBottom: 8,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flex: 1,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: 16,
            width: 20,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {MODULE_TYPE_ICON[mod.type] ?? "•"}
        </span>
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              margin: 0,
            }}
          >
            {mod.title}
          </p>
          <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
            {mod.duration_min} min &middot; {mod.difficulty}
          </p>
        </div>
      </div>
      <div style={{ flexShrink: 0, marginLeft: 12 }}>
        {isCompleted ? (
          <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>✓</span>
        ) : (
          <button
            onClick={onComplete}
            disabled={completing}
            style={{
              fontSize: 12,
              background: "var(--line)",
              color: "var(--text)",
              padding: "4px 12px",
              borderRadius: 8,
              border: "none",
              cursor: completing ? "not-allowed" : "pointer",
              opacity: completing ? 0.5 : 1,
            }}
          >
            {completing ? "…" : "Mark Complete"}
          </button>
        )}
      </div>
    </div>
  );
}

function PathCard({
  path,
  onEnroll,
  enrolling,
}: {
  path: LearningPath;
  onEnroll: () => void;
  enrolling: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <LevelBadge level={path.level} />
        <span style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>
          {path.total_duration_min} min
        </span>
      </div>
      <h3
        style={{
          color: "var(--text)",
          fontWeight: 600,
          fontSize: 13,
          lineHeight: 1.3,
          margin: "0 0 4px 0",
        }}
      >
        {path.title}
      </h3>
      <p
        style={{
          color: "var(--muted)",
          fontSize: 12,
          lineHeight: 1.6,
          WebkitLineClamp: 2,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          margin: "0 0 12px 0",
        }}
      >
        {path.description}
      </p>

      {/* Completion rate bar */}
      <div style={{ marginBottom: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--muted)",
            marginBottom: 4,
          }}
        >
          <span>{path.enrolled_count.toLocaleString()} enrolled</span>
          <span>{(path.completion_rate * 100).toFixed(0)}% complete</span>
        </div>
        <ProgressBar pct={path.completion_rate * 100} />
      </div>

      {/* Skills */}
      {(path.skills_gained ?? []).length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            marginBottom: 12,
          }}
        >
          {(path.skills_gained ?? []).slice(0, 4).map((s) => (
            <span
              key={s}
              style={{
                fontSize: 12,
                background: "rgba(99,102,241,0.15)",
                color: "var(--strong)",
                padding: "2px 8px",
                borderRadius: 999,
              }}
            >
              {s}
            </span>
          ))}
          {(path.skills_gained ?? []).length > 4 && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              +{(path.skills_gained ?? []).length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Prerequisites */}
      {(path.prerequisites ?? []).length > 0 && (
        <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
          Requires: {(path.prerequisites ?? []).join(", ")}
        </p>
      )}

      <button
        onClick={onEnroll}
        disabled={enrolling}
        style={{
          width: "100%",
          background: "var(--strong)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 500,
          padding: "8px 0",
          borderRadius: 8,
          border: "none",
          cursor: enrolling ? "not-allowed" : "pointer",
          opacity: enrolling ? 0.5 : 1,
        }}
      >
        {enrolling ? "Enrolling…" : "Enroll"}
      </button>
    </div>
  );
}

interface ProgressCardProps {
  progress: LearningProgress;
  pathTitle: string;
  onExpand: () => void;
  expanded: boolean;
  pathModules: LearningModule[] | null;
  onCompleteModule: (moduleId: string) => void;
  completingModuleId: string | null;
}

function ProgressCard({
  progress,
  pathTitle,
  onExpand,
  expanded,
  pathModules,
  onCompleteModule,
  completingModuleId,
}: ProgressCardProps) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              color: "var(--text)",
              fontWeight: 600,
              fontSize: 13,
              lineHeight: 1.3,
              margin: 0,
            }}
          >
            {pathTitle}
          </p>
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 2, marginBottom: 0 }}>
            Last active: {new Date(progress.last_active).toLocaleDateString()}
          </p>
        </div>
        <span
          style={{
            color: "var(--strong)",
            fontWeight: 700,
            fontSize: 13,
            flexShrink: 0,
          }}
        >
          {progress.pct_complete.toFixed(0)}%
        </span>
      </div>

      <ProgressBar pct={progress.pct_complete} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 8,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {(progress.completed_modules ?? []).length} modules completed
        </span>
        {progress.certificate_url && (
          <a
            href={progress.certificate_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 12, color: "#f59e0b", textDecoration: "underline" }}
          >
            Certificate
          </a>
        )}
      </div>

      <button
        onClick={onExpand}
        style={{
          fontSize: 12,
          color: "var(--strong)",
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {expanded ? "▲ Hide modules" : "▼ Show modules"}
      </button>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {pathModules === null ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>Loading modules…</p>
          ) : pathModules.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--muted)" }}>No modules found.</p>
          ) : (
            <div>
              {pathModules.map((mod) => (
                <ModuleRow
                  key={mod.module_id}
                  mod={mod}
                  isCompleted={(progress.completed_modules ?? []).includes(mod.module_id)}
                  onComplete={() => onCompleteModule(mod.module_id)}
                  completing={completingModuleId === mod.module_id}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function LearnPage() {
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [pathsLoading, setPathsLoading] = useState(true);
  const [pathsError, setPathsError] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [progressList, setProgressList] = useState<LearningProgress[]>([]);
  const [progressLoading, setProgressLoading] = useState(false);
  const [progressError, setProgressError] = useState<string | null>(null);

  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [enrollError, setEnrollError] = useState<string | null>(null);

  // Expanded progress cards
  const [expandedProgress, setExpandedProgress] = useState<Set<string>>(new Set());
  // Loaded path modules keyed by path_id
  const [pathModules, setPathModules] = useState<Record<string, LearningModule[]>>({});
  // Completing module: "pathId:moduleId"
  const [completingModule, setCompletingModule] = useState<string | null>(null);

  const loadPaths = useCallback(async () => {
    setPathsLoading(true);
    setPathsError(null);
    try {
      const data = await listLearningPaths();
      setPaths(data);
    } catch {
      setPathsError("Failed to load learning paths.");
    } finally {
      setPathsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPaths();
  }, [loadPaths]);

  async function handleLoadProgress() {
    if (!username.trim()) return;
    setProgressLoading(true);
    setProgressError(null);
    try {
      const data = await getLearningProgress(username.trim());
      setProgressList(data);
    } catch {
      setProgressError("Failed to load progress.");
    } finally {
      setProgressLoading(false);
    }
  }

  async function handleEnroll(pathId: string) {
    if (!username.trim()) {
      setEnrollError("Enter a username first.");
      return;
    }
    setEnrollingId(pathId);
    setEnrollError(null);
    try {
      await enrollInPath({ user: username.trim(), path_id: pathId });
      if (username.trim()) {
        const data = await getLearningProgress(username.trim());
        setProgressList(data);
      }
    } catch (e) {
      setEnrollError(e instanceof Error ? e.message : "Enrollment failed.");
    } finally {
      setEnrollingId(null);
    }
  }

  async function handleExpandProgress(progress: LearningProgress) {
    const pathId = progress.path_id;
    setExpandedProgress((prev) => {
      const next = new Set(prev);
      if (next.has(pathId)) {
        next.delete(pathId);
      } else {
        next.add(pathId);
      }
      return next;
    });
    if (!pathModules[pathId]) {
      try {
        const path = await getLearningPath(pathId);
        setPathModules((prev) => ({ ...prev, [pathId]: path.modules }));
      } catch {
        setPathModules((prev) => ({ ...prev, [pathId]: [] }));
      }
    }
  }

  async function handleCompleteModule(progress: LearningProgress, moduleId: string) {
    if (!username.trim()) return;
    const key = `${progress.path_id}:${moduleId}`;
    setCompletingModule(key);
    try {
      await completeModule({ user: username.trim(), path_id: progress.path_id, module_id: moduleId });
      const updated = await getLearningProgress(username.trim());
      setProgressList(updated);
    } catch {
      // silently leave state unchanged
    } finally {
      setCompletingModule(null);
    }
  }

  const pathMap = Object.fromEntries(paths.map((p) => [p.path_id, p.title]));

  const emptyBoxStyle = {
    fontSize: 13,
    paddingTop: 32,
    paddingBottom: 32,
    textAlign: "center" as const,
    background: "var(--surface)",
    borderRadius: 12,
    border: "1px solid var(--line)",
    color: "var(--muted)",
  };

  const errorBoxStyle = {
    marginBottom: 12,
    background: "rgba(239,68,68,0.1)",
    border: "1px solid var(--danger)",
    color: "var(--danger)",
    borderRadius: 8,
    padding: "8px 16px",
    fontSize: 13,
  };

  return (
    <main className="page" style={{ minHeight: "100vh", padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: 0 }}>
          Quantum Learning Paths
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 4 }}>
          Structured curricula for mastering quantum computing fundamentals and advanced techniques.
        </p>
      </div>

      {/* Username input */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 12, marginBottom: 32 }}>
        <div>
          <label
            style={{
              display: "block",
              fontSize: 12,
              color: "var(--muted)",
              marginBottom: 4,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Username
          </label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your-username"
            className="input"
            style={{ width: 256 }}
          />
        </div>
        <button
          onClick={handleLoadProgress}
          disabled={!username.trim() || progressLoading}
          className="button"
          style={{ opacity: !username.trim() || progressLoading ? 0.5 : 1 }}
        >
          {progressLoading ? "Loading…" : "Load Progress"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 32,
        }}
      >
        {/* Left: Path catalog */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
            Learning Catalog
          </h2>
          {enrollError && <div style={errorBoxStyle}>{enrollError}</div>}
          {pathsError && <div style={errorBoxStyle}>{pathsError}</div>}
          {pathsLoading ? (
            <div style={emptyBoxStyle}>Loading paths…</div>
          ) : paths.length === 0 ? (
            <div style={emptyBoxStyle}>No learning paths available.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {paths.map((path) => (
                <PathCard
                  key={path.path_id}
                  path={path}
                  onEnroll={() => handleEnroll(path.path_id)}
                  enrolling={enrollingId === path.path_id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: My Progress */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>
            My Progress
          </h2>
          {progressError && <div style={errorBoxStyle}>{progressError}</div>}
          {!username.trim() ? (
            <div style={emptyBoxStyle}>
              Enter a username and click &ldquo;Load Progress&rdquo; to see your learning activity.
            </div>
          ) : progressLoading ? (
            <div style={emptyBoxStyle}>Loading progress…</div>
          ) : progressList.length === 0 ? (
            <div style={emptyBoxStyle}>No enrolled paths yet. Browse the catalog and enroll!</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {progressList.map((prog) => (
                <ProgressCard
                  key={prog.progress_id}
                  progress={prog}
                  pathTitle={pathMap[prog.path_id] ?? prog.path_id}
                  onExpand={() => handleExpandProgress(prog)}
                  expanded={expandedProgress.has(prog.path_id)}
                  pathModules={pathModules[prog.path_id] ?? null}
                  onCompleteModule={(modId) => handleCompleteModule(prog, modId)}
                  completingModuleId={completingModule}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
