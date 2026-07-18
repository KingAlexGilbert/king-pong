# Changelog

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
