# Changelog

What changed for players in each release of Hate's CoH Planner, newest first. One line per change,
in plain words. The full notes of every release are on the repository's GitHub Releases page.

## Unreleased

### New

- Set Finder, for Homecoming builds: choose what matters to you and it ranks the enhancement sets your build could slot, shows what each swap gains and loses, and makes a shopping list of the recipes and salvage.
- Set Finder has a Budget option: tick it and swaps that need the rarest salvage rank lower, and PvP, purple and archetype sets and attuned pieces are left out, so cheaper sets come first.

## v1.3.0 - November 21, 2026

### New

- The detailed power tooltip (on phones, a power's long-press info) now shows a power's slotted bonuses: the total its enhancements add stands at the right of each number they change, such as Accuracy or Recharge Time.
- Hover over a set's name while placing enhancements (on phones, long press it) to see all of the set's bonuses: the ones the power already earns glow, and the ones the enhancements you have chosen would add glow brighter.
- On phones, the enhancement categories are now one row you can drag sideways, the set names sit in their own box, and the details no longer repeat the enhancement's icon and name, which leaves more room for the lists.
- On phones, a long press on an enhancement turns on Select several and picks it.

### Improved

- The detailed power tooltip no longer has the "Damage Includes" row; the damage still counts your bonuses and the powers you switch on.

## v1.2.0 - November 20, 2026

### New

- The totals have a Pets and Minions section: click a pet to open its own stats and powers, counting your upgrades, summon slotting, pet aura enhancements, Supremacy, your powers that buff pets and the other pets' buffs, with switches for the pets' own powers.
- The detailed power tooltip's damage now counts your damage bonuses and the powers you switch on in the build screen's totals, such as Build Up, Aim and Rage; Fiery Embrace's extra fire damage counts only while it is switched on.
- Advanced Respec, for Respec builds: set the new Respec button to Advanced (or click the ticked Respec bubble on New Build) and each power you click in the respec moves you straight to the next pick.
- Powers can be swapped from the build screen even when they hold enhancements: when a swap would drop enhancements, free slots or break a rule elsewhere in the build, the planner lists what will be dropped and kept and asks first. Inside a respec with Advanced Respec on, it swaps at once and says how many were dropped.
- When a new power can't hold the old one's slots, you place the freed slots right away.
- A power you take later in the build can be swapped into an earlier level, and the planner moves or asks you to choose the power it replaces.
- The enhancement picker and the planner's buttons now match your build's hero, villain or Praetorian colors.
- The build overview's Inherent section shows your archetype's inherent power (Defiance, Fury, Domination and the rest), always counted in the totals.
- Tooltips, the totals switches and the level orbs on the build screen now match your build's hero, villain or Praetorian colors; each level orb shows the power picked there or the slots it adds, and the level on hover.
- The on/off switches on the build screen and in the enhancement picker now use the game's own check boxes for every alignment.
- In a respec, "Current Respec Level" on the slot screen is now readable and sits beside the title instead of over it.
- The enhancement picker's Sets and Special lists fold into groups you can open and close; Special enhancements are grouped as Hydra, Titan, Hamidon, D-Sync, Synthetic Hamidon, Talisman and Other.
- The enhancement picker can put every piece in as high as your build's level allows, and raise them when the build levels further.
- Ctrl+Click (or Select several on phones) picks several enhancements at once and fills the power's empty slots in one go, with their total shown after enhancement diversification.

### Improved

- Sound and music now start switched off, and are only downloaded once you switch them on (the Sound and Music buttons in the bottom bar, or the phone menu).

### Fixed

- A download that gets no answer is asked for again by itself, a page still loading after 10 seconds offers Try again instead of waiting forever, and a download problem is explained in plain words.
- If the planner can't start, for instance right after an update, the page now says to reload it instead of staying blank.
- Build screen columns that fit no longer show a scroll bar.
- Labels on the game-style bars should no longer turn black in some Chrome windows.
- When one server's game data can't be downloaded, your last build on it no longer keeps you from the other servers.
- A share link pasted into the address bar while the planner is still loading opens once it has loaded, and one opened over the enhancement picker closes the picker.
- A /build_save file with far too many lines is refused at once instead of freezing the page.
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
