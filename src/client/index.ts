export {
  QAReviewOverlay,
  isClickGesture,
  nextMinimized,
  AUTO_BUBBLE_MAX_WIDTH_PX,
  type BubbleEvent,
  type QAReviewOverlayProps,
} from "./QAReviewOverlay.js";
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
  countUnverdicted,
  nextPendingPage,
  buildJourneyNavUrl,
  fetchPendingCounts,
  resolveFinishAction,
  journeyFinishView,
  shouldPrefetch,
  isPrefetchFresh,
  ensurePrefetchLink,
  PREFETCH_WINDOW_ITEMS,
  PREFETCH_MAX_AGE_MS,
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
  toggleDevice,
  detectDevice,
  DEVICE_LABEL,
  DEVICE_TOOLTIP,
  type QADevice,
} from "./device.js";
export { findMatchRanges, applySubHighlights, type MatchRange } from "./highlight.js";
export { describeRevisit, type RevisitInfo, type RevisitDisplay } from "./revisit.js";
export {
  buildMobilePreviewUrl,
  isEmbeddedPreview,
  postVariantToPreview,
  parseVariantMessage,
  MOBILE_PREVIEW_WIDTH,
  MOBILE_PREVIEW_HEIGHT,
  PREVIEW_MARKER_PARAM,
  PREVIEW_MESSAGE_TYPE,
  type VariantMessage,
} from "./preview.js";
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
