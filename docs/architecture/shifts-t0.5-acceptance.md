# Turni T0.5 acceptance

Status: accepted product and architecture gate for T1. This document records
what the fixture-only preview proves and what it deliberately does not prove.
No production database behavior is implied.

## Decisions frozen for T1

| Area | Accepted decision |
| --- | --- |
| Identity | One Supabase Auth session and one Core profile. Turni never creates credentials or duplicates personal identity. |
| Property scope | Every Turni row is property-scoped. Unit-owned rows also carry `planning_unit_id`. |
| Participation | Core Team owns job titles; Turni selects eligible job titles and supports explicit per-person include/exclude overrides. |
| Multiple schedules | A property can have multiple planning units. Reception, Housekeeping and other units are views over shared normalized tables, not duplicated schemas. |
| Assignment profile | Shift type/profile belongs to the person's unit membership, not to their Core role or Core job title. |
| Rest policy | Rest mode and fixed-day configuration are scheduling metadata; they never change Core identity or authorization. |
| Rules | Rules are immutable, versioned snapshots per planning unit. Palazzo Veneziano Reception uses its own `palazzo-veneziano-reception@1` preset. |
| Other hotels | New hotels start from a neutral preset or an explicit copy. No Palazzo-specific rule becomes a global default. |
| Authorization | `shifts.view`, `shifts.manage` and `shifts.requests.manage`; module entitlement is checked independently and all checks fail closed. |
| Existing data | All 11 legacy employees must be mapped or explicitly excluded and all 1,357 shifts reconciled before cutover. |
| UI | Original operational tabs and calendar language remain; Homisuite owns shell styling. Original Planner motion and calendar colors may be retained. |

## Preview acceptance matrix

| Requirement | Evidence in the fixture preview | Result |
| --- | --- | --- |
| Palazzo Reception retains grid and shift colors | Reception unit exposes the original codes, colors, monthly/weekly views and legend | Accepted |
| Multiple units in one property | Palazzo Veneziano exposes Reception and Housekeeping with independent people, codes and rules | Accepted |
| Neutral second hotel | Hotel Aurora uses a separate neutral Front Office configuration | Accepted |
| Unit switching | Calendar and rules screens switch unit-scoped fixtures without changing property identity | Accepted |
| Property-wide staff setup | Dipendenti shows the property roster and edits unit, assignment profile and rest policy locally | Accepted |
| Rule identity/version | Regole turni shows unit name, rule-set name/version, coverage, hard rules and soft priorities | Accepted |
| Manager vs employee | Preview role switch removes manager-only configuration tabs while retaining personal workflows | Accepted |
| Original workflows | Calendar, personal calendar/export, preferences, swaps, leave/permissions and preassignments remain represented | Accepted |
| Responsive intent | CSS includes narrow-layout behavior and horizontally scrollable dense calendars/tables | Accepted for implementation; browser matrix remains a release test |

## What the preview does not validate

- Supabase schema, grants, RLS or capability enforcement;
- persistence, concurrent edits or realtime updates;
- automatic scheduling correctness;
- production identity mapping or historical row reconciliation;
- cross-unit overlap detection before publication;
- actual request approval state machines;
- authenticated browser behavior at all target viewports.

These are not preview defects. They are explicit gates for T1–T4 and must be
covered by migrations, pgTAP, pure-domain tests, rehearsal and authenticated
browser tests respectively.

## T1 entry criteria

T1 may now create additive shared schema only. It must:

1. create configuration tables before operational tables;
2. add the three capability slugs and reviewed role grants;
3. use composite property/unit foreign keys to prevent cross-property pairing;
4. enable RLS on every exposed table and test read/write matrices with pgTAP;
5. keep the `shifts` entitlement disabled in production;
6. contain no legacy data copy, identity guessing or production apply;
7. leave the standalone Planner and its database untouched.

T2 migration tooling starts only after the T1 schema and authorization matrix
are independently reviewed and green in CI.
