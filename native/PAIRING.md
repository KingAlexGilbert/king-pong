# Optional anonymous pairing

The saved **Verify pairing PIN (host)** option defaults off. It applies to native
LAN, manual invitations and private online rooms, never public matchmaking.
Host approval remains separate and defaults on. Initial approval admits only a
transport connection. Gameplay and ready/countdown wait for the host to compare
both devices' six digits and accept. Rejection or a 60-second timeout ends the
attempt; managed host rooms remain available for another guest.

The offer advertises support with an SDP extension. Over the existing encrypted,
ordered WebRTC control channel, both peers commit to fresh 128-bit random nonces
using SHA-256 before revealing them. Commitments bind protocol version, room,
role and the ordered SHA-256 fingerprints of both negotiated DTLS certificates.
Each device verifies the commitment and independently derives its comparison PIN.
The PIN is never transmitted. Frames are bounded to 512 characters and 12 messages.

This verifies a particular channel by human comparison, not an account or device
identity. Six digits give approximately a one-in-a-million accidental match per
attempt, not full cryptographic fingerprint strength. The commitment construction
uses the short-authentication-string principle discussed in
[RFC 6189](https://www.rfc-editor.org/rfc/rfc6189.html); it is not ZRTP or a formally
audited authentication protocol. Protection depends on comparing codes on trusted
clients. No permanent identifiers, names or PINs are saved. Signaling already
carries SDP certificate fingerprints; no nonce or PIN is added to signaling.

Temporary comparison state is discarded at completion/disconnect. If Web Crypto
or a negotiated fingerprint is unavailable, acceptance stays disabled: cancel
and reconnect with verification off. Older guests cannot complete a verified
attempt; ordinary joining with verification off retains existing behavior.

Unit tests use actual Web Crypto. Browser tests with `--verify-pairing
--controlled-channels` use real pages and signaling but simulated certificates
and channels; they do not establish real DTLS or physical-device interoperability.
