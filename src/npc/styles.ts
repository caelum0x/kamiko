/**
 * styles.ts — the ONE stylesheet the $NPC funnel surfaces inside amica render with.
 *
 * The game and the holder dashboard are the same product with the same chrome, and they used to be
 * two copies of the same 40 rules — which is how the two pages drift into looking like two products.
 * Scoped under `.npcg-root` on purpose: amica is a large app with its own Tailwind build, and these
 * pages take over the viewport, so the rules must not leak into anything else amica renders.
 */
export const NPC_CSS = `
.npcg-root{--bg:#07070c;--panel:#0e0e18;--line:#1c1c2e;--neon:#00ffa3;--violet:#8b5cf6;--dim:#7a7a92;--ink:#e8e8f2;--bad:#ff2e63;--warn:#ffb020;
  position:fixed;inset:0;overflow:auto;background:radial-gradient(900px 500px at 50% -5%,#15152c,var(--bg) 60%);color:var(--ink);font-family:ui-monospace,Menlo,Consolas,monospace;z-index:50}
.npcg-wrap{max-width:420px;margin:0 auto;padding:24px 16px 80px}
.npcg-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px}
.npcg-logo{font-size:20px;font-weight:800}.npcg-logo b{color:var(--neon)}
.npcg-ca{background:none;border:0;color:var(--dim);font:inherit;font-size:11px;cursor:pointer}
.npcg-stage{position:relative;border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:28px 16px;text-align:center}
.npcg-line{min-height:34px;font-size:13px;line-height:1.5;color:var(--ink)}.npcg-line.dim{color:var(--dim)}
.npcg-face{background:none;border:0;cursor:pointer;line-height:0;margin:10px auto;padding:0;display:block;transition:transform .05s}.npcg-face:active{transform:scale(.95)}.npcg-face.sleepy{opacity:.82}
.npcg-face svg{width:136px;height:136px;display:block}
.npcg-ic{display:inline-block;vertical-align:-.18em;flex:0 0 auto}
.npcg-daily{display:inline-block;margin-right:6px;padding:1px 6px;border:1px solid var(--neon);border-radius:5px;color:var(--neon);font-size:9px;letter-spacing:1.5px;vertical-align:1px}
.npcg-coach{margin-bottom:8px;font-size:13px}.npcg-coach b{color:var(--neon)}.npcg-coach div{font-size:11px;color:var(--dim)}
.npcg-bar-row{display:flex;justify-content:space-between;font-size:10px;letter-spacing:2px;color:var(--dim);margin-bottom:4px}
.npcg-bar{height:8px;border-radius:99px;background:var(--line);overflow:hidden}.npcg-bar>span{display:block;height:100%;background:linear-gradient(90deg,var(--violet),var(--neon));transition:width .2s}
.npcg-float{position:fixed;transform:translate(-50%,0);color:var(--neon);font-weight:800;pointer-events:none;animation:npcg-up .9s ease-out forwards;z-index:60}
@keyframes npcg-up{from{opacity:1;transform:translate(-50%,0)}to{opacity:0;transform:translate(-50%,-40px)}}
.npcg-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.npcg-card{border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:12px}
.npcg-span{grid-column:span 2}
.npcg-k{font-size:10px;letter-spacing:2px;color:var(--dim)}
.npcg-v{font-size:18px;font-weight:700}.npcg-v.neon{color:var(--neon)}
.npcg-sub{font-size:10px;color:var(--dim);margin-top:4px}
.npcg-cta-row{display:flex;gap:8px;margin-top:12px}
.npcg-buy{flex:1;text-align:center;padding:12px;border-radius:12px;font-weight:800;text-decoration:none;color:#04120b;background:linear-gradient(90deg,var(--violet),var(--neon))}
.npcg-chart{flex:1;text-align:center;padding:12px;border-radius:12px;font-weight:700;text-decoration:none;color:var(--ink);border:1px solid var(--line)}
.npcg-notice{margin-top:12px;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:12px;line-height:1.5;color:var(--dim)}
.npcg-notice.unsafe{border-color:var(--bad);color:var(--bad)}.npcg-notice.caution{border-color:var(--warn);color:var(--warn)}
.npcg-btn{margin-top:12px;width:100%;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:12px;padding:12px;font:inherit;font-weight:700;cursor:pointer}
.npcg-panel{margin-top:20px;border:1px solid var(--line);background:var(--panel);border-radius:12px;padding:12px}
.npcg-panel h3{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:var(--dim);margin:0 0 8px}
.npcg-lb{display:flex;justify-content:space-between;border-bottom:1px dashed var(--line);padding:8px 0;font-size:13px}
.npcg-rank{color:var(--dim);margin-right:8px}.neon{color:var(--neon)}
.npcg-muted{font-size:12px;color:var(--dim)}.npcg-center{text-align:center;min-height:14px;margin-top:4px}
.npcg-quest{margin-bottom:8px}.npcg-quest.done{opacity:.7}
.npcg-quest-top{display:flex;justify-content:space-between;font-size:12px}
.npcg-quest-bar{height:6px;border-radius:99px;background:var(--line);overflow:hidden;margin:4px 0}.npcg-quest-bar>span{display:block;height:100%;background:linear-gradient(90deg,var(--violet),var(--neon))}
.npcg-links{display:flex;justify-content:center;gap:16px;margin-top:16px;font-size:12px}.npcg-links a{color:var(--dim);text-decoration:none;display:inline-flex;align-items:center;gap:5px}.npcg-links a:hover{color:var(--ink)}
.npcg-fine{margin-top:24px;text-align:center;font-size:10px;line-height:1.6;color:var(--dim)}
/* ---- holder dashboard ---- */
.npcg-input{width:100%;box-sizing:border-box;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:10px;padding:10px 12px;font:inherit;font-size:13px}
.npcg-input:disabled{opacity:.5}
.npcg-row{display:flex;gap:8px;margin-top:8px}
.npcg-row .npcg-input{flex:1}
.npcg-go{border:0;border-radius:10px;padding:0 16px;font:inherit;font-weight:800;color:#04120b;background:linear-gradient(90deg,var(--violet),var(--neon));cursor:pointer}
.npcg-go:disabled{opacity:.5;cursor:default}
.npcg-primary{margin-top:12px;width:100%;border:0;border-radius:12px;padding:13px;font:inherit;font-weight:800;color:#04120b;background:linear-gradient(90deg,var(--violet),var(--neon));cursor:pointer}
.npcg-primary:disabled{opacity:.5;cursor:default}
.npcg-note{margin-top:8px;min-height:16px;font-size:11px;line-height:1.6;color:var(--dim);word-break:break-word}
.npcg-note.bad{color:var(--bad)}.npcg-note.warn{color:var(--warn)}.npcg-note.good{color:var(--neon)}
.npcg-sig{color:var(--neon);word-break:break-all;font-size:10px}
.npcg-tier{font-size:22px;font-weight:800;color:var(--neon)}
.npcg-perks{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.npcg-perk{border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:10px;color:var(--dim)}
.npcg-topic{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed var(--line);padding:6px 0;font-size:12px}
.npcg-topic span:last-child{color:var(--dim);white-space:nowrap}
`;
