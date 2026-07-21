"use client";

// Device-split approvals: an item can require sign-off per device
// ("pc" and/or "mobile"). It counts as APPROVED only when every required
// device is approved; rejection is whole-item. GRANDFATHERING: a plain
// `verdict: "approve"` recorded before device-splitting existed counts as
// FULLY approved - history is never re-opened.

import type { PersistedVerdict } from "./store.js";
import type { QAReviewItem } from "./types.js";

export type QADevice = "pc" | "mobile";

export const DEVICE_LABEL: Record<QADevice, string> = { pc: "PC", mobile: "Mobile" };
export const DEVICE_TOOLTIP: Record<QADevice, string> = {
  pc: "review on PC",
  mobile: "review on mobile",
};

/** Required review devices for an item. Default: PC only. */
export function requiredDevices(item: Pick<QAReviewItem, "devices">): QADevice[] {
  return item.devices && item.devices.length ? item.devices : ["pc"];
}

/** Devices already approved on a ledger entry. */
export function approvedDevicesOf(entry: PersistedVerdict | undefined): QADevice[] {
  return (entry?.approvedDevices ?? []).filter((d): d is QADevice => d === "pc" || d === "mobile");
}

/**
 * Fully approved = a recorded whole-item approval (incl. grandfathered plain
 * approvals with no device data) OR every required device approved.
 */
export function isFullyApproved(
  entry: PersistedVerdict | undefined,
  required: readonly QADevice[],
): boolean {
  if (!entry) return false;
  if (entry.verdict === "approve") return true; // grandfathered / completed
  if (entry.verdict === "reject") return false;
  const have = approvedDevicesOf(entry);
  return required.length > 0 && required.every((d) => have.includes(d));
}

/** Union of already-approved devices + a new approval. */
export function nextApprovedDevices(
  entry: PersistedVerdict | undefined,
  device: QADevice,
): QADevice[] {
  const have = approvedDevicesOf(entry);
  return have.includes(device) ? have : [...have, device];
}

/**
 * TOGGLE a device approval (0.3.1): clicking an approved device UNSETS it;
 * clicking an unapproved one approves it. Returns the resulting device set +
 * which action happened, so the caller can decide whether the item completed
 * or fell back to pending.
 */
export function toggleDevice(
  effectiveApproved: readonly QADevice[],
  device: QADevice,
): { devices: QADevice[]; action: "approve" | "unset" } {
  if (effectiveApproved.includes(device)) {
    return { devices: effectiveApproved.filter((d) => d !== device), action: "unset" };
  }
  return { devices: [...effectiveApproved, device], action: "approve" };
}

/** Best-effort current-device detection (visual hint only - never a gate). */
export function detectDevice(): QADevice {
  try {
    if (typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      return "mobile";
    }
  } catch {
    /* default below */
  }
  return "pc";
}
