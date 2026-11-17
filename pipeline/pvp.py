"""Which effect groups only ever apply in PvP, by their requirement (Requires).

The export drops PvP-only groups (the planner models PvE). A group is PvP-only by its requirement
when it tests for a player target (`enttype target> player eq`) and the expression can never hold
in PvE: against a critter target, on a map that isn't a PvP map. The test runs the game's postfix
evaluator (eval.c, character_combat_eval.c) over three values (true, false, unknown): the target's
entity type is "critter" and `isPvPMap?` is false; everything else the expression asks (the
target's rank, the caster's powers, modes, tags, variables, values) is unknown. A group is dropped
only when the result is false whatever the unknowns are, so a group that tests for a player target
among other things ("a boss or a player": Stygian Circle's 428.36 heal, in game on Thunderspy) is
kept. A group that never tests for a player target is never taken for PvP-only, whatever it reads
(a requirement of 0, `isPvPMap?` alone): those stay as the data has them.
"""
from __future__ import annotations

# A value the expression can't know in the planner (a target's rank, a mode, a tag ...).
UNKNOWN = object()

# How many values each of the evaluator's functions takes and leaves, by lower-case name: eval.c's
# s_FuncTable and the source's eval_RegisterFunc calls (character_eval.c, character_combat_eval.c,
# ...). Every other name ending in "?" or ">" takes one and leaves one (as all the others there
# do); any other token is a literal.
ARITY = {
    "&&": (2, 1), "||": (2, 1), "!": (1, 1), ">": (2, 1), "<": (2, 1), ">=": (2, 1), "<=": (2, 1),
    "==": (2, 1), "eq": (2, 1), "+": (2, 1), "*": (2, 1), "/": (2, 1), "%": (2, 1), "-": (2, 1),
    "pow": (2, 1), "negate": (1, 1), "rand": (0, 1), "minmax": (3, 1), ">var": (2, 0),
    ">var+": (2, 0), "forget": (1, 0), "dup": (1, 2), "drop": (1, 0), "label": (1, 0), ":": (1, 0),
    # the functions that take nothing
    **{n.lower(): (0, 1) for n in (
        "CanGiveRespec?", "HasAnyActiveMission?", "HasFreespec?", "IsReactivationActive?",
        "LoyaltyNodesBought>", "LoyaltyPointsEarned>", "MissionStarted?", "OnArchitect?",
        "OnFlashback?", "OnTaskForce?", "TFChallenge.buffedEnemies", "TFChallenge.debuffedGroup",
        "TFChallenge.noEnhancements", "TFChallenge.noInspirations", "TaskOwner?", "badgecount",
        "ccemote?", "devMode?", "distance", "eventLockedByGroup?", "isAccountInventoryLoaded?",
        "isAccountServerAvailable?", "isArchitectMap?", "isBetaShard?", "isHazardMap?",
        "isHeroAndVillainMap?", "isHeroOnlyMap?", "isMissionMap?", "isPvPMap?", "isTrialMap?",
        "isVIP?", "isVillainOnlyMap?", "mapTeamArea>", "mapname>", "now", "power.attacktypecount>",
        "sg.BadgeCount", "sg.EmptyIoPMounts", "source.LoyaltyPointsEarned>",
        "source.isAccountInventoryLoaded?", "source.isAccountServerAvailable?", "source.isVIP?",
        "source.mapTeamArea>", "target.LoyaltyPointsEarned>", "target.isAccountInventoryLoaded?",
        "target.isAccountServerAvailable?", "target.isFriend?", "target.isVIP?", "target.mapTeamArea>")},
}

# Control flow the export can't follow: a requirement using it is never taken for PvP-only.
FLOW = {"if", "then", "endif", "goto", "gotoif"}

# The test for a player target, lower case.
PLAYER_TEST = ["enttype", "target>", "player", "eq"]


def _num(tok: str):
    """@return The token as a number, or None when it isn't one."""
    try:
        return int(tok)
    except ValueError:
        pass
    try:
        return float(tok)
    except ValueError:
        return None


def _truth(v):
    """@return True, False, or None when unknown (a string reads as owning a power: unknown)."""
    if v is UNKNOWN or isinstance(v, str):
        return None
    return v != 0


def _apply(name: str, args: list):
    """@return The values one function leaves, given its arguments (oldest first)."""
    if name == "&&":
        a, b = (_truth(x) for x in args)
        return [0 if a is False or b is False else 1 if a and b else UNKNOWN]
    if name == "||":
        a, b = (_truth(x) for x in args)
        return [1 if a or b else 0 if a is False and b is False else UNKNOWN]
    if name == "!":
        t = _truth(args[0])
        return [UNKNOWN if t is None else int(not t)]
    if name == "eq":
        a, b = args
        return [int(a.lower() == b.lower()) if isinstance(a, str) and isinstance(b, str) else UNKNOWN]
    if name == "target>":
        # the target's entity type is a critter's in PvE; anything else about it is unknown
        return ["critter" if isinstance(args[0], str) and args[0].lower() == "enttype" else UNKNOWN]
    if name == "ispvpmap?":
        return [0]
    if name == "dup":
        return [args[0], args[0]]
    nums = all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in args)
    if nums and name in (">", "<", ">=", "<=", "==", "+", "-", "*", "/", "%", "pow", "negate", "minmax"):
        a = args[0]
        b = args[1] if len(args) > 1 else None
        try:
            return [{">": lambda: int(a > b), "<": lambda: int(a < b), ">=": lambda: int(a >= b),
                     "<=": lambda: int(a <= b), "==": lambda: int(a == b), "+": lambda: a + b,
                     "-": lambda: a - b, "*": lambda: a * b, "/": lambda: a / b,
                     "%": lambda: int(a) % int(b), "pow": lambda: a ** b, "negate": lambda: -a,
                     "minmax": lambda: min(args[2], max(args[1], a))}[name]()]
        except (ZeroDivisionError, OverflowError, ValueError):
            return [UNKNOWN]
    return [UNKNOWN] * ARITY.get(name, (1, 1))[1]


def pvp_requires(req: list[str]) -> bool:
    """Whether a requirement can never hold in PvE (a critter target, not a PvP map).

    @param req The group's Requires tokens (postfix).
    @return True when it tests for a player target and is false whatever the planner can't know;
        False when it may hold, when it tests for no player target, or when it uses control flow.
    """
    low = [t.strip().lower() for t in req]
    n = len(PLAYER_TEST)
    if not any(low[i:i + n] == PLAYER_TEST for i in range(len(low) - n + 1)):
        return False
    st: list = []
    for raw in req:
        tok = raw.strip()
        if not tok:
            continue
        name = tok.lower()
        if name in FLOW:
            return False
        if name in ARITY or name.endswith(("?", ">")):
            n = ARITY.get(name, (1, 1))[0]
            args = [st.pop() if st else UNKNOWN for _ in range(n)][::-1]
            st.extend(_apply(name, args))
            continue
        if tok[0] in "@$":
            st.append(UNKNOWN)  # a variable or a property (@CustomFX, $level): unknown
            continue
        v = _num(tok)
        st.append(tok if v is None else v)
    return bool(st) and _truth(st[-1]) is False
