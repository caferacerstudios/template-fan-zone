const STATES = new Set(["upcoming", "in_progress", "completed"]);

const score = (value) => value !== null && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;

export function gamePresentation(gameModel, overrides = {}, now = new Date()) {
  const manual = overrides?.games?.[String(gameModel?.id)] ?? null;
  const sourceState = String(gameModel?.game?.state ?? "upcoming");
  const manualState = STATES.has(manual?.status) ? manual.status : null;
  const kickoff = gameModel?.game?.timeConfirmed ? Date.parse(gameModel.game.startsAt ?? "") : NaN;
  const kickoffPassed = Number.isFinite(kickoff) && kickoff <= now.getTime();
  const state = manualState === "completed" || manualState === "in_progress" ? manualState
    : sourceState === "completed" ? "completed"
      : sourceState === "in_progress" || kickoffPassed ? "in_progress" : "upcoming";
  const updates = Array.isArray(manual?.updates) ? manual.updates
    .filter((update) => typeof update?.text === "string" && update.text.trim())
    .sort((a, b) => Date.parse(b?.timestamp ?? 0) - Date.parse(a?.timestamp ?? 0)) : [];

  return {
    state,
    kickoffPassed,
    {team}Score: score(manual?.{team}Score) ?? gameModel?.seaScore ?? null,
    opponentScore: score(manual?.opponentScore) ?? gameModel?.opponentScore ?? null,
    quarter: manual?.quarter ?? null,
    clock: manual?.clock ?? null,
    updates,
  };
}
