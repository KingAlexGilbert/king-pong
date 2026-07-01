# King Pong Android/APK Conversion — Reconstructed Making-Of

**Author / creator credit:** King Alex Gilbert  
**Project:** King Pong  
**Document type:** Reconstructed making-of notes for the Android/APK conversion chat  
**Status:** Reconstructed, with exact recovered transcript supplements from the partial DOCX

> **Important honesty note:** This document is reconstructed from the available conversation context, saved project memory, generated file names, and later exact messages that remained visible. It is **not** a verbatim transcript of the full Android/APK conversation. The exact beginning and middle of the Android/APK chat were not available in model context when this document was created, and the browser/PDF backup attempt failed. Exact quotes are intentionally avoided unless they were available in the visible context. This supplemented version also includes exact recovered transcript blocks from the partial DOCX where they fit chronologically.

> **Large file/code policy:** Full HTML, JavaScript, CSS, XML, Gradle, APK, EXE, and Android Studio project files are not included here. Wherever the chat produced or modified a large file, this document references the file name or uses a placeholder.

---

## 1. Starting point: King Pong existed first as an HTML game

**Reconstructed:** The Android/APK conversion work started after King Pong already existed as a large single-file HTML/JavaScript game. The game included a campaign, custom game mode, two-player modes, touch/controller/keyboard support, audio/music, save slots, localization, and the secret boss content.

The main technical decision was that the Android version should be created from the **HTML file**, not from the Windows EXE.

**Decision made:**

- Use the HTML game as the Android source.
- Wrap the HTML file inside an Android WebView.
- Avoid trying to convert the Windows EXE directly into an APK.



<details>
<summary>Exact recovered transcript supplement: first recoverable Android/APK question</summary>

```text
King Alex Gilbert:
is it easier to convert the EXE file or HTML to an APK android file?
Chat GPT:
[exact text unavailable]
```

</details>

**Reasoning reconstructed:**

- The EXE was Windows-specific.
- Windows AppData save logic does not directly transfer to Android.
- The HTML game already contained most of the actual game behavior.
- Android could run the HTML through a WebView with JavaScript, DOM storage, audio, touch, and local app storage.

**Placeholder:**

```text
[Chat GPT provided Android/WebView conversion guidance here: filename unknown]
```

---

## 2. First APK direction: WebView wrapper

**Reconstructed:** The first Android approach was a basic Android WebView app that loads the game from the app assets folder.

The intended Android structure became:

```text
app/src/main/assets/index.html
app/src/main/java/com/kingalex/kingpong/MainActivity.java
```

The WebView wrapper was meant to load:

```text
file:///android_asset/index.html
```

**Key WebView goals:**

- Enable JavaScript.
- Enable DOM storage / local storage.
- Allow the HTML game to save progress locally inside the Android app.
- Allow audio/music to run after user interaction.
- Keep touch, keyboard, and controller support where Android WebView allowed it.
- Keep LAN/WebRTC-style features as much as possible.

**Reconstructed Android permissions/settings discussed:**

- Internet/network access was relevant for LAN/WebRTC-style connection code.
- Fullscreen display was desired.
- Landscape orientation eventually became required.
- The app should behave like a local game rather than a website.

**Placeholder:**

```text
[Chat GPT provided Android WebView wrapper/project files here: filename unknown]
```

---

## 3. Android 15 APK parsing problem

**Reconstructed:** A major issue appeared when trying to install manually generated APKs on an Android 15 device. The phone showed an APK parsing/install problem.

The problem was described as an Android install/parsing failure similar to:

```text
There was a problem parsing this package
```

**What was tried or discussed:**

- Raising the Android target SDK toward Android 15 compatibility.
- Using a modern target SDK, including target SDK 35.
- Keeping a reasonable minimum SDK, including min SDK 24.
- Signing attempts with stronger signing details such as SHA-256 / SHA256withRSA.
- APK Signature Scheme v2 signing was attempted or discussed.

**Reconstructed result:**

The manual APK-building path was unreliable. The better path became using a real Android Studio project and letting Android Studio / Gradle build the APK properly.

**Decision made:**

- Stop relying on hand-built/manual APK generation for final Android 15 testing.
- Use Android Studio as the proper APK build path.

