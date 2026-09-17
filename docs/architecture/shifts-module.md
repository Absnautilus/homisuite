# Turni module architecture

Status: proposed contract for preview and T1. The current database PR remains
draft until this contract is reflected in its schema and pgTAP coverage.

## Product model

Turni is a Homisuite module, not a second application. Core owns the signed-in
identity, property membership, software role, job title and module entitlement.
Turni owns planning units, shift definitions, rule sets, schedules, preferences
and requests.

The module's main aggregate is a **planning unit**: one independently managed
schedule inside a property. Examples are Reception, Housekeeping, Breakfast and
Maintenance. A planning unit is not a separate Postgres table; all units use the
same property-scoped tables and are separated by `planning_unit_id`.

```text
property
  -> planning units
       -> included job titles
       -> members and assignment profiles
       -> shift-code catalogue
       -> active rule-set version
       -> shifts and requests
```

This lets each hotel choose which job titles participate in Turni without
turning Core job titles into software roles or cloning schema per department.

## Identity and access

There is exactly one Homisuite Auth session and one Core profile per person.
Turni never creates credentials and never owns login, logout, password recovery
or account deletion.

The concepts remain separate:

| Concept | Owner | Meaning |
| --- | --- | --- |
| Auth user / Core profile | Core | Who the person is |
| Membership and Core role | Core | Which property they can access and what they may administer |
| Property job title | Core Team | Their real operational job at that property |
| Planning-unit membership | Turni | Which schedules they participate in |
| Assignment profile | Turni | Which shifts they can normally or exceptionally cover |

An administrator selects job titles for a planning unit. Matching active staff
can be included automatically, with explicit per-person include/exclude
overrides. A person may belong to more than one unit; cross-unit overlap checks
must therefore run before publishing a schedule.

The initial capabilities remain:

- `shifts.view`: view units and schedules available at the property;
- `shifts.manage`: configure units/rules and edit or publish schedules;
- `shifts.requests.manage`: decide operational requests.

Entitlement and authorization remain independent. Every capability check must
fail when the `shifts` module is disabled for the property.

## Canonical data model

Every module-owned row carries `property_id`. Unit-owned rows additionally
carry `planning_unit_id`. Composite foreign keys prevent pairing a unit, staff
record or shift code with another property.

### Configuration

- `shift_planning_units`: property, name, slug, status and current rule-set.
- `shift_unit_job_titles`: job titles automatically eligible for a unit.
- `shift_staff_profiles`: property-scoped operational settings linked to one
  Core profile; no name, email, password or admin flag.
- `shift_unit_members`: membership of a staff profile in a planning unit,
  assignment-profile key and explicit include/exclude source.
- `shift_codes`: unit catalogue containing code, label, times, color and kind.
- `shift_rule_sets`: immutable, versioned configuration snapshots. Units point
  to the active version; editing creates a new draft version.

### Operations

- `shifts`: property, unit, staff, date, shift-code reference and lock state.
- `shift_month_states`: draft/final state per unit and month.
- request tables: swap, absence and preassignment, all unit-scoped;
- preferences, read notifications and push subscriptions.

Physical tables are shared by all units. “One shift table per job type” is a UI
view of one planning unit, not schema duplication.

## Rules and presets

Rules are versioned per planning unit. They are not global booleans and are not
hard-coded from the first customer.

A rule set contains:

- assignment profiles and their primary/reserve shift codes;
- rest policy;
- daily coverage requirements;
- hard constraints;
- ordered soft preferences;
- automatic-fill strategies;
- annual quota defaults.

The current Planner behavior becomes the preset
`palazzo-veneziano-reception@1`, applied only to Palazzo Veneziano's Reception
unit. A new property starts from a neutral preset or an explicit copy. Copying a
preset creates a property-owned draft; later edits never mutate another hotel's
configuration.

The runtime must validate rule-set JSON against a versioned TypeScript schema.
Frequently queried data such as shift codes, coverage and active unit
membership remains relational; JSON is reserved for rule parameters whose
shape belongs to the scheduling engine version.

## Palazzo Veneziano preset inventory

Verified from the standalone Planner code:

- coverage defaults: one each of `A1`, `A2`, `C1`, `C2`, `N` per day;
- codes and colors remain the current visual language, including `CE`,
  `D1/D2`, `F1/F2`, rest, leave and absence labels;
- primary profiles: day, rotating, night, director and FOM;
- reserve behavior: `CE` for day/rotating staff; reception shifts for FOM;
- hard constraint: `C2` cannot be followed by `A1`;
- night priority: titular night worker, then rotating backup near their rest;
- rotating backup rests after the night worker;
- automatic alternating `D1/D2` and `F1/F2` strategies;
- automatic `CE` fill after required coverage;
- rotating rest cycle: three two-day rests, then one single rest, shifting one
  weekday backwards; fixed two-day rest is also supported;
- ordered soft criteria: morning/evening balance, avoid `C1->A1` and
  `C2->A2`, distribute uncomfortable sequences, weekly variation, personal
  preference;
- protected assignments: approved absence labels and Do-Not-Move shifts;
- month status: draft or final, with regeneration blocked when final;
- default quotas: 26 leave days and 88 permission hours.

These are migration inputs for one preset, not universal assumptions.

## Module boundary

The workspace lives at `modules/shifts` and exports `ShiftPlannerModule`. The
shell injects the shared Supabase client, active property, current Core profile
and resolved capabilities. The module has no router-level login or duplicate
account chrome.

The module repository layer is the only code allowed to query Turni tables.
The scheduling engine stays pure and receives a rule-set snapshot explicitly,
making the Palazzo preset and generic fixtures testable without Supabase.

## Preview acceptance

Before finalizing T1, a read-only mock preview must demonstrate:

1. Palazzo Veneziano Reception with the existing grid and colors;
2. another unit at the same property with different job titles and rules;
3. a generic hotel with a neutral configuration;
4. unit switching and separate schedule state;
5. selected job titles, automatic inclusion and explicit exclusions;
6. rule-set identity/version and the difference between hard and soft rules;
7. manager and read-only views;
8. desktop and mobile behavior.

The preview uses fixtures only and performs no Supabase reads or writes.

