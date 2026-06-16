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

const LEVEL_COLORS: Record<string, string> = {
  beginner: "bg-emerald-900/60 text-emerald-300",
  intermediate: "bg-amber-900/60 text-amber-300",
  advanced: "bg-red-900/60 text-red-300",
};

const MODULE_TYPE_ICON: Record<string, string> = {
  video: "▶",
  reading: "📄",
  exercise: "✎",
  quiz: "?",
};

function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${LEVEL_COLORS[level] ?? "bg-gray-800 text-gray-400"}`}>
      {level}
    </span>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="w-full bg-gray-800 rounded-full h-2 overflow-hidden">
      <div
        className="h-2 rounded-full bg-indigo-500 transition-all"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
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
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-base w-5 text-center flex-shrink-0">
          {MODULE_TYPE_ICON[mod.type] ?? "•"}
        </span>
        <div className="min-w-0">
          <p className="text-gray-200 text-sm font-medium truncate">{mod.title}</p>
          <p className="text-gray-500 text-xs">
            {mod.duration_min} min &middot; {mod.difficulty}
          </p>
        </div>
      </div>
      <div className="flex-shrink-0 ml-3">
        {isCompleted ? (
          <span className="text-emerald-400 text-sm font-semibold">✓</span>
        ) : (
          <button
            onClick={onComplete}
            disabled={completing}
            className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1 rounded-lg transition-colors"
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <LevelBadge level={path.level} />
        <span className="text-xs text-gray-500 flex-shrink-0">{path.total_duration_min} min</span>
      </div>
      <h3 className="text-gray-100 font-semibold text-sm mb-1 leading-snug">{path.title}</h3>
      <p className="text-gray-500 text-xs mb-3 leading-relaxed line-clamp-2">{path.description}</p>

      {/* Completion rate bar */}
      <div className="mb-2">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{path.enrolled_count.toLocaleString()} enrolled</span>
          <span>{(path.completion_rate * 100).toFixed(0)}% complete</span>
        </div>
        <ProgressBar pct={path.completion_rate * 100} />
      </div>

      {/* Skills */}
      {path.skills_gained.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {path.skills_gained.slice(0, 4).map((s) => (
            <span key={s} className="text-xs bg-indigo-900/40 text-indigo-300 px-2 py-0.5 rounded-full">
              {s}
            </span>
          ))}
          {path.skills_gained.length > 4 && (
            <span className="text-xs text-gray-600">+{path.skills_gained.length - 4} more</span>
          )}
        </div>
      )}

      {/* Prerequisites */}
      {path.prerequisites.length > 0 && (
        <p className="text-xs text-gray-600 mb-3">
          Requires: {path.prerequisites.join(", ")}
        </p>
      )}

      <button
        onClick={onEnroll}
        disabled={enrolling}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium py-2 rounded-lg transition-colors"
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
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-gray-100 font-semibold text-sm leading-snug">{pathTitle}</p>
          <p className="text-gray-500 text-xs mt-0.5">
            Last active: {new Date(progress.last_active).toLocaleDateString()}
          </p>
        </div>
        <span className="text-indigo-400 font-bold text-sm flex-shrink-0">
          {progress.pct_complete.toFixed(0)}%
        </span>
      </div>

      <ProgressBar pct={progress.pct_complete} />

      <div className="flex items-center justify-between mt-2 mb-3">
        <span className="text-xs text-gray-500">
          {progress.completed_modules.length} modules completed
        </span>
        {progress.certificate_url && (
          <a
            href={progress.certificate_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-amber-400 hover:text-amber-300 underline"
          >
            Certificate
          </a>
        )}
      </div>

      <button
        onClick={onExpand}
        className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        {expanded ? "▲ Hide modules" : "▼ Show modules"}
      </button>

      {expanded && (
        <div className="mt-3">
          {pathModules === null ? (
            <p className="text-xs text-gray-600">Loading modules…</p>
          ) : pathModules.length === 0 ? (
            <p className="text-xs text-gray-600">No modules found.</p>
          ) : (
            <div>
              {pathModules.map((mod) => (
                <ModuleRow
                  key={mod.module_id}
                  mod={mod}
                  isCompleted={progress.completed_modules.includes(mod.module_id)}
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

  return (
    <main className="min-h-screen bg-gray-950 text-gray-100 p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-100">Quantum Learning Paths</h1>
        <p className="text-gray-500 text-sm mt-1">
          Structured curricula for mastering quantum computing fundamentals and advanced techniques.
        </p>
      </div>

      {/* Username input */}
      <div className="flex items-end gap-3 mb-8">
        <div>
          <label className="block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="your-username"
            className="w-64 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button
          onClick={handleLoadProgress}
          disabled={!username.trim() || progressLoading}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {progressLoading ? "Loading…" : "Load Progress"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Path catalog */}
        <div>
          <h2 className="text-lg font-semibold text-gray-100 mb-3">Learning Catalog</h2>
          {enrollError && (
            <div className="mb-3 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-2 text-sm">
              {enrollError}
            </div>
          )}
          {pathsError && (
            <div className="mb-3 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-2 text-sm">
              {pathsError}
            </div>
          )}
          {pathsLoading ? (
            <div className="text-gray-500 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              Loading paths…
            </div>
          ) : paths.length === 0 ? (
            <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              No learning paths available.
            </div>
          ) : (
            <div className="space-y-3">
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
          <h2 className="text-lg font-semibold text-gray-100 mb-3">My Progress</h2>
          {progressError && (
            <div className="mb-3 bg-red-950 border border-red-800 text-red-300 rounded-lg px-4 py-2 text-sm">
              {progressError}
            </div>
          )}
          {!username.trim() ? (
            <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              Enter a username and click "Load Progress" to see your learning activity.
            </div>
          ) : progressLoading ? (
            <div className="text-gray-500 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              Loading progress…
            </div>
          ) : progressList.length === 0 ? (
            <div className="text-gray-600 text-sm py-8 text-center bg-gray-900 rounded-xl border border-gray-800">
              No enrolled paths yet. Browse the catalog and enroll!
            </div>
          ) : (
            <div className="space-y-3">
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