---

## 4. Android Studio became the main build path

**Reconstructed:** The project was moved into an Android Studio workflow. The goal was to make the app build reliably through Gradle and Android Studio instead of manually packaging an APK.

The likely Android Studio project path on the local computer became:

```text
%USERPROFILE%\AndroidStudioProjects\KingPong
```

The important file replacement path was:

```text
app/src/main/assets/index.html
```

The important WebView Java file path was:

```text
app/src/main/java/com/kingalex/kingpong/MainActivity.java
```

The package path used in instructions was:

```text
com.kingalex.kingpong
```

**Build steps that became the standard workflow:**

1. Open the King Pong project in Android Studio.
2. Replace or update:

   ```text
   app/src/main/assets/index.html
   ```

3. Save all files.
4. Let Gradle sync if Android Studio requests it.
5. Build the APK through:

   ```text
   Build → Generate App Bundles or APKs → Generate APK(s)
   ```

6. Locate the APK at a path like:

   ```text
   app/build/outputs/apk/debug/app-debug.apk
   ```

7. Install and test the APK on the Android phone.

**Placeholder:**

```text
[Chat GPT provided an Android Studio project or build kit here: KingPong_Android_BuildKit.zip / KingPong_AndroidStudio_Project_with_icon.zip]
```

---

## 5. Manifest/orientation issue: portrait was wrong, landscape was required

**Reconstructed:** After the app built, the game did not look right in portrait orientation. The play area was too small or incorrectly oriented for the phone. The project needed to force landscape orientation.

**Fix direction:** Add a landscape orientation setting inside the `.MainActivity` activity entry in the Android manifest.

The relevant manifest setting was:

```text
android:screenOrientation="landscape"
```

**Important note:** The full Android manifest XML is not included in this document.

**Result:**

- The APK opened in landscape.
- The game looked closer to the desktop layout.
- This became the preferred mobile presentation for King Pong.

---

## 6. Asset replacement workflow became the repeatable update method

**Reconstructed:** After the Android Studio project was working, most game updates no longer required rebuilding the whole project structure. The repeatable workflow was:

1. Generate or receive a new updated HTML file.
2. Rename/copy it as:

   ```text
   index.html
   ```

3. Replace the Android asset file:

   ```text
   app/src/main/assets/index.html
   ```

4. Build a new APK in Android Studio.
5. Test on the phone.
6. Commit the changed source file to GitHub.
7. If needed, upload the new APK to a GitHub Release.

**Common troubleshooting note:** If the app showed an error like it could not load `file:///android_asset/index.html`, the file was probably missing, misnamed, in the wrong folder, or accidentally named something like `index.html.html`.

---

## 7. Mobile/touch layout fixes

**Reconstructed:** A large part of the Android conversion chat was spent fixing how the desktop HTML game felt on a phone.

### 7.1 Forced landscape instead of a stretched portrait layout

The phone build originally had sizing/orientation problems. The final direction was to keep the original desktop-style game but force landscape orientation and polish touch controls instead of redesigning the whole game into portrait.

### 7.2 Touch controls

**Problems discussed or fixed:**

- Touch needed to work across the full screen edges.
- The paddle should move by dragging, not teleporting on tap.
- Touching menu controls should not accidentally move the paddle.
- The UI needed to feel playable on a phone without keyboard instructions cluttering the screen.

**Fixes reconstructed:**

- Touch controls were extended closer to the screen edges.
- Tap-to-teleport behavior was removed.
- Paddle movement became drag-based.
- Menu/UI touch targets were protected from accidentally controlling gameplay.
- Active gameplay hid most menus and left only a small Menu button.

### 7.3 Keyboard hints changed for mobile

**Reconstructed:** Prompts that made sense on desktop, such as `SPACE TO SERVE`, were changed for mobile. The phone-facing prompts became more like:

```text
TAP TO SERVE
TAP: next level
TAP: retry
```

Keyboard support still remained useful for Bluetooth keyboards or desktop testing, but the on-screen instructions were made phone-friendly.

### 7.4 Menu visibility cleanup

**Reconstructed:** The UI was cleaned so the phone screen was not crowded during gameplay.

