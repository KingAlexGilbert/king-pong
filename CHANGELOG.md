# Changelog

## v1.0.3 - Optimizations

- Consolidated redundant CSS and release override blocks
Reduced unnecessary runtime work in rendering, localization, clock, and DOM lookups
- Reworked the Android WebView wrapper to remove unused dependency bloat
- Reduced the Android APK compile size from 5.8MB to about 300KB
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