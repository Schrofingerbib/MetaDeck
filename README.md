# MetaDeck Plus

A fork of [MetaDeck](https://github.com/EmuDeck/MetaDeck) with:

- **"Change Metadata..." editor** (game context menu): edit the metadata fields and the title, search LizardByte, RAWG and IGN, find a Steam Match, choose the EmuDeck compatibility report and the RetroAchievements game.
- **Steam Match features** for non-Steam games matched to a Steam game: its Community tab, its Activity (announcements), its controller layouts (official, recommended and community), and Deck compatibility.
- **Game trailers** on game pages, over the artwork: the Steam trailer of Steam games and Steam Matches, else an IGN trailer. Optional audio, fade-in delay and hidden logo. X mutes the trailer, Y enlarges it.
- **Software mode** for apps rather than games: Flathub metadata (automatic for Flatpaks, or linked by hand) and manual edits, without game providers, compatibility or achievements.
- Fixes: stability and cache, RetroAchievements subsets, PCSX2 serials of `.chd` games, Game Info staying after editing, among others.

Several features are ported from [Decky Metadata](https://github.com/beallio/Decky-Metadata) by beallio (GPL-3.0-or-later): see [NOTICE](NOTICE).

### Install
1. In Decky's settings, disable **MetaDeck** (and **Decky Metadata**, if installed): they patch the same Steam pages.
2. Install the `MetaDeck-Plus.zip` of the [latest release](https://github.com/Schrofingerbib/MetaDeck/releases/latest). In Decky's Developer settings, use "Install Plugin from URL" with its link, or "Install Plugin from ZIP File".
3. Restart Steam.

On its first start, MetaDeck Plus copies MetaDeck's settings and cache. MetaDeck keeps its own copy, so it can still be used instead.

---

Decky Loader Steam Deck, Steam Machine and Steam Frame Plugin for viewing metadata, achievements (also supports achievement sets!) and compatibility for Non-Steam games inside your game's app page just like with Steam games.


## Screenshots
#### Metadata and compatibility
<img width="3840" height="2160" alt="metadata" src="https://github.com/user-attachments/assets/5aa3c39e-a689-4335-831a-ed23ba43fc68" />

#### Compatibility, tests and notes
PCSX2 (Verified = Playable or Perfect via official compatibility list) with compatibility test results (control glyphs, resolutions and minor issues for non-Perfect games)
<img width="3840" height="2160" alt="compatdata" src="https://github.com/user-attachments/assets/ab208e18-02bb-4836-bf01-6579f0ef3077" />
DuckStation (Playable = EmuDeck user feedback) with compatibility test results and user notes
<img width="3840" height="2160" alt="20261116132839_1" src="https://github.com/user-attachments/assets/b7eb157c-1235-44aa-8374-e082bd660fc9" />


#### Achievements, achievement sets and DLCs
PCSX2 (RetroAchievements with subsets)
<img width="3840" height="2160" alt="achievements1" src="https://github.com/user-attachments/assets/6a954d60-b7f3-44aa-bda2-9697c67a5302" />
DuckStation (RetroAchievements with subsets)
<img width="3840" height="2160" alt="achievements2" src="https://github.com/user-attachments/assets/adbfeb50-38d5-422f-851a-7fc2f92dda58" />
Xenia (supports DLCs, checks which ones are installed)
<img width="3840" height="2160" alt="achievements3" src="https://github.com/user-attachments/assets/c088caf8-3cb7-4b8f-892c-8f6813e623ae" />
RPCS3 (supports trophy categories Bronze, Silver, Gold and Platinum, also supports DLCs, checks which ones are installed)
<img width="3840" height="2160" alt="achievements4" src="https://github.com/user-attachments/assets/2d925fb7-956e-4266-89ba-67838497c48f" />


## Building

```bash
pnpm i # Installs dependencies
decky plugin build # Builds installable zip file
```

vscode and intellj IDEA run configs are included


## Credits

Thanks to:
- [wit](https://wit.wiimm.de/wit/) for Wii id6 extraction tool
- [WudCompress](https://github.com/cemu-project/WudCompress) and [wudecrypt](https://github.com/maki-chan/wudecrypt) for WiiU serial extraction references
- [NX_Game_Info](https://github.com/garoxas/NX_Game_Info) for Switch title id extraction tool
- [PlayniteAchievements](https://github.com/justin-delano/PlayniteAchievements) for RPCS3 and Xenia references
- [XDBF-Manager](https://github.com/hetelek/XDBF-Manager), [XeXtractor](https://github.com/XboxChef/XeXtractor), [XexToolGUI](https://github.com/XboxChef/XexToolGUI), [XexTool](https://github.com/Team-Resurgent/XexTool) and [Free60.org Wiki](https://free60.org) for Xenia tools and references
- Original [Emuchievements](https://github.com/EmuDeck/Emuchievements) plugin creators
- Original [MetaDeck](https://github.com/EmuDeck/MetaDeck) plugin creators