Fixes included:

- Hide top/bottom menus during active play.
- Keep a small Menu button available.
- Hide Title Screen and Goal Info buttons during active gameplay.
- Show menu/title/goal controls again when menus are opened or when appropriate.
- Remove keyboard shortcut letters from mobile-facing button labels.
- Improve menu text visibility by using white text where needed.

**Placeholder:**

```text
[Chat GPT provided updated mobile/touch HTML files here: king_pong_phone_release_safe_ui.html, king_pong_landscape_hd_touch_clean_menus.html, king_pong_landscape_hd_touch_relative_drag.html]
```

---

## 8. App icon work

**Reconstructed:** King Pong needed an Android app icon. The chosen visual direction was a Pong ball with a crown, matching the King Pong branding.

Icon files that were generated or reused included:

```text
king_pong_icon_512_optimized.png
king_pong_icon_256_optimized.png
king_pong_icon_192_optimized.png
king_pong_retro_arcade_icon.png
```

**Recommended icon source:**

```text
king_pong_icon_512_optimized.png
```

<details>
<summary>Exact recovered transcript supplement: King Pong icon files</summary>

```text
King Alex Gilbert:
can you bring up the king pong icon again please
Chat GPT:
Here are the King Pong icon files again:
512px optimized icon
256px optimized icon
192px optimized icon
Use the 512px optimized icon if Android Studio asks you to pick an image for the app icon.
```

</details>


**Reconstructed Android Studio icon workflow:**

1. In Android Studio, open the app module.
2. Use Android Studio's Image Asset tool or launcher icon workflow.
3. Select the 512px optimized King Pong icon as the source image.
4. Let Android Studio generate the appropriate mipmap launcher icon sizes.
5. Rebuild and test the APK.

**Important note:** The image files were referenced directly. No font files were shared.

---

## 9. Save behavior on Android

**Reconstructed:** The Android version was expected to save game progress inside the app storage through WebView/local storage behavior.

**Important behavior:**

- Updating over an existing APK with the same package name should normally preserve app data.
- Uninstalling the app can erase saved progress.
- Changing the package name would make Android treat it like a different app.

**Practical note for releases:**

When releasing updates, keep the same package identity so existing save data is not accidentally abandoned.

---

## 10. Audio, language detection, controller support, and LAN notes

**Reconstructed:** The goal was to preserve the major HTML game features inside Android WebView.

### Audio/music

- The game used browser/WebAudio-style music.
- Android WebView generally requires user interaction before audio starts.
- The game already had tap/serve/menu interaction, which helped satisfy audio-start behavior.

### Language detection

- The HTML game contained multilingual auto-detection/localization logic.
- That stayed inside the HTML file.

### Controller support

- Controller support was kept where Android WebView/browser gamepad behavior allowed it.
- Touch remained the main phone control method.

### LAN/networking

- LAN two-player was intended as optional and local-only.
- Internet/network permission was relevant for WebRTC or connection behavior.
- Some LAN/WebRTC behavior could depend on Android WebView support and local network conditions.

---

## 11. APK size and optimization notes

**Reconstructed:** APK file size came up during the Android release process.

Observed or discussed APK sizes were approximately:

```text
5.8 MB to 5.9 MB
```

The size changed slightly after resolution, icon, and HTML updates.

**Conclusion reconstructed:**

The APK size was small enough for a simple Android game release and not a major issue.

---

## 12. GitHub repository and release workflow

**Reconstructed:** After the APK was working, the project was prepared for GitHub.

Known public GitHub profile link:

```text
https://github.com/KingAlexGilbert
```

The King Pong repository was made public and included source code, screenshots, license information, README documentation, and APK release assets.

### GitHub Desktop workflow

The normal workflow became:

1. Replace/update files locally.
2. Open GitHub Desktop.
3. Review changed files.
4. Write a commit summary.
5. Commit to `main`.
6. Pull origin if GitHub Desktop says remote changes exist.
7. Push origin.

Example commit summaries used or suggested:

```text
Adjust clock position
Add battery and clock indicators
Fix custom level dropdown on Android
```

<details>
<summary>Exact recovered transcript supplement: GitHub Desktop commit workflow</summary>

