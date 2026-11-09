#!/usr/bin/env python3
"""Transcribed ParseTables for the City of Heroes power dictionary bins.

Mirrors the engine parse tables (line refs into
CityOfHeroes_OuroV2_Source/Common/entity/powers_load.c and attribmod.h) so
parse_bin.BinReader can decode powercats.bin / powersets.bin / powers.bin.

Only the on-disk shape matters here: field order, base type, and storage
class. Parse-only options (TOK_STRUCTPARAM, enum names, defaults) do not
affect the byte stream and are dropped or kept only as labels. Fields marked
TOK_REDUNDANTNAME in the source are omitted -- the engine skips them on read.
"""

from parse_bin import (
    Column,
    TOK_INT_X, TOK_INT64_X, TOK_F32_X, TOK_BOOL_X, TOK_U8_X, TOK_CONDRGB_X,
    TOK_STRING_X, TOK_CURRENTFILE_X, TOK_FILENAME_X, TOK_STRUCT_X, TOK_IGNORE,
    TOK_EARRAY, TOK_FIXED_ARRAY, TOK_INDIRECT,
)

# ---- concise column builders (mirror the TOK_* macros) --------------------
def I(name, enum=None, minv=0):                 # TOK_INT
    return Column(name, TOK_INT_X, enum=enum, minversion=minv)

def F(name, minv=0):                            # TOK_F32
    return Column(name, TOK_F32_X, minversion=minv)

def B(name, enum=None, minv=0):                 # TOK_BOOL (u8 on disk, 4 bytes)
    return Column(name, TOK_BOOL_X, enum=enum, minversion=minv)

def S(name, minv=0):                            # TOK_STRING
    return Column(name, TOK_INDIRECT | TOK_STRING_X, minversion=minv)

def CURFILE(name):                              # TOK_CURRENTFILE
    return Column(name, TOK_INDIRECT | TOK_CURRENTFILE_X)

def FNAME(name, minv=0):                        # TOK_FILENAME
    return Column(name, TOK_INDIRECT | TOK_FILENAME_X, minversion=minv)

def IGNORE(name):                               # TOK_IGNORE (no bytes)
    return Column(name, TOK_IGNORE)

def SARR(name, minv=0):                         # TOK_STRINGARRAY
    return Column(name, TOK_INDIRECT | TOK_EARRAY | TOK_STRING_X,
                  minversion=minv)

def IARR(name, enum=None, minv=0):              # TOK_INTARRAY
    return Column(name, TOK_EARRAY | TOK_INT_X, enum=enum, minversion=minv)

def FARR(name, minv=0):                         # TOK_F32ARRAY
    return Column(name, TOK_EARRAY | TOK_F32_X, minversion=minv)

def AUTOINT(name, enum=None):                   # TOK_AUTOINT (int-sized field)
    return Column(name, TOK_INT_X, enum=enum)

def AUTOINTEARRAY(name):                        # TOK_AUTOINTEARRAY (ptr earray)
    # Elements are resolved pointers (8 bytes on the 64-bit build); in the
    # shipped bins these are written pre-resolution so the count is 0 and the
    # element width is irrelevant. datasum validation confirms.
    return Column(name, TOK_EARRAY | TOK_INT64_X)

def VEC3(name):                                 # TOK_VEC3
    return Column(name, TOK_FIXED_ARRAY | TOK_F32_X, param=3)

def RGBA(name):                                 # TOK_RGBA
    return Column(name, TOK_FIXED_ARRAY | TOK_U8_X, param=4)

def CONDRGB(name):                              # TOK_CONDRGB
    return Column(name, TOK_FIXED_ARRAY | TOK_CONDRGB_X, param=4)

def STRUCT(name, subtable, minv=0):             # TOK_STRUCT (earray of structs)
    return Column(name, TOK_INDIRECT | TOK_EARRAY | TOK_STRUCT_X,
                  subtable=subtable, minversion=minv)


