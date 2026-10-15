import { createContext, useContext } from 'react';

/**
 * How what a placed box holds says where its ink ends, in the box's own
 * points from its top, so the box's caption sits close under it rather than
 * under the box. Each part reports under its own key (the signature, the day
 * under it); the lowest wins, and `null` withdraws a report.
 */
export type InkReport = (key: string, bottom: number | null) => void;

export const InkContext = createContext<InkReport | null>(null);

/** The box's report, or null outside a `PlacementLayer`. */
export const useInkReport = (): InkReport | null => useContext(InkContext);
