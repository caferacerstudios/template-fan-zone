import injuriesStore from "../data/team/injuries.json";
import transactionsStore from "../data/team/transactions.json";
import rosterStore from "../data/team/roster.json";
import { currentInjuryStatuses, newestFirst, transactionFreshness, updatePlayerPath } from "./team-updates-core.mjs";

export const TRANSACTION_TYPES = [
  "Signed", "Waived", "Released", "Claimed", "Injured Reserve", "PUP",
  "Practice Squad", "Elevated", "Trade", "Extension", "Other",
] as const;

export const UPDATE_STATUSES = ["Official", "Reported"] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type UpdateStatus = (typeof UPDATE_STATUSES)[number];

/** Append records to the store; never edit an older event to represent a new move. */
export interface TransactionRecord {
  entityType?: "player" | "transaction";
  timestamp: string;
  playerId: string | number;
  playerName?: string;
  transactionType: TransactionType;
  previousStatus: string | null;
  newStatus: string | null;
  description: string;
  sourcePublisher: string;
  sourceUrl: string;
  updateStatus: UpdateStatus;
}

/** Injury/status observations are deliberately separate from roster transactions. */
export interface InjuryStatusRecord {
  date: string;
  playerId: string | number;
  playerName?: string;
  status: string;
  reportType?: "Roster Status" | "Practice Participation" | "Game Status";
  injury?: string;
  description: string;
  sourcePublisher: string;
  sourceUrl: string;
  updateStatus: UpdateStatus;
}

const validDate = (value: unknown) => typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
const text = (value: unknown) => typeof value === "string" && value.trim() !== "";
const playerId = (value: unknown) => (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && Number.isFinite(value));
const sourceUrl = (value: unknown) => {
  if (!text(value)) return false;
  try { return ["http:", "https:"].includes(new URL(String(value)).protocol); } catch { return false; }
};

export function isTransactionRecord(value: unknown): value is TransactionRecord {
  const row = value as TransactionRecord;
  return Boolean(row && validDate(row.timestamp) && playerId(row.playerId)
    && TRANSACTION_TYPES.includes(row.transactionType) && UPDATE_STATUSES.includes(row.updateStatus)
    && text(row.description) && text(row.sourcePublisher) && sourceUrl(row.sourceUrl)
    && (row.previousStatus === null || typeof row.previousStatus === "string")
    && (row.newStatus === null || typeof row.newStatus === "string"));
}

export function isInjuryStatusRecord(value: unknown): value is InjuryStatusRecord {
  const row = value as InjuryStatusRecord;
  return Boolean(row && validDate(row.date) && playerId(row.playerId) && text(row.status)
    && (row.reportType === undefined || ["Roster Status", "Practice Participation", "Game Status"].includes(row.reportType))
    && text(row.description) && text(row.sourcePublisher) && sourceUrl(row.sourceUrl)
    && UPDATE_STATUSES.includes(row.updateStatus));
}

export const transactions = newestFirst(
  (transactionsStore.records as unknown[]).filter(isTransactionRecord),
  (row) => row.timestamp,
);

export const transactionsFreshness = transactionFreshness(transactionsStore);
export const transactionsMetadata = {
  asOf: transactionsStore.asOf,
  sourceUrl: transactionsStore.sourceUrl,
  sourcePublisher: transactionsStore.sourcePublisher,
  sourceNote: transactionsStore.sourceNote,
};

export const injuriesMetadata = injuriesStore as typeof injuriesStore & {
  availability?: "available" | "unavailable";
  availabilityReason?: string | null;
  sourceCheckedAt?: string | null;
};

export const injuryStatuses = currentInjuryStatuses(
  (injuriesStore.records as unknown[]).filter(isInjuryStatusRecord),
  transactions,
  rosterStore,
  injuriesStore,
) as InjuryStatusRecord[];

export const playerPath = (id: string | number) => `/players/${encodeURIComponent(String(id))}`;
const knownPlayerIds = new Set((rosterStore.players || []).flatMap(player => [String(player.id), ...((player as { legacyIds?: string[] }).legacyIds || []).map(String)]));
export const playerUpdatePath = (row: TransactionRecord | InjuryStatusRecord) => updatePlayerPath(row, knownPlayerIds);
export const formatUpdateDate = (value: string | null | undefined) => !value || !Number.isFinite(Date.parse(value)) ? "Not available" : new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "short", day: "numeric",
}).format(new Date(value));
