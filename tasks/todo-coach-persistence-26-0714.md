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
- [ ] REPRODUCE the few-seconds disappearance headless (GPU-safe flags) before editing;
      code says the coach modal persists until "Got it" -> either something hides it
      (find it) or the user's "tile" is the inline explain tile (fr-explain et al.,
      wiped by next-question render at approx 3.6s)
- [ ] Implement persistence fix for the real culprit surface
- [ ] Audit explanations for robustness: COACH_TIPS entries AND per-question q.explain
      strings AND topic-key coverage (old Phase-3 finding: coach topic keys mismatched,
      4/8 dead in floating-bear; razor missing tips; re-verify against current code)
- [ ] Run npm test (fuzz + smoke) after any edit; commit on ui/header-one-row
- [ ] Update handoff + memory; report findings + deploy answer to Justin
