// Shared types for the on-page gamified QA review overlay.
// A page supplies an array of QAReviewItem; <QAReviewOverlay> turns them into
// an onboarding-style spotlight walkthrough with approve/reject stepping.

export type QAReviewDevice = "💻" | "📱" | "💻📱";

export interface QAReviewItem {
  /** Stable id, used as the verdict-ledger key. */
  id: string;
  /** Short label shown on the review card. */
  title: string;
  /** Optional multi-line detail ("\n" renders as paragraph breaks). */
  sub?: string;
  /**
   * CSS selector for the element to spotlight on the real page (e.g.
   * `[data-qa="hero"]`). OMIT for an off-DOM "task item": it renders as a
   * centered card (no spotlight) - for visit-this-page checks and decisions
   * that have no single on-page anchor.
   */
  selector?: string;
  /** Optional action link (task items): a button opening the URL in a new tab. */
  action?: {
    /** Button label. Default "Open". */
    label?: string;
    href: string;
  };
  /** Which viewport(s) this item is about (legacy display emoji). */
  device?: QAReviewDevice;
  /**
   * Devices whose sign-off is REQUIRED for this item to count as approved
   * (device-split approvals). Default: ["pc"]. The item stays pending until
   * every listed device is approved; rejection is whole-item.
   */
  devices?: Array<"pc" | "mobile">;
  /**
   * Words/phrases INSIDE the anchored element to sub-highlight (secondary
   * mark on top of the spotlight). Replaces "where to look" prose - keep the
   * question terse and let the highlight point.
   */
  highlightWords?: string[];
  /** Optional grouping label. */
  section?: string;
  /**
   * When the reviewed element has design VARIATIONS to choose from, the overlay
   * renders 1..count buttons that live-swap the element on the page via
   * `onSelect` (dynamic preview) and records the chosen variant in the result.
   */
  variations?: {
    count: number;
    /** Current live variant (1-based) for button highlighting. */
    current: number;
    /** Apply a variant on the real page (updates the page's own state). */
    onSelect: (variant: number) => void;
  };
}

/** Off-DOM "task item" = no selector: centered card, no spotlight. */
export function isTaskItem(item: Pick<QAReviewItem, "selector">): boolean {
  return !item.selector;
}

export type QAVerdict = "approve" | "reject";

export interface QAResult {
  id: string;
  title: string;
  verdict: QAVerdict;
  note?: string;
  /** Chosen variant (1-based) when the item had variations. */
  variant?: number;
}

/** Session-snapshot payload POSTed to the submit endpoint. */
export interface QASubmission {
  /** What is being reviewed (e.g. "example-site:/pricing"). */
  target: string;
  /** Free-text reviewer name/label (server-side auth may override). */
  reviewer?: string;
  approved: number;
  rejected: number;
  total: number;
  results: Array<QAResult | { id: string; title: string; verdict: "skipped" }>;
}

/** Theme hooks for the overlay chrome. Any CSS color value (vars included). */
export interface QATheme {
  /** Brand accent (spotlight ring, approve button, headings). */
  accent: string;
  /** Text color used ON accent-filled surfaces (usually the darkest bg). */
  accentContrast: string;
  /** Panel/card background. */
  panelBg: string;
  /** Input (textarea) background. */
  inputBg: string;
}