```text
King Alex Gilbert:
All I have to do is open Github desktop and commit changes, right
Chat GPT:
Yes — after you replace the file and test it, that is basically it.
Do this order:
Replace the file in your Android project:
app/src/main/assets/index.html
with the new index.html.
Rebuild/test the APK in Android Studio to make sure the clock looks right.
Open GitHub Desktop.
You should see this changed file:
app/src/main/assets/index.html
In the summary box, type something like:
Adjust clock position
Click:
Commit to main
Then click:
Push origin
Important: committing/pushing updates the source code on GitHub. If you also want people to download the updated APK, you still need to build the new APK and upload it to your GitHub Release too.

King Alex Gilbert:
summery or title?
Chat GPT:
Use Summary.
In GitHub Desktop, the box is usually called Summary. Type:
Adjust clock position
The longer Description box is optional. You can leave it blank.
Then click:
Commit to main
Then:
Push origin

King Alex Gilbert:
[King Alex Gilbert provided a screenshot here.]
Chat GPT:
That looks correct.
The Summary box is the top small box where you typed:
Update index.html
That is fine, but I would make it a little more descriptive:
Adjust clock position
Then click:
Commit 1 file to main
After that, the top button should change from Fetch origin to something like:
Push origin
Click Push origin to upload it to GitHub.
You do not need to click Show diff. GitHub Desktop just cannot preview the huge HTML file easily.

King Alex Gilbert:
[King Alex Gilbert provided a screenshot here.]
Chat GPT:
Yes, you are in the right place.
Before committing, I would clean up the wording slightly:
Summary:
Add battery and clock indicators
Description:
Made Pinball Alley slightly easier and adjusted the clock position.
Then click:
Commit 1 file to main
After that, because the top says Pull origin, do this order:
Commit 1 file to main → Pull origin → Push origin
The Pull origin part means GitHub has changes your computer has not downloaded yet, probably from edits you made on the GitHub website. After you commit, pull those down, then push your new local commit up.
Do not worry about “diff too large.” That is normal because index.html is a big single-file game.
```

</details>


### Release workflow

**Reconstructed:** The APK was uploaded through GitHub Releases.

Recommended release naming pattern:

```text
King Pong v1.0.0
King Pong v1.0.1
```

Suggested update tag after v1.0.0:

```text
v1.0.1
```

Suggested APK naming pattern:

```text
KingPong-v1.0.1.apk
```

**GitHub Release steps reconstructed:**

1. Build the APK in Android Studio.
2. Rename the APK to a clear release name.
3. Go to the repository on GitHub.
4. Open Releases.
5. Draft a new release.
6. Create a new tag, such as `v1.0.1`.
7. Add release title and notes.
8. Attach the APK.
9. Publish the release.

**Example reconstructed release notes for v1.0.1:**

```text
King Pong v1.0.1

Changes:
- Added battery indicator.
- Added local time clock.
- Adjusted clock position.
- Made Pinball Alley slightly easier.
```

<details>
<summary>Exact recovered transcript supplement: GitHub release workflow</summary>

```text
King Alex Gilbert:
how to add a new release?
Chat GPT:
Yes. Since you already have v1.0.0, make the next release:
v1.0.1
Steps
First, make sure you already did this in GitHub Desktop:
Commit → Pull origin → Push origin
Your GitHub repo should show the newest index.html change before you make the release.
Build the new APK in Android Studio:
Build → Generate App Bundles or APKs → Build APK(s)
The APK should be here:
app/build/outputs/apk/debug/app-debug.apk
Go to your GitHub repo page.
On the right side, click:
Releases
Click:
Draft a new release
GitHub’s release flow lets you create a tag, add release notes, and attach files like APKs.
For tag, type:
v1.0.1
Then choose create new tag.
Release title:
King Pong v1.0.1
Release notes:
King Pong v1.0.1
Changes:
Added battery indicator.
Added local time clock.
Adjusted clock position.
Made Pinball Alley slightly easier.
Attach the new APK file:
app-debug.apk
Optional but better: rename it first to:
KingPong-v1.0.1.apk
Click:
Publish release
After that, your GitHub page will show v1.0.1 as the newest release.
```

</details>


---

