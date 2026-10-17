# Optional Secret Boss recording

Source: supplied King Pong Theme_master.wav(1).zip, containing the original
48 kHz stereo 24-bit master (103.384625 s; 29,775,596 bytes).
Encode: `ffmpeg -i master.wav -c:a libopus -b:a 48k secret-boss-v1.ogg`.
No reconstruction, normalization, trimming or added fades; the entire song loops.
The selected recording is 684,920 bytes. 32/40 kbps trials were approximately
459/572 KB. 48 kbps reserves more quality while remaining an optional download.
Actual Chromium playback/looping is tested; device decoder and listening checks
remain required. Ogg stream serials can change the digest on re-encoding.

Only docs/audio contains the asset. Native packages contain loaders, never audio.
When publication is authorized, publish this file with the Pages website. Until
then unavailable/uncached recordings silently fall back to procedural music.
The original soundtrack option defaults on in each existing version-2 save slot;
Music Off, zero volume, Mute All and opting out suppress loading and playback.
Downloads happen only after entering the boss. No third-party service is used.

Browser Cache Storage is best-effort. Native caches are hash-checked files:
Windows LocalAppData/KingPong/Cache, Linux XDG_CACHE_HOME/king-pong (or ~/.cache),
Android app cache. OS eviction/denied storage/unsupported Opus/network failure
retain synthesis. Native requests use one fixed HTTPS URL, bounded reads and
no redirects. On asset updates change the versioned filename, byte count and
SHA-256 in the shared JS and all three native adapters; tests check agreement.