# ---- ParsePowerCategory (powers_load.c:2265) ------------------------------
ParsePowerCategory = [
    CURFILE("SourceFile"),
    S("Name"),
    S("DisplayName"),
    S("DisplayHelp"),
    S("DisplayShortHelp"),
    SARR("PowerSets"),          # ppPowerSetNames
    AUTOINTEARRAY("ppPowerSets"),
    IGNORE("Available"),
]

# ---- ParseBasePowerSet (powers_load.c:2228) -------------------------------
ParseBasePowerSet = [
    CURFILE("SourceFile"),
    S("FullName"),
    S("Name"),
    I("System"),
    B("Shared"),
    S("DisplayName"),
    S("DisplayHelp"),
    S("DisplayShortHelp"),
    S("IconName"),
    SARR("CostumeKeys"),
    SARR("CostumeParts"),
    S("SetAccountRequires"),
    S("SetAccountTooltip"),
    S("SetAccountProduct"),
    SARR("SetBuyRequires"),
    S("SetBuyRequiresFailedText"),
    I("ShowInInventory"),
    B("ShowInManage"),
    B("ShowInInfo"),
    I("SpecializeAt"),
    SARR("SpecializeRequires"),
    SARR("Powers"),             # ppPowerNames
    AUTOINTEARRAY("ppPowers"),
    IARR("Available"),
    IARR("AIMaxLevel"),
    IARR("AIMinRankCon"),
    IARR("AIMaxRankCon"),
    IARR("MinDifficulty"),
    IARR("MaxDifficulty"),
    I("ForceLevelBought"),
]

# ---- ParsePowerVar (powers_load.c:1953) -----------------------------------
ParsePowerVar = [
    I("Index"),
    S("Name"),
    F("Min"),
    F("Max"),
]

# ---- ParseSuppressPair (powers_load.c:650) --------------------------------
ParseSuppressPair = [
    I("Event"),
    I("Seconds"),
    B("Always"),
]

# ---- ParsePowerFX macro (powers_load.c:1965) ------------------------------
# Flattened identically into BasePower and PowerCustomFX. REDUNDANTNAME rows
# are dropped (engine skips them on read); duplicate-target and TOK_IGNORE
# rows are kept because the engine still (de)serializes them in order.
def power_fx_columns():
    return [
        IARR("AttackBits"), IARR("BlockBits"), IARR("WindUpBits"),
        IARR("HitBits"), IARR("DeathBits"), IARR("ActivationBits"),
        IARR("DeactivationBits"), IARR("InitialAttackBits"),
        IARR("ContinuingBits"), IARR("ConditionalBits"),
        FNAME("ActivationFX"), FNAME("DeactivationFX"), FNAME("AttackFX"),
        FNAME("HitFX"), FNAME("WindUpFX"), FNAME("BlockFX"), FNAME("DeathFX"),
        FNAME("InitialAttackFX"),
        FNAME("ContinuingFX"), FNAME("ContinuingFX1"), FNAME("ContinuingFX2"),
        FNAME("ContinuingFX3"), FNAME("ContinuingFX4"),
        FNAME("ConditionalFX"), FNAME("ConditionalFX1"),
        FNAME("ConditionalFX2"), FNAME("ConditionalFX3"),
        FNAME("ConditionalFX4"),
        IARR("ModeBits"), I("FramesBeforeHit"),
        B("DelayedHit"), IGNORE("TogglePower"),
        I("AttackFrames"),
        I("InitialFramesBeforeHit"), I("InitialAttackFXFrameDelay"),
        F("ProjectileSpeed"), I("InitialFramesBeforeBlock"),
        S("IgnoreAttackTimeErrors"), I("FramesBeforeBlock"), B("FXImportant"),
        CONDRGB("PrimaryTint"), CONDRGB("SecondaryTint"),
    ]

# ---- ParsePowerCustomFX (powers_load.c:2038) ------------------------------
ParsePowerCustomFX = [
    S("Token"),
    SARR("AltTheme"),
    CURFILE("SourceFile"),
    S("Category"),
    S("DisplayName"),
    *power_fx_columns(),
    S("Palette"),
]