## 13. README, license, and professionalism decisions

**Reconstructed:** The GitHub repository was polished so it looked more professional.

Decisions included:

- Use `King Pong` as the final project name.
- Preserve the creator credit exactly as `King Alex Gilbert`.
- Use GPLv3 as the license because future versions should stay open source.
- Include screenshots in the README.
- Include build instructions for Android Studio.
- Include source paths and release download instructions.
- Be transparent that AI assistance was used without making the project look like a copy-paste AI dump.

README/build instructions included paths such as:

```text
app/src/main/assets/index.html
app/build/outputs/apk/debug/
```

---

## 14. Later Android HTML update files and fixes

The later visible part of the conversation included exact file names for HTML replacements and ZIPs. These were Android asset replacement files, not full Android Studio projects.

### 14.1 Battery icon and clock updates

**Reconstructed:** A battery indicator and local time clock were added to the game UI.

Generated or referenced files included:

```text
king_pong_battery_icon_pinball_easy.html
king_pong_battery_icon_update.zip
king_pong_battery_icon_clock_pinball_easy.html
king_pong_battery_icon_clock_update.zip
king_pong_battery_icon_clock_corner_adjusted.html
king_pong_battery_icon_clock_corner_adjusted.zip
king_pong_battery_icon_clock_far_corner.html
king_pong_battery_icon_clock_far_corner.zip
king_pong_battery_icon_clock_right_shifted.html
king_pong_battery_icon_clock_right_shifted.zip
king_pong_battery_icon_clock_aligned_menu.html
king_pong_battery_icon_clock_aligned_menu.zip
```

**Changes reconstructed:**

- Battery indicator placed near the top-right.
- Charging state shown with a lightning bolt.
- Local time clock placed at the bottom-left.
- Clock position adjusted multiple times for phone-case visibility.
- Final visible request aligned the clock with the Menu button's X axis.

**Placeholder:**

```text
[Chat GPT provided updated HTML replacement files here: battery/clock versions listed above]
```

<details>
<summary>Exact recovered transcript supplement: clock alignment update</summary>

```text
King Alex Gilbert:
can you just align it on the same X axis as the menu button
Chat GPT:
Done — I aligned the clock to the same left X position as the Menu button.
Files:
Updated HTML
Replacement ZIP
Replace:
app/src/main/assets/index.html
Then rebuild the APK.
If you want, I can also make one more version where the clock is:
slightly higher, or
a little smaller,
so it stays even farther away from the playfield.
```

</details>


### 14.2 Pinball Alley balance change

**Reconstructed:** Pinball Alley was made slightly easier.

Changes included some combination of:

- Lowering the goal from 6 to 5.
- Reducing ball speed slightly.
- Reducing max speed slightly.
- Reducing bumper boost.
- Slowing moving side gates.

This change was included in later battery/clock update files.

### 14.3 Spawn safety fixes for barrier levels

A later issue appeared on levels with two barriers in front of each other, such as level 4 and level 6. The ball could spawn between barriers without enough angle and take too long to escape.

Files created for this area included:

```text
king_pong_spawn_angle_fix.html
king_pong_spawn_angle_fix.zip
king_pong_full_spawn_safety_fix.html
king_pong_full_spawn_safety_fix.zip
```

**Reconstructed final spawn-safety changes:**

- Safer ball spawn checks around obstacles.
- Extra padding so the ball does not spawn too close to barriers.
- Detection for vertical barrier pockets.
- Minimum diagonal spawn angle so the ball does not spawn perfectly flat.
- Minimum-angle protection applied to boss balls too.
- Increased rally spawn Y jitter so levels like 4 and 6 do not keep spawning into the same lane.

**Placeholder:**

```text
[Chat GPT provided updated HTML replacement files here: spawn safety versions listed above]
```

<details>
<summary>Exact recovered transcript supplement: barrier spawn fix and stronger spawn-safety update</summary>

