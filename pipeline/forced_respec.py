"""Check the planner's reading of each class's forced level-up respec against the client.

Standard library only (pipeline.export needs the game's tools), so CI can test it:
python -m unittest pipeline.forced_respec_test.
"""
from __future__ import annotations


def forced_respec_warnings(classes: list[dict], class_cats: dict[str, dict[str, str]],
                           cats: dict[str, dict], sets: dict[str, dict]) -> list[str]:
    """Warn about every class whose forced level-up respec isn't where the planner looks for it.

    The export leaves a class's LevelUpRespecs out: the planner (levelUpRespec in
    src/engine/rules.ts) takes it to be the level its specialization sets open at (SpecializeAt
    + 1, 1-based), as it is for every class today (Arachnos Soldier and Widow: 24), and plans
    those classes as Respec builds only. A class where the two differ needs the planner changed
    before its builds are planned right.

    @param classes The client's classes (LiveData.classes): each one's Name and LevelUpRespecs.
    @param class_cats Each class's category names by kind, "pri" and "sec" (Exporter.class_cats).
    @param cats Categories by lower-case name, each with its PowerSets (Exporter.cats).
    @param sets Power sets by name, each with its SpecializeAt (Exporter.sets).
    @return One warning per class that breaks the rule.
    """
    out = []
    for c in classes:
        names = class_cats.get(c["Name"])
        if not names:
            continue
        opens = sorted({sets[s]["SpecializeAt"] + 1 for k in ("pri", "sec")
                        for s in (cats.get(names[k].lower()) or {}).get("PowerSets", [])
                        if s in sets and sets[s].get("SpecializeAt")})
        # an int array in the parse table (TOK_INTARRAY); a lone value or none is read as one
        raw = c.get("LevelUpRespecs") or []
        respecs = sorted({v for v in (raw if isinstance(raw, (list, tuple)) else [raw]) if v})
        if respecs != opens[:1]:
            out.append(f"WARNING: {c['Name']} respecs on training to {respecs or 'no level'}, but its "
                       f"specialization sets open at {opens or 'no level'}: the planner assumes one "
                       "respec, at the level they open (levelUpRespec in src/engine/rules.ts)")
    return out