# ---- ParseAttribModTemplate (attribmod.h:659) -----------------------------
ParseAttribModTemplate = [
    S("Name"),
    S("DisplayAttackerHit"),
    S("DisplayVictimHit"),
    S("DisplayFloat"),
    S("DisplayAttribDefenseFloat"),
    B("ShowFloaters"),
    AUTOINT("Attrib"),
    AUTOINT("Aspect"),
    B("BoostIgnoreDiminishing"),
    I("Target"),
    S("Table"),
    F("Scale"),
    I("ApplicationType"),
    I("Type"),
    F("Delay"),
    F("Period"),
    F("Chance"),
    B("CancelOnMiss"),
    IARR("CancelEvents"),
    B("NearGround"),
    B("AllowStrength"),
    B("AllowResistance"),
    B("UseMagnitudeResistance"),
    B("UseDurationResistance"),
    B("AllowCombatMods"),
    B("UseMagnitudeCombatMods"),
    B("UseDurationCombatMods"),
    B("BoostTemplate"),
    SARR("Requires"),
    SARR("PrimaryStringList"),
    SARR("SecondaryStringList"),
    I("CasterStackType"),
    I("StackType"),
    I("StackLimit"),
    I("StackKey"),
    F("Duration"),
    SARR("DurationExpr"),
    F("Magnitude"),
    SARR("MagnitudeExpr"),
    F("RadiusInner"),
    F("RadiusOuter"),
    STRUCT("Suppress", ParseSuppressPair),
    S("IgnoreSuppressErrors"),
    IARR("ContinuingBits"),
    FNAME("ContinuingFX"),
    IARR("ConditionalBits"),
    FNAME("ConditionalFX"),
    FNAME("CostumeName"),
    S("Reward"),
    S("Params"),
    S("EntityDef"),
    S("PriorityListDefense"),
    S("PriorityListOffense"),
    S("PriorityListPassive"),
    B("DisplayOnlyIfNotZero"),
    B("MatchExactPower"),
    B("VanishEntOnTimeout"),
    B("DoNotTint"),
    B("KeepThroughDeath"),
    B("DelayEval"),
    I("BoostModAllowed"),
    I("EvalFlags"),
    F("ProcsPerMinute"),
]