```text
King Alex Gilbert:
When playing levels with two barriers in front of each other like level 4 and 6. The ball can spawn in between them and not at an angle, so it takes awhile for the ball to get out. Is there a way to fix that?
Chat GPT:
Yes — the fix is to make sure the ball never respawns with a nearly flat/horizontal angle on barrier-heavy levels.
I made that update.
Files:
Updated HTML
Replacement ZIP
What I changed:
Added a minimum diagonal launch angle after respawns.
Added a little vertical spawn variation so the ball does not start perfectly centered between barriers.
Barrier levels like Side Rails and Pinball Warmup should no longer get those slow “stuck between posts” rallies as often.
Keyboard/touch/controller behavior stays the same.
Battery icon, clock, easier Pinball Alley, and the other recent changes are still included.
Replace:
app/src/main/assets/index.html
Then rebuild and test levels 4 and 6. If it still feels too flat, I can make the escape angle stronger.

King Alex Gilbert:
did you add all of this?
Added safer ball spawn checks around obstacles.
Added extra padding so the ball does not spawn too close to barriers.
Added detection for vertical barrier pockets.
Added minimum diagonal spawn angle so the ball should not spawn perfectly flat.
Applied the same minimum-angle protection to boss balls too.
Increased rally spawn Y jitter so levels like 4 and 6 do not keep spawning straight into the same boring lane.
Chat GPT:
Not all of that was in the previous spawn-fix file. It had the basic minimum diagonal angle and some spawn safety, but it did not fully include every item in that list, especially the stronger vertical pocket detection and boss-ball minimum-angle protection.
I fixed that now.
New files:
Updated HTML
Replacement ZIP
This new version includes:
- Safer ball spawn checks around obstacles
- Extra padding so the ball does not spawn too close to barriers
- Detection for vertical barrier pockets
- Minimum diagonal spawn angle so the ball does not spawn perfectly flat
- Same minimum-angle protection for boss balls
- Increased rally spawn Y jitter for levels like 4 and 6
Use the ZIP and replace:
app/src/main/assets/index.html
Then rebuild and test levels 4 and 6. This should make those “stuck between barriers” spawns much less likely.
```

</details>


### 14.4 Custom Game dropdown fix on Android

A later Android app bug was that the Custom Game level dropdown did not work correctly inside the app.

Files created:

```text
king_pong_custom_dropdown_fix.html
king_pong_custom_dropdown_fix.zip
```

**Cause reconstructed:**

The phone touch/menu code was likely treating the dropdown like a game/menu control and blurring or blocking it too quickly. Android WebView therefore could not keep the native dropdown open.

**Fix reconstructed:**

- Let the dropdown keep focus.
- Allow normal touch behavior on the dropdown.
- Do not block keyboard arrows while a native dropdown/input is focused.
- Preserve gameplay touch controls, battery icon, clock, Pinball Alley balance changes, and spawn-safety fixes.

Suggested commit summary:

```text
Fix custom level dropdown on Android
```

<details>
<summary>Exact recovered transcript supplement: Android custom level dropdown fix</summary>

```text
King Alex Gilbert:
When I go to pick a custom game level, the drop down box doesn't work in the app. Why is that? Can you fix it?
Chat GPT:
Yes — that is fixable. The problem is most likely from the phone touch/menu code: it was treating the dropdown like a game/menu control and blurring/blocking it too quickly, so Android WebView could not keep the native dropdown open.
I made a fixed version.
Files:
Updated HTML
Replacement ZIP
What I changed:
The custom level dropdown can now keep focus instead of immediately blurring.
Touch behavior on the dropdown is allowed normally.
Keyboard arrows are no longer blocked while a native dropdown/input is focused.
Gameplay touch controls, battery icon, clock, easier Pinball Alley, and the spawn-safety fixes are still included.
Use the ZIP and replace:
app/src/main/assets/index.html
Then rebuild the APK and test:
Custom Game → Level dropdown
A good GitHub commit summary would be:
Fix custom level dropdown on Android
```

</details>


---

## 15. Replacement ZIP usage

Many generated ZIP files were designed so the user could copy the updated `index.html` into the Android project.

Typical replacement target:

```text
app/src/main/assets/index.html
```

Some ZIPs were structured with:

```text
app/src/main/assets/index.html
```

This meant the ZIP contained the Android-style asset path for convenience, but the main thing to replace was still the single `index.html` file in the Android Studio project.

---

## 16. Current reconstructed final status

