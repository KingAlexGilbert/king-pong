# Offline LAN signaling v1

Native adapters use only system networking libraries. IPv4 private/link-local
addresses and loopback are supported; IPv6-only LANs retain manual pairing.
UDP 45873 handles a two-second, user-triggered discovery scan. Hosts respond to
`{v:1,type:"discover",nonce:<32 hex>}` with `type:"room"`, the same nonce, a random
128-bit `room`, ephemeral TCP `port` and `full` flag. They never advertise the
six-character code. Discovery does not authenticate a device; the guest must
enter the code shown by the host. A compact `KP1-` invitation skips discovery:
28 bytes (IPv4 address, port, room ID, code), encoded as base64url. Encoding is
not encryption; share it only with the intended guest. The UI labels rooms with
a temporary room suffix and does not display IP addresses or device names.
No DNS lookup, STUN, TURN, HTTP endpoint or internet service is used.

TCP messages are UTF-8 JSON followed by LF, maximum 65,536 bytes including LF.
Every message carries `v:1`. First message within five seconds: `type:"join"`,
`code`, optional discovered `room`, and a random 32-hex client `token`. A room
holds exactly one pending/accepted guest. The code uses OS cryptographic RNG.
Host replies `welcome`, then waits for local approval (default on). It sends
`approved` only after that approval; pending peers cannot send signaling.
Rejection/kicking blocks the token for that room's lifetime (bounded 128).

After approval, host sends `start` with `attempt:0,iceServers:[]`. Existing
WebRTC offer/answer and ICE candidate messages follow. The only other allowed
signal is `connected`. Host descriptions must be offers, guest descriptions
answers; SDP <=49,152 characters, candidates <=4,096. Unknown kinds, wrong
versions/roles, oversized messages and more than 160 messages/10s terminate
that peer. No arbitrary destinations or data forwarding are supported.
Native heartbeats every five seconds detect failure within 20 seconds; pending
approval expires at 60 seconds. Eight connection attempts per IP per 30 seconds
and at most 128 rate entries bound unauthenticated work. Discovery is separately
limited to one reply/IP/second and 64 entries. TCP listen backlog is four.

The bridge exchanges JSON commands (`host`, `discover`, `join`, `send`,
`approve`, `release`, `close`) and events (`hosting`, `rooms`, `joined`, `peer`,
`admitted`, `signal`, `departed`, `error`). Each carries a local `generation` so
stale async callbacks cannot reconnect a closed room. Native bridges are
available only to the packaged top-level game page. All room sockets close on
exit/navigation/backgrounding; no service persists outside LAN activity.

This is a trusted-local-network protocol. Signaling is plaintext on that LAN;
the short code is not a defense against a LAN packet sniffer or active MITM.
WebRTC encrypts the data channels. Discovery never broadcasts the code, and
approval lets the host reject an unexpected join. Optional [pairing PIN
comparison](PAIRING.md) binds the human comparison to the WebRTC connection;
ordinary host approval alone does not authenticate the channel. Firewalls/client isolation can
prevent both discovery and direct WebRTC traffic; manual pairing cannot bypass
network isolation. The UI retains it for discovery/bridge failures.

Android currently targets API 36. `INTERNET` provides local-network access at
that target; `CHANGE_WIFI_MULTICAST_STATE` supports the bounded discovery lock.
When raising the target to API 37, implement the `ACCESS_LOCAL_NETWORK` runtime
permission flow before starting LAN sockets. See the [Android local-network
permission guidance](https://developer.android.com/privacy-and-security/local-network-permission).