# ---- ParseBasePower (powers_load.c:2071) ----------------------------------
ParseBasePower = [
    S("FullName"),
    I("CRCFullName"),
    CURFILE("SourceFile"),
    S("Name"),
    S("SourceName"),
    I("System"),
    B("AutoIssue"),
    B("AutoIssueSaveLevel"),
    B("Free"),
    S("DisplayName"),
    S("DisplayHelp"),
    S("DisplayShortHelp"),
    S("DisplayTargetHelp"),
    S("DisplayTargetShortHelp"),
    S("DisplayAttackerAttack"),
    S("DisplayAttackerAttackFloater"),
    S("DisplayAttackerHit"),
    S("DisplayVictimHit"),
    S("DisplayConfirm"),
    S("FloatRewarded"),
    S("DisplayPowerDefenseFloat"),
    S("IconName"),
    IGNORE("FXName"),
    I("Type"),
    I("NumAllowed"),
    IARR("AttackTypes"),
    SARR("BuyRequires"),
    SARR("ActivateRequires"),
    SARR("SlotRequires"),
    SARR("TargetRequires"),
    SARR("RewardRequires"),
    SARR("AuctionRequires"),
    S("RewardFallback"),
    F("Accuracy"),
    B("NearGround"),
    B("TargetNearGround"),
    I("CastableAfterDeath"),
    B("CastThroughHold"),
    B("CastThroughSleep"),
    B("CastThroughStun"),
    B("CastThroughTerrorize"),
    B("ToggleIgnoreHold"),
    B("ToggleIgnoreSleep"),
    B("ToggleIgnoreStun"),
    B("IgnoreLevelBought"),
    B("ShootThroughUntouchable"),
    B("InterruptLikeSleep"),
    I("AIReport"),
    I("EffectArea"),
    I("MaxTargetsHit"),
    F("Radius"),
    F("Arc"),
    VEC3("BoxOffset"),
    VEC3("BoxSize"),
    F("Range"),
    F("RangeSecondary"),
    F("TimeToActivate"),
    F("RechargeTime"),
    F("ActivatePeriod"),
    F("EnduranceCost"),
    F("IdeaCost"),
    I("TimeToConfirm"),
    I("SelfConfirm"),
    SARR("ConfirmRequires"),
    B("DestroyOnLimit"),
    B("StackingUsage"),
    I("NumCharges"),
    I("MaxNumCharges"),
    F("UsageTime"),
    F("MaxUsageTime"),
    F("Lifetime"),
    F("MaxLifetime"),
    F("LifetimeInGame"),
    F("MaxLifetimeInGame"),
    F("InterruptTime"),
    I("TargetVisibility"),
    I("Target"),
    I("TargetSecondary"),
    IARR("EntsAutoHit"),
    IARR("EntsAffected"),
    B("TargetsThroughVisionPhase"),
    IARR("BoostsAllowed"),
    IARR("GroupMembership"),
    IARR("ModesRequired"),
    IARR("ModesDisallowed"),
    IARR("FreeBoostSlotsOnPower", minv=1),     # PARSE_VERSION_V23
    SARR("AIGroups"),
    STRUCT("AttribMod", ParseAttribModTemplate),
    B("IgnoreStrength"),
    B("ShowBuffIcon"),
    I("ShowInInventory"),
    B("ShowInManage"),
    B("ShowInInfo"),
    B("Deletable"),
    B("Tradeable"),
    I("MaxBoosts"),
    B("DoNotSave"),
    B("BoostIgnoreEffectiveness"),
    B("BoostAlwaysCountForSet"),
    B("BoostTradeable"),
    B("BoostCombinable"),
    B("BoostAccountBound"),
    B("BoostBoostable"),
    B("BoostUsePlayerLevel"),
    S("BoostCatalystConversion"),
    S("StoreProduct"),
    I("BoostLicenseLevel"),
    I("MinSlotLevel"),
    I("MaxSlotLevel"),
    I("MaxBoostLevel"),
    STRUCT("Var", ParsePowerVar),
    I("ToggleDroppable"),
    IARR("StrengthsDisallowed"),
    B("ProcMainTargetOnly"),
    B("AnimMainTargetOnly"),
    SARR("HighlightEval"),
    S("HighlightIcon"),
    RGBA("HighlightRing"),
    F("TravelSuppression"),
    F("PreferenceMultiplier"),
    B("DontSetStance"),
    F("PointValue"),
    F("PointMultiplier"),
    S("ChainIntoPower"),
    B("InstanceLocked"),
    B("IsEnvironmentHit"),
    B("ShuffleTargets"),
    I("ForceLevelBought"),
    B("RefreshesOnActivePlayerChange"),
    B("PowerRedirector"),
    B("Cancelable"),
    B("IgnoreToggleMaxDistance"),
    I("ServerTrayPriority"),
    B("AbusiveBuff"),
    I("PositionCenter"),
    F("PositionDistance"),
    F("PositionHeight"),
    F("PositionYaw"),
    B("FaceTarget"),
    FNAME("VisualFX"),
    *power_fx_columns(),
    STRUCT("CustomFX", ParsePowerCustomFX),
]

# Top-level dictionary tables: each bin is a single struct-earray column of a
# PowerDictionary (powers_load.c:2280-2296).
ParsePowerCatDictionary = [STRUCT("PowerCategory", ParsePowerCategory)]
ParsePowerSetDictionary = [STRUCT("PowerSet", ParseBasePowerSet)]
ParsePowerDictionary = [STRUCT("Power", ParseBasePower)]