**Reconstructed final status as of the visible end of the Android/APK conversation:**

- King Pong has an Android Studio project workflow.
- The app uses a WebView to load the game from `app/src/main/assets/index.html`.
- Landscape orientation is enforced through the Android manifest.
- The Android phone build is the recommended APK build path, not manual APK packaging.
- The APK had previously been published through GitHub Releases.
- GitHub Desktop is used for committing and pushing source updates.
- The README, screenshots, GPLv3 license, source code, and release assets are part of the public GitHub project.
- Recent app-side fixes include:
  - Battery indicator.
  - Local time clock.
  - Clock alignment/position adjustments.
  - Easier Pinball Alley.
  - Barrier spawn safety fixes.
  - Android Custom Game dropdown fix.

Latest visible replacement file:

```text
king_pong_custom_dropdown_fix.html
king_pong_custom_dropdown_fix.zip
```

Recommended next action after using that file:

1. Replace:

   ```text
   app/src/main/assets/index.html
   ```

2. Rebuild APK in Android Studio.
3. Test Custom Game dropdown on the Android phone.
4. Test levels 4 and 6 for spawn behavior.
5. Test battery/clock display.
6. Commit changes in GitHub Desktop.
7. Build and upload a new APK release if the update should be public.

---

## 17. Continuing the project safely

**Reconstructed best practice going forward:**

- Keep the Android Studio project as the source of truth for APK builds.
- Keep `app/src/main/assets/index.html` updated with the latest game HTML.
- Keep package identity stable to preserve Android save data across updates.
- Test every replacement HTML file in Android Studio before publishing a release.
- Use clear GitHub commit messages.
- Use versioned release tags for APK updates.
- Keep a separate Markdown making-of/changelog document because the original chat transcript is incomplete.

---

## 18. File/output placeholders index

The conversation produced many files. Full contents are intentionally omitted.

```text
[Chat GPT provided a large file/code block here: PongCampaign_AndroidStudio_Project.zip]
[Chat GPT provided a large file/code block here: KingPong_Android_BuildKit.zip]
[Chat GPT provided a large file/code block here: KingPong_AndroidStudio_Project_with_icon.zip]
[Chat GPT provided a large file/code block here: king_pong_landscape_hd_touch_ui_polish.html]
[Chat GPT provided a large file/code block here: king_pong_landscape_hd_touch_clean_menus.html]
[Chat GPT provided a large file/code block here: king_pong_landscape_hd_touch_relative_drag.html]
[Chat GPT provided a large file/code block here: king_pong_phone_release_safe_ui.html]
[Chat GPT provided a large file/code block here: king_pong_battery_icon_clock_aligned_menu.html]
[Chat GPT provided a large file/code block here: king_pong_spawn_angle_fix.html]
[Chat GPT provided a large file/code block here: king_pong_full_spawn_safety_fix.html]
[Chat GPT provided a large file/code block here: king_pong_custom_dropdown_fix.html]
```

---

## 19. Notes on what is reconstructed versus exact

**Exact or near-exact available items:**

- Some later user messages and assistant replies about GitHub Desktop, GitHub Releases, icon files, spawn fixes, and dropdown fixes.
- File names listed in the visible context.
- Key paths such as `app/src/main/assets/index.html` and `app/src/main/java/com/kingalex/kingpong/MainActivity.java`.
- The package path `com.kingalex.kingpong` from project memory.
- The landscape manifest setting `android:screenOrientation="landscape"` from project memory.

**Reconstructed items:**

- The exact early order of Android 15 APK parsing attempts.
- Some Android Studio setup steps.
- Some explanations of why WebView/HTML was chosen over EXE conversion.
- Some details around touch/mobile layout fix ordering.

**Not included:**

- Full source code.
- Full Android manifest.
- Full Gradle files.
- Full HTML/JavaScript game file.
- APK binaries.
- Any invented exact quotes.

---

## 20. Suggested GitHub placement

Suggested file name for the repository:

```text
ANDROID_APK_MAKING_OF_RECONSTRUCTED.md
```

Suggested README link text:

```markdown
[Read the reconstructed Android/APK making-of notes](ANDROID_APK_MAKING_OF_RECONSTRUCTED.md)
```

