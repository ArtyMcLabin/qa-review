export { QAReviewOverlay, isClickGesture, type QAReviewOverlayProps } from "./QAReviewOverlay.js";
export {
  QAStore,
  createQAStore,
  targetFromLocation,
  type QAStoreOptions,
  type PersistedVerdict,
  type PendingOp,
  type VerdictMap,
} from "./store.js";
export {
  journeyIndex,
  countPending,
  nextPendingPage,
  buildJourneyNavUrl,
  fetchPendingCounts,
  resolveFinishAction,
  type FinishAction,
  type QAJourneyConfig,
  type QAJourneyPage,
} from "./journey.js";
export {
  normalizeText,
  fingerprintText,
  itemFingerprint,
  fingerprintStatus,
  type FingerprintStatus,
} from "./fingerprint.js";
export {
  requiredDevices,
  approvedDevicesOf,
  isFullyApproved,
  nextApprovedDevices,
  detectDevice,
  DEVICE_LABEL,
  DEVICE_TOOLTIP,
  type QADevice,
} from "./device.js";
export { findMatchRanges, applySubHighlights, type MatchRange } from "./highlight.js";
export {
  codenameFor,
  findByCodename,
  formatQARef,
  fnv1a,
  type CodenameEntry,
} from "../shared/codename.js";
export { ensureQAStyles } from "./styles.js";
export { isTaskItem } from "./types.js";
export type {
  QAReviewItem,
  QAReviewDevice,
  QAResult,
  QAVerdict,
  QASubmission,
  QATheme,
} from "./types.js";
