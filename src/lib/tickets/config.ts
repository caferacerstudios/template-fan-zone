import { ticketFeatureState } from "./feature-state.mjs";
export type TicketFinderState = "disabled" | "preview" | "beta" | "live";
export const TICKET_FEATURE = ticketFeatureState(import.meta.env.SFZ_TICKET_DATA_MODE, import.meta.env.SFZ_TICKET_INDEXING_STATE);
export const TICKET_FINDER_STATE = TICKET_FEATURE.mode as TicketFinderState;
