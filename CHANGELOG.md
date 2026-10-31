# Changelog

## King Pong v2.0.0 — Online Multiplayer, UI Overhaul, and MORE!

### Online Multiplayer

The biggest addition to King Pong is **online multiplayer!** Play against friends or challenge players from around the world.

- **Cross-platform multiplayer:** Play across supported platforms using WebRTC and encrypted WebSocket connectivity.
- **Public matchmaking:** Find and challenge other players automatically.
- **Private rooms:** Create private matches with optional guest approval and verification.
- **Customizable matches:** Choose your arena, paddle shape, and whether to enable Royal Powerups.
- **Rematches:** Challenge your opponent to another round without setting up a new match.
- **Improved connection handling:** Better management of lag, temporary disconnections, and players leaving matches.

### UI Overhaul

King Pong's interface has received a major redesign, improving usability while preserving its classic arcade personality.

- Redesigned menus with a cleaner, more professional color scheme.
- Reorganized UI elements to prevent them from obstructing gameplay.
- Settings now have a dedicated menu instead of overlaying the arena.
- Made Campaign and Online Multiplayer more prominent and accessible.
- Added a dedicated **Controls** section.
- Improved settings controls, including CPU intelligence and paddle speed adjustments.
- Improved navigation and usability across desktop and mobile devices.

### Royal Powerups

Three brand-new powerups bring exciting new possibilities to King Pong!

- **Royal Split:** Duplicates the ball, forcing your opponent to defend against two balls at once. The duplicate disappears when struck by a paddle.
- **Crown Rush:** Dramatically increases the ball's speed until it makes contact with a paddle.
- **Castle Guard:** Activates a protective shield in front of your goal for 10 seconds.

Powerups appear approximately every 30 seconds at random locations throughout the arena. Collect them by hitting their icons with the ball!

### Smarter CPU Opponents

CPU opponents have received a major intelligence overhaul, making matches feel more dynamic and challenging.

- Improved ball tracking, positioning, and decision-making.
- CPU opponents can make smarter decisions when using and defending against Royal Powerups.
- Preserved the campaign's intended difficulty progression, with opponents becoming more intelligent as you advance.
- Improved the secret boss's intelligence and responsiveness.
- CPU intelligence and paddle speed remain independently adjustable in Custom Games.

### Additional Features and Improvements

- **Level Select:** Replay previously completed campaign levels at their original difficulty.
- **Fullscreen and Orientation Controls:** Added fullscreen and supported screen rotation controls to the browser version.
- **Linux Improvements:** The Linux application now runs through a local HTTP server at `127.0.0.1` instead of directly loading through `file://`, improving compatibility.
- **New Secret Ending Music:** Added non-procedurally generated music by **Madelee** for the secret ending.
- **LAN QR Pairing:** Generate and scan QR codes to simplify connecting devices for local multiplayer.
- **Automatic LAN Discovery:** Native versions of King Pong can automatically discover available local multiplayer rooms.
- **Player perspective:** Both players see their own paddle on the left side of their screen, regardless of which side they're actually playing on.
- **Performance Optimizations:** Significantly improved rendering performance, visual effects, and overall responsiveness.
- **Bug Fixes:** Fixed numerous issues affecting gameplay, multiplayer, menus, and platform compatibility.
- **And Much More:** Countless smaller improvements, refinements, and quality-of-life updates throughout the game!

## King Pong v1.1.3 - Save Backups and Optimization

- Added Import Saves and Export Saves beside Erase Selected Slot on Android, Windows, and Linux.
- Added a shared backup format for all three save slots, including progress and settings.
- Added system file pickers, backup validation, and recovery from interrupted imports.
- Replaced browser confirmation popups with clean in-game import and erase dialogs.
- Preserved each slot's music settings when loading or switching saves.
- Improved battery detection and updates across Android, Windows, and Linux while reducing unnecessary background activity.
- Hide the battery icon when the OS confirms no battery is present.
- Replaced global DOM modifications with explicit translation helpers.
- Improved LAN validation and reject outdated packets.
- Made gameplay speed consistent across display refresh rates.
- Fixed 0% volume and CPU intelligence settings resetting after restarting.
- Optimized the wrappers and installers for King Pong on each platform.

## Important Android Update Notice

The Android signing key has changed. If you installed King Pong directly from GitHub, you will need to **uninstall the existing version and reinstall it** before updating to this release.

F-Droid installations are unaffected by this.

## King Pong v1.1.2 - Faster Paddles and Pause Changes

- Added a countdown when resuming a paused game.
- Made pause detecting on touch screen more sophisticated
- Added sound effects to the 3-2-1 countdown after unpausing.
- Added a higher-pitched tone when gameplay resumes.
- Prevented paddles from moving during the pause countdown.
- Blocked keyboard, controller, touch, and LAN movement until the countdown ends.
- Rebalanced the end game levels to be easier.
- Increased player paddle speed by 20%

## King Pong v1.1.1 - Rally System Improvements

- Each rally now begins with a flash, and the ball moves at 20% speed for approximately one second.
- The first rally of each round is served toward the CPU.
- Each subsequent rally alternates between the player and the CPU.
- Fixed the Windows “Exit Game” button.

## v1.1.0 - Progressive Paddle Shapes and Late-Game Rebalance

- Added progressive paddle shapes and altered ball rebound trajectories for levels 3–18.
- Rebalanced the final levels to account for the new paddle mechanics and reduce excessive difficulty.
- Changed the enemy paddle color to match each level’s theme.
- Fixed Custom Game issues where “Play Selected” could launch the wrong level or fail to start properly.
- Added live level previews to Custom Game.
- Added an “Exit Game” button to the Windows desktop version.
- Added Linux support with a .deb package and a thin x86-64 AppImage.

## v1.0.3 - Optimizations

- Consolidated redundant CSS and release override blocks
Reduced unnecessary runtime work in rendering, localization, clock, and DOM lookups
- Reworked the Android WebView wrapper to remove unused dependency bloat
- Reduced the Android APK compile size from 5.8MB to about 350KB
- Kept gameplay behavior and core features intact
- Added screen shake and effects when the ball hits objects in the windows version

## v1.0.2 - Bug Fixes

- Fixed a ball spawning issue on obstacle-heavy levels where the ball could get trapped between close barriers and bounce for too long.
- Improved respawn angles on levels with obstacles.
- Added safer spawn checks around walls and hazards.
- Included minor menu polish fixes.

## v1.0.1 - Android and Windows

- Added a Windows WebView2 release.
- Added battery indicator.
- Added local time clock.
- Adjusted clock position.
- Made Pinball Alley slightly easier.

## v1.0.0 - Initial Android Release

- Initial Android release of King Pong.
- Added campaign progression.
- Added touch controls.
- Added controller support.
- Added local two-player mode.
- Added LAN play.
- Added save support.
- Added secret ending.
