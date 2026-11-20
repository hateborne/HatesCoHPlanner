# Changelog

What changed for players in each release of Hate's CoH Planner, newest first. One line per change,
in plain words. The full notes of every release are on the repository's GitHub Releases page.

## Unreleased

### New

- The totals have a Pets and Minions section: click a pet to open its own stats and powers, counting your upgrades, summon slotting, pet aura enhancements, Supremacy, your powers that buff pets and the other pets' buffs, with switches for the pets' own powers.
- The detailed power tooltip's damage now counts your damage bonuses and the powers you switch on in the build screen's totals, such as Build Up, Aim and Rage; Fiery Embrace's extra fire damage counts only while it is switched on.
- Advanced Respec: set the new Respec button to Advanced (or click the ticked Respec bubble on New Build) and each power you click moves you straight to the next pick.
- Powers can be swapped from the build screen even when they hold enhancements: the planner lists which enhancements will be dropped and kept, and asks first unless Advanced Respec is on.
- When a new power can't hold the old one's slots, you place the freed slots right away.
- A power you take later in the build can be swapped into an earlier level, and the planner moves or asks you to choose the power it replaces.
- The enhancement picker and the planner's buttons now match your build's hero, villain or Praetorian colors.
- The build overview's Inherent section shows your archetype's inherent power (Defiance, Fury, Domination and the rest), always counted in the totals.
- Tooltips, the totals switches and the level orbs on the build screen now match your build's hero, villain or Praetorian colors; each level orb shows the power picked there or the slots it adds, and the level on hover.
- Build screen columns that fit no longer show a scroll bar.
- The on/off switches on the build screen and in the enhancement picker now use the game's own check boxes for every alignment.
- Labels on the game-style bars should no longer turn black in some Chrome windows.
- In a respec, "Current Respec Level" on the slot screen is now readable and sits beside the title instead of over it.
- The enhancement picker's Sets and Special lists fold into groups you can open and close; Special enhancements are grouped as Hydra, Titan, Hamidon, D-Sync, Synthetic Hamidon, Talisman and Other.
- The enhancement picker can put every piece in at your build's level or the set's top level, and raise them when the build levels further.
- Ctrl+Click (or Select several on phones) picks several enhancements at once and fills the power's empty slots in one go, with their total shown after enhancement diversification.
- Set Finder, for Homecoming builds: choose what matters to you and it ranks the enhancement sets your build could slot, shows what each swap gains and loses, and makes a shopping list of the recipes and salvage.

### Fixed

- Mask Presence and Shinobi no longer add their strike-from-stealth damage bonus to the totals as if it were always on.
- A Stalker's Genetic Corruption no longer lowers your own damage in the totals: its damage debuff is for enemies.
- Clicking the level 1 orb on the build screen now lets you change both level 1 powers, primary then secondary, and a power marked in red can be clicked to change it.
- The Continue button on the server list always shows which server your build is on, even with a long build name.
- A detailed power tooltip no longer keeps the wrong size or place when its extra details finish loading.
- Detailed power info no longer shows 0.00 for effects whose strength is a fixed 1, such as Inner Will's protection and the inherent meters.
- Saving a build under a name already saved in the browser asks whether to replace that build or keep both.
- Right after you save a build, replacing it no longer tells you to save it first.
- On the level-up screens the Totals tab sits lower, so it no longer hides the pool powers' scroll bar.
- On phones, the pool power sets on the build and slot screens no longer leave large gaps between them.
- In a respec, slots placed on the slot screen sit at or after the level their power was taken whenever the respec's levels allow it.
- A respec build's levels reopened from the build screen show the respec's own titles, and level 1 asks for the secondary power first, as the respec does.

## v1.1.0 - November 17, 2026

### New

- Thunderspy is here: a second game server with its own archetypes, power sets and enhancements.
- The planner asks which server you play on, and remembers your choice.
- Detailed power info now counts damage from summoned effects such as Burn and Rain of Fire.
- The planner's version number is shown at the bottom of the page.

### Improved

- Detailed power info reads much closer to the in-game window: damage averages, conditional effects and effect notes.
- New Build greys out power set combinations the game does not allow.
- Arachnos Soldiers and Widows are planned as Respec builds, the way the game handles their branch powers.
- After a few hours away, the planner asks before reopening your last build.
- Saving in the browser now reminds you the build lives only on this device, and suggests bookmarking it.
- Long tooltips can be scrolled.

### Fixed

- Older Mids share codes from forum posts that were refused as damaged now import.
- Builds saved from the game no longer show false warnings on pre-order and outleveled enhancements.

## v1.0.0 - November 13, 2026

- First public release.
