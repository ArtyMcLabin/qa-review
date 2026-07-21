"use client";

// Injected stylesheet for the overlay chrome. Framework-agnostic on purpose:
// no Tailwind (or any CSS toolchain) required in the consumer. Brand colors
// come from CSS custom properties (see QATheme) so one stylesheet serves every
// install; neutral grays/greens/reds are fixed.

const ACCENT = "var(--qar-accent)";
const ON_ACCENT = "var(--qar-accent-contrast)";
const PANEL = "var(--qar-panel-bg)";
const INPUT = "var(--qar-input-bg)";
/** Alpha-blend the accent (keeps theme a single color value). */
const mix = (pct: number) => `color-mix(in srgb, ${ACCENT} ${pct}%, transparent)`;

export const QA_STYLES = `
.qar-theme{--qar-accent:#ffde4d;--qar-accent-contrast:#0a0b12;--qar-panel-bg:#10121c;--qar-input-bg:#181b28;}
.qar-theme, .qar-theme *{box-sizing:border-box;}
.qar-theme button{font-family:inherit;cursor:pointer;}
.qar-theme button:disabled{cursor:default;}

/* ---- spotlight / dim ---- */
.qar-spotlight{pointer-events:none;position:fixed;z-index:99998;border-radius:8px;transition:all .2s;
  box-shadow:0 0 0 2px ${ACCENT},0 0 0 9999px rgba(0,0,0,.72);}
.qar-dim{pointer-events:none;position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.72);}

/* ---- review card ---- */
.qar-card{position:fixed;z-index:99999;display:flex;flex-direction:column;border-radius:12px;
  border:1px solid ${mix(50)};background:${PANEL};padding:16px;box-shadow:0 0 40px -8px ${mix(50)};}
.qar-card-header{margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;font-size:12px;}
.qar-counter{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:${ACCENT};}
.qar-header-tools{display:flex;align-items:center;gap:8px;color:#94a3b8;}
.qar-tool-btn{display:inline-flex;align-items:center;justify-content:center;border-radius:4px;
  border:1px solid #475569;background:transparent;padding:4px;color:#cbd5e1;}
.qar-tool-btn:hover{background:#1e293b;}
.qar-tool-btn:disabled{opacity:.3;}
.qar-tool-btn:disabled:hover{background:transparent;}
.qar-close-btn{display:inline-flex;border:none;background:none;padding:0;color:inherit;}
.qar-close-btn:hover{color:#e2e8f0;}

.qar-card-body{min-height:0;flex:1;overflow-y:auto;padding-right:4px;text-align:left;}
.qar-warn{margin:0 0 8px;border-radius:4px;background:rgba(127,29,29,.3);padding:4px 8px;font-size:11px;color:#fca5a5;}
.qar-item-title{margin:0;font-size:14px;font-weight:700;color:#fff;}
.qar-item-sub{margin-top:4px;display:flex;flex-direction:column;gap:4px;font-size:12px;line-height:1.625;color:#94a3b8;}
.qar-item-sub p{margin:0;}
.qar-recorded{margin:8px 0 0;font-size:11px;font-weight:600;}
.qar-recorded-approve{color:#4ade80;}
.qar-recorded-reject{color:#f87171;}

/* ---- variations picker ---- */
.qar-var-wrap{margin-top:12px;}
.qar-var-label{margin:0 0 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;}
.qar-var-btns{display:flex;flex-wrap:wrap;gap:6px;}
.qar-var-btn{height:28px;width:28px;border-radius:6px;border:1px solid ${mix(40)};background:transparent;
  font-size:12px;font-weight:700;color:${ACCENT};transition:background-color .15s,color .15s;}
.qar-var-btn:hover{background:${mix(12)};}
.qar-var-btn.qar-on{border-color:${ACCENT};background:${ACCENT};color:${ON_ACCENT};}
.qar-var-note{margin:4px 0 0;font-size:10px;color:#64748b;}

/* ---- note ---- */
.qar-note-row{margin-top:12px;display:flex;align-items:center;justify-content:space-between;}
.qar-note-label{font-size:10px;color:#64748b;}
.qar-pick-btn{display:inline-flex;align-items:center;gap:4px;border-radius:4px;border:1px solid #475569;
  background:transparent;padding:2px 6px;font-size:10px;color:#cbd5e1;}
.qar-pick-btn:hover{background:#1e293b;}
.qar-pick-btn.qar-picking{border-color:${ACCENT};background:${ACCENT};color:${ON_ACCENT};}
.qar-note-input{margin-top:4px;width:100%;resize:none;border-radius:6px;border:1px solid #334155;
  background:${INPUT};padding:6px 8px;font-size:12px;color:#e2e8f0;outline:none;font-family:inherit;}
.qar-note-input:focus{border-color:${mix(60)};}
.qar-note-input::placeholder{color:#64748b;}

/* ---- action row ---- */
.qar-actions{margin-top:12px;display:flex;align-items:center;gap:8px;}
.qar-nav-btn{display:flex;height:36px;width:36px;align-items:center;justify-content:center;border-radius:8px;
  border:1px solid #334155;background:transparent;color:#cbd5e1;}
.qar-nav-btn:hover{background:#1e293b;}
.qar-nav-btn:disabled{opacity:.3;background:transparent;}
.qar-reject-btn{display:flex;flex:1;align-items:center;justify-content:center;gap:6px;border-radius:8px;
  border:1px solid rgba(239,68,68,.5);background:rgba(127,29,29,.2);padding:8px 12px;font-size:14px;font-weight:700;color:#fca5a5;}
.qar-reject-btn:hover{background:rgba(127,29,29,.4);}
.qar-approve-btn{display:flex;flex:1;align-items:center;justify-content:center;gap:6px;border-radius:8px;
  border:none;background:${ACCENT};padding:8px 12px;font-size:14px;font-weight:700;color:${ON_ACCENT};}
.qar-approve-btn:hover{filter:brightness(1.05);}
.qar-footer{margin-top:8px;display:flex;align-items:center;justify-content:space-between;font-size:10px;color:#64748b;}
.qar-footer-green{color:#22c55e;}

/* ---- finish panel ---- */
.qar-finish-backdrop{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.8);padding:16px;}
.qar-finish-card{width:100%;max-width:28rem;border-radius:16px;border:1px solid ${mix(40)};background:${PANEL};
  padding:24px;text-align:center;box-shadow:0 0 50px -10px ${mix(50)};}
.qar-finish-icon{margin:0 auto 12px;display:block;color:${ACCENT};}
.qar-finish-title{margin:0;font-size:20px;line-height:28px;font-weight:900;color:${ACCENT};}
.qar-finish-stats{margin:8px 0 0;font-size:14px;color:#cbd5e1;}
.qar-green{font-weight:700;color:#4ade80;}
.qar-red{font-weight:700;color:#f87171;}
.qar-finish-autosaved{margin-top:12px;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:#86efac;}
.qar-finish-actions{margin-top:16px;display:flex;flex-direction:column;gap:8px;}
.qar-btn-primary{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;border:none;
  background:${ACCENT};padding:8px 16px;font-size:14px;font-weight:700;color:${ON_ACCENT};}
.qar-btn-primary:hover{filter:brightness(1.05);}
.qar-btn-primary:disabled{opacity:.6;filter:none;}
.qar-btn-outline-accent{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:8px;
  border:1px solid ${mix(40)};background:transparent;padding:8px 16px;font-size:14px;font-weight:700;color:${ACCENT};}
.qar-btn-outline-accent:hover{background:${mix(10)};}
.qar-btn-outline{border-radius:8px;border:1px solid #475569;background:transparent;padding:8px 16px;font-size:14px;color:#cbd5e1;}
.qar-btn-outline:hover{background:#1e293b;}
.qar-btn-ghost{border:none;background:none;border-radius:8px;padding:8px 16px;font-size:14px;color:#64748b;}
.qar-btn-ghost:hover{color:#cbd5e1;}

/* ---- misc ---- */
.qar-muted{color:#64748b;font-weight:400;}

/* ---- task-item action link ---- */
.qar-action-link{margin-top:10px;display:inline-flex;align-items:center;gap:6px;border-radius:8px;
  border:1px solid ${mix(40)};padding:6px 12px;font-size:12px;font-weight:700;color:${ACCENT};text-decoration:none;}
.qar-action-link:hover{background:${mix(10)};}

/* ---- journey summary ---- */
.qar-journey{margin-top:14px;display:flex;flex-direction:column;gap:4px;text-align:left;font-size:12px;color:#cbd5e1;}
.qar-journey-row{display:flex;justify-content:space-between;gap:12px;padding:2px 8px;border-radius:4px;}
.qar-journey-row.qar-current{background:${mix(8)};}
.qar-journey-left{color:${ACCENT};font-weight:700;}
.qar-journey-done{color:#4ade80;}
.qar-journey-nav{margin:6px 0 0;font-size:12px;color:#86efac;}

/* ---- 0.3.0: note field fills the card ---- */
.qar-card-body{display:flex;flex-direction:column;}
.qar-note-input{flex:1 1 auto;min-height:110px;}

/* ---- 0.3.0: NOT-ALTERED fingerprint badges ---- */
.qar-fp-unchanged{margin:8px 0 0;border-radius:6px;border:1px solid rgba(239,68,68,.6);
  background:rgba(127,29,29,.35);padding:6px 8px;font-size:12px;font-weight:700;color:#fecaca;}
.qar-fp-unchanged small{display:block;margin-top:4px;font-weight:400;color:#fca5a5;}
.qar-fp-changed{margin:8px 0 0;font-size:11px;color:#94a3b8;}

/* ---- sub-highlight mark: injected into PAGE content, i.e. OUTSIDE any
   .qar-theme scope - so it must never depend on scoped vars without a
   fallback (0.3.1 fix: unfallbacked vars made the mark compute to no
   background at all = invisible highlights). ---- */
mark.qar-subhl{background:color-mix(in srgb, var(--qar-accent, #ffde4d) 40%, transparent);
  color:inherit;border-radius:3px;padding:0 2px;
  box-shadow:0 0 0 1px color-mix(in srgb, var(--qar-accent, #ffde4d) 70%, transparent);}

/* ---- 0.3.0: codename / copy-ref ---- */
.qar-ref-row{margin-top:6px;display:flex;align-items:center;gap:6px;font-size:10px;color:#64748b;}
.qar-codename{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${ACCENT};}

/* ---- 0.3.0: device-split approvals ---- */
.qar-approve-alt{display:flex;flex:1;align-items:center;justify-content:center;gap:6px;border-radius:8px;
  border:1px solid ${mix(50)};background:${mix(12)};padding:8px 12px;font-size:14px;font-weight:700;color:${ACCENT};}
.qar-approve-alt:hover{background:${mix(20)};}
.qar-dev-done{opacity:.55;}
.qar-partial-note{margin:6px 0 0;font-size:11px;color:#86efac;}

/* ---- 0.3.0: minimize bubble ---- */
.qar-card-header{touch-action:none;}
.qar-bubble{position:fixed;z-index:99999;display:flex;align-items:center;justify-content:center;
  width:52px;height:52px;border-radius:9999px;border:1px solid ${mix(60)};background:${PANEL};color:${ACCENT};
  box-shadow:0 0 24px -6px ${mix(60)};cursor:pointer;touch-action:none;user-select:none;}
.qar-bubble-count{position:absolute;top:-4px;right:-4px;display:flex;align-items:center;justify-content:center;
  min-width:18px;height:18px;border-radius:9999px;background:${ACCENT};color:${ON_ACCENT};font-size:10px;font-weight:700;padding:0 4px;}

/* ---- 0.3.1: journey loading indicator ---- */
.qar-loading-card{display:flex;flex-direction:column;align-items:center;gap:12px;border-radius:16px;
  border:1px solid ${mix(40)};background:${PANEL};padding:28px 36px;color:#e2e8f0;font-size:14px;font-weight:700;
  box-shadow:0 0 50px -10px ${mix(50)};}
.qar-spinner{width:28px;height:28px;border-radius:9999px;border:3px solid ${mix(25)};
  border-top-color:${ACCENT};animation:qar-spin .8s linear infinite;}
@keyframes qar-spin{to{transform:rotate(360deg);}}

/* ---- 0.3.1: INSTANT tooltips (replace the ~500ms native title delay) ---- */
.qar-theme [data-qatip]{position:relative;}
.qar-theme [data-qatip]:hover::after{content:attr(data-qatip);position:absolute;bottom:calc(100% + 6px);
  left:50%;transform:translateX(-50%);z-index:100001;width:max-content;max-width:230px;white-space:normal;
  border-radius:6px;border:1px solid #334155;background:#0b1020;padding:4px 8px;
  font-size:11px;font-weight:400;line-height:1.4;color:#e2e8f0;text-align:left;pointer-events:none;}
.qar-theme .qar-actions [data-qatip]:hover::after,
.qar-theme .qar-footer [data-qatip]:hover::after{bottom:auto;top:calc(-6px - 2.6em);}

/* ---- 0.3.3: re-queue context ---- */
.qar-revisit{margin:8px 0 0;border-radius:6px;border:1px solid ${mix(55)};background:${mix(12)};
  padding:6px 8px;font-size:12px;font-weight:700;color:${ACCENT};}
.qar-revisit-prior{margin:6px 0 0;font-size:11px;color:#94a3b8;}
`;

const STYLE_ID = "qa-review-styles";

/** Inject the overlay stylesheet once per document. */
export function ensureQAStyles(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = QA_STYLES;
  document.head.appendChild(el);
}
