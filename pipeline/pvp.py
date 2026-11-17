"""Which effect groups only ever apply in PvP, by their requirement (Requires).

The export drops PvP-only groups (the planner models PvE). A group is PvP-only by its requirement
when it tests for a player target (`enttype target> player eq`) and the expression can never hold
in PvE: against a critter target, on a map that isn't a PvP map. The test runs the game's postfix
evaluator (eval.c, character_combat_eval.c) over three values (true, false, unknown): the target's
entity type is "critter" and `isPvPMap?` is false; everything else the expression asks (the
target's rank, the caster's powers, modes, tags, variables) is unknown, and values work as eval.c
works them (32-bit floats, ints, strings). A group is dropped only when the result is false
whatever the unknowns are, so a group that tests for a player target among other things ("a boss
or a player": Stygian Circle's 428.36 heal, in game on Thunderspy) is kept. A group that never
tests for a player target is never taken for PvP-only, whatever it reads (a requirement of 0,
`isPvPMap?` alone): those stay as the data has them.

@TODO "A critter target" is the PvE target of an attack. A power aimed at the player's side (an
ally's heal, the caster's own buff) has a player target in PvE too; like the test before it, this
one reads every target as a critter (Empathy's Adrenaline Boost heal, Shield Defense's Phalanx
Fighting teammate bonus).
"""
from __future__ import annotations

import math
import re
import struct

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

# What eval.c reads as a number: a token with a "." through strtod (all of it), else strtol(10)
FLOAT_TOKEN = re.compile(r"[+-]?(\d+\.\d*|\.\d+)([eE][+-]?\d+)?")
INT_TOKEN = re.compile(r"[+-]?\d+")


def _f32(x: float) -> float:
    """@return x rounded to a 32-bit float, as the game's evaluator holds it."""
    try:
        return struct.unpack("f", struct.pack("f", x))[0]
    except OverflowError:
        return math.copysign(math.inf, x)


def _literal(tok: str):
    """@return The token as eval.c reads it: a float (it holds a "."), an int, or the string."""
    if "." in tok:
        return _f32(float(tok)) if FLOAT_TOKEN.fullmatch(tok) else tok
    return int(tok) if INT_TOKEN.fullmatch(tok) else tok


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and v is not UNKNOWN


def _int(v):
    """@return v as eval.c's eval_IntPop reads it (a float truncated), or None when unknown (a
    string goes through the ownership hook: unknown)."""
    if isinstance(v, float):
        return 0 if math.isnan(v) else int(math.copysign(min(abs(v), 2**31), v))
    if isinstance(v, int):
        return v
    return None


def _truth(v):
    """@return True, False, or None when unknown."""
    i = _int(v)
    return None if i is None else i != 0


def _apply(name: str, args: list) -> list:
    """@return The values one function leaves, given its arguments (oldest first), as eval.c."""
    if name in ("&&", "||"):
        a, b = (_truth(x) for x in args)
        if name == "&&":
            return [0 if a is False or b is False else 1 if a and b else UNKNOWN]
        return [1 if a or b else 0 if a is False and b is False else UNKNOWN]
    if name == "!":
        t = _truth(args[0])
        return [UNKNOWN if t is None else int(not t)]
    if name == "eq" or (name == "==" and all(isinstance(x, str) for x in args)):
        a, b = args
        if isinstance(a, str) and isinstance(b, str):
            return [int(a.lower() == b.lower())]
        # eq on anything but two strings is 0; an unknown might be a string
        return [0 if _is_num(a) or _is_num(b) else UNKNOWN]
    if name == "target>":
        # the target's entity type is a critter's in PvE; anything else about it is unknown
        return ["critter" if isinstance(args[0], str) and args[0].lower() == "enttype" else UNKNOWN]
    if name == "ispvpmap?":
        return [0]
    if name == "dup":
        return [args[0], args[0]]
    if name in (">", "<", ">=", "<=", "==", "+", "-", "*"):
        a, b = args
        if not (_is_num(a) and _is_num(b)):
            return [UNKNOWN]
        floats = isinstance(a, float) or isinstance(b, float)
        if floats:  # NUMERIC_OP: both popped as floats unless both are ints
            a, b = _f32(float(a)), _f32(float(b))
        if name in ("+", "-", "*"):
            r = a + b if name == "+" else a - b if name == "-" else a * b
            return [_f32(r) if floats else int(r)]
        return [int({">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b, "==": a == b}[name])]
    if name in ("/", "pow", "minmax", "negate"):
        if not all(_is_num(x) for x in args):
            return [UNKNOWN]
        if name == "negate":
            return [-args[0]]
        f = [_f32(float(x)) for x in args]
        if name == "/":
            return [0.0 if f[1] == 0 else _f32(f[0] / f[1])]
        if name == "minmax":
            val, lo, hi = f
            return [lo if val < lo else hi if val > hi else val]
        try:
            return [_f32(math.pow(f[0], f[1]))]
        except OverflowError:  # powf gives an infinity
            odd = f[0] < 0 and f[1].is_integer() and int(f[1]) % 2 == 1
            return [-math.inf if odd else math.inf]
        except ValueError:  # a negative base to a fraction: powf's NaN
            return [UNKNOWN]
    if name == "%":
        a, b = (_int(x) if _is_num(x) else None for x in args)
        if a is None or b is None:
            return [UNKNOWN]
        return [0 if b == 0 else int(math.fmod(a, b))]  # C's %: the sign follows the dividend
    return [UNKNOWN] * ARITY.get(name, (1, 1))[1]


def pvp_requires_v1(req: list[str]) -> bool:
    """The test the export used before pvp_requires (every version published before it: i28p4,
    i28p3, ts9-6): a player-target test anywhere, unless a critter-target test is there too.

    Only to remake such a version, or a file beside it, as it was made (PVP_TESTS).

    @param req The group's Requires tokens.
    @return Whether that test took the group for PvP-only.
    """
    low = [t.strip().lower() for t in req]
    has = lambda seq: any(low[i:i + len(seq)] == seq for i in range(len(low) - len(seq) + 1))  # noqa: E731
    return has(PLAYER_TEST) and not has(["enttype", "target>", "critter", "eq"])


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
        if tok[0] in "@$":
            st.append(UNKNOWN)  # a variable or a property (@CustomFX, $level): eval.c checks these first
            continue
        name = tok.lower()
        if name in FLOW:
            return False
        if name in ARITY or name.endswith(("?", ">")):
            k = ARITY.get(name, (1, 1))[0]
            args = [st.pop() if st else UNKNOWN for _ in range(k)][::-1]
            st.extend(_apply(name, args))
            continue
        st.append(_literal(tok))
    return bool(st) and _truth(st[-1]) is False


# The PvP-only tests by the number a version's manifest records (pvpTest; none: 1), and the one a
# new version is made with. A version keeps its own, so remaking it, or a file beside it, gives
# what was published.
PVP_TESTS = {1: pvp_requires_v1, 2: pvp_requires}
PVP_TEST = 2
