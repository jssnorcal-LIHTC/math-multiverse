# TODO: coach-tile persistence + explanation robustness + deploy check (26-0714)

Request (Justin, 26-0714):
1. The concept-help tile for repeated misses only shows a few seconds; make it last
   longer or until dismissed (choice deferred to me).
2. Audit the error explanations for robustness; identify weak ones (report, then fix
   on approval or where clear-cut).
3. Confirm the one-row header change is absent live only because it was never pushed.

Plan:
- [x] Load memory + handoffs + lessons; locate coach feature (COACH_TIPS approx 60 entries,
      showCoach, shouldCoach; 6 call sites, one per module; modal z-9999, only
      btn-coach-close hides it; code identical main vs ui/header-one-row)
- [x] Item 3 CONFIRMED: live site lacks marker min(330px,40vh) (0 hits) but has
      coach-modal (3 hits) -> live = pre-UI main build; ui/header-one-row (4 commits)
      never pushed; 26-0710 blocker = read-only PAT
- [x] REPRODUCED headless: the coach modal PERSISTS until "Got it" (14s sample, live
      code identical); the few-seconds tile is the INLINE explain tile, wiped by the
      timed auto-advance (3.6-3.8s), which also ran BEHIND an open coach modal
- [x] Implemented: wrong answers stop auto-advancing; explain tile gains a NEXT button
      (attachExplainNext + .explain-next CSS + 6 module rewires); correct answers keep
      fast auto-advance; FR 3rd-wipeout crash rides the NEXT tap; scrollIntoView keeps
      NEXT on-screen (RC clipped it). Commit 8517e61 on ui/header-one-row.
- [x] Topic coverage audited by script: 19 emitted topics had NO COACH_TIPS entry
      (coach silently dead; 60 percent of F1 L1). Authored 19 tips + family fallback
      in showCoach. Re-audit: 0 dead topics, labels all covered.
- [x] Quality audit of q.explain strings fanned out to subagents; consolidated report
      at tasks/explain-audit-26-0714.md (findings for Justin's call before rewrites)
- [x] npm test (fuzz + smoke) ALL CLEAN; 6-module sweep 36 ok / 0 fail
- [x] Update handoff + memory; report findings + deploy answer to Justin
