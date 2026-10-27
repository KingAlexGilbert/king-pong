"""King Pong LAN v1: bounded IPv4 discovery/signaling, standard library only.
Gameplay never travels over these sockets. Nothing runs before Host/Join.
"""
import re
import ipaddress
import json
import secrets
import queue
import os
import select
import socket
import threading
import time

VERSION = 1
PORT = 45873
LIMIT = 65536
ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


def local_ip(value):
    try:
        ip = ipaddress.IPv4Address(value)
        return ip in ipaddress.ip_network('10.0.0.0/8') or ip in ipaddress.ip_network('172.16.0.0/12') or ip in ipaddress.ip_network('192.168.0.0/16') or ip.is_loopback or ip in ipaddress.ip_network('169.254.0.0/16')
    except ValueError:
        return False


def parse(text):
    depth = 0; quoted = False; escaped = False
    for ch in text:
        if escaped: escaped = False; continue
        if quoted and ch == "\\": escaped = True; continue
        if ch == '"': quoted = not quoted
        elif not quoted:
            if ch in '{[': depth += 1
            elif ch in '}]': depth -= 1
            if depth > 12: raise ValueError('depth')
    return json.loads(text)


def encoded(message):
    data = json.dumps(dict(message, v=VERSION), separators=(',', ':')).encode('utf-8') + b'\n'
    if len(data) > LIMIT:
        raise ValueError('oversized')
    return data


def valid_signal(m, from_host):
    if not isinstance(m, dict) or m.get('attempt', 0) != 0:
        return False
    kind = m.get('type')
    if kind == 'description':
        d = m.get('description', {})
        return isinstance(d, dict) and d.get('type') == ('offer' if from_host else 'answer') and isinstance(d.get('sdp'), str) and len(d['sdp']) <= 49152
    if kind == 'candidate':
        c = m.get('candidate', {})
        return isinstance(c, dict) and isinstance(c.get('candidate'), str) and len(c['candidate']) <= 4096 and (c.get('sdpMid') is None or isinstance(c['sdpMid'], str) and len(c['sdpMid']) <= 256) and (c.get('sdpMLineIndex') is None or type(c['sdpMLineIndex']) is int and 0 <= c['sdpMLineIndex'] <= 32)
    return kind == 'connected' or from_host and kind == 'start' and m.get('iceServers') == []


def interfaces():
    try: return socket.if_nameindex()
    except OSError:
        try: return list(enumerate(os.listdir('/sys/class/net')))
        except OSError: return []


def addresses():
    # No internet probes or hostname lookup. Linux routing table lists interface
    # names, and ioctl reads the addresses locally. Other platforms enumerate APIs.
    import fcntl
    import struct
    result = []
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        for _, name in interfaces():
            try:
                ip = socket.inet_ntoa(fcntl.ioctl(s.fileno(), 0x8915, struct.pack('256s', name.encode()[:15]))[20:24])
                if local_ip(ip) and not ip.startswith('127.'):
                    result.append(ip)
            except OSError:
                pass
    return result


class Peer:
    def __init__(self, sock):
        self.sock = sock
        sock.settimeout(1)
        self.buffer = b''
        self.lock = threading.Lock()
        self.approved = False
        self.token = ''
        self.request = secrets.token_hex(8)
        self.started = time.monotonic()
        self.closed = False

    def send(self, m):
        with self.lock:
            if not self.closed:
                self.sock.sendall(encoded(m))

    def line(self, deadline):
        while b'\n' not in self.buffer:
            if self.closed or time.monotonic() >= deadline:
                raise TimeoutError()
            if not select.select([self.sock], [], [], min(.5, max(0, deadline-time.monotonic())))[0]:
                continue
            data = self.sock.recv(4096)
            if not data:
                raise EOFError()
            self.buffer += data
            if len(self.buffer) > LIMIT:
                raise ValueError('oversized')
        line, self.buffer = self.buffer.split(b'\n', 1)
        m = parse(line.decode("utf-8"))
        if not isinstance(m, dict) or type(m.get('v')) is not int or m.get('v') != VERSION:
            raise ValueError('incompatible')
        return m

    def close(self):
        self.closed = True
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


class LocalLan:
    def __init__(self, emit, generation):
        self.emit_callback, self.generation = emit, generation
        self.closed = False
        self.host = False
        self.peer = self.listener = self.udp = self.discovery_thread = None
        self.lock = threading.RLock()
        self.blocked = set()
        self.rates = {}
        self.code = self.room = ''

    def emit(self, kind, **fields):
        if not self.closed:
            self.emit_callback(dict(fields, type=kind, generation=self.generation))

    def allow(self, ip, limit=8):
        now = time.monotonic()
        self.rates = {k: v for k, v in self.rates.items() if now-v[0] < 30}
        start, count = self.rates.get(ip, (now, 0))
        if count >= limit or len(self.rates) >= 128 and ip not in self.rates:
            return False
        self.rates[ip] = (start, count+1)
        return True

    def start_host(self):
        if self.closed: return
        self.host = True
        self.code = ''.join(secrets.choice(ALPHABET) for _ in range(6))
        self.room = secrets.token_hex(16)
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(('', 0)); self.listener.listen(4); self.listener.settimeout(.5)
        port = self.listener.getsockname()[1]
        try:
            self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.udp.bind(('', PORT)); self.udp.settimeout(.5)
            self.discovery_thread = threading.Thread(target=self.discovery_loop, args=(port,), daemon=True)
            self.discovery_thread.start()
        except OSError:
            if self.udp: self.udp.close()
            self.udp = None
        self.emit('hosting', code=self.code, room=self.room, port=port, addresses=addresses(), discovery=self.udp is not None)
        threading.Thread(target=self.accept_loop, daemon=True).start()

    def discovery_loop(self, port):
        rates = {}
        while not self.closed:
            try:
                data, addr = self.udp.recvfrom(1025)
                now = time.monotonic()
                rates = {k:v for k,v in rates.items() if now-v < 1}
                if len(data) > 1024 or not local_ip(addr[0]) or addr[0] in rates or len(rates) >= 64:
                    continue
                m = parse(data.decode("utf-8"))
                if type(m.get('v')) is not int or m.get('v') != VERSION or m.get('type') != 'discover' or not isinstance(m.get('nonce'), str) or not re.fullmatch('[a-f0-9]{32}', m['nonce']):
                    continue
                rates[addr[0]] = now
                self.udp.sendto(encoded(dict(type='room', nonce=m['nonce'], room=self.room, port=port, full=self.peer is not None)), addr)
            except (OSError, ValueError, AttributeError):
                continue

    def accept_loop(self):
        while not self.closed:
            try:
                sock, addr = self.listener.accept()
            except OSError:
                continue
            p = Peer(sock)
            try:
                if not local_ip(addr[0]) or not self.allow(addr[0]):
                    p.send(dict(type='error', code='rate_limited')); p.close(); continue
                if self.peer is not None:
                    p.send(dict(type='error', code='room_full')); p.close(); continue
                m = p.line(time.monotonic()+5)
                token = m.get('token', '')
                if m.get('type') != 'join' or not secrets.compare_digest(str(m.get('code', '')), self.code) or m.get('room', '') not in ('', self.room) or not isinstance(token, str) or len(token) != 32 or any(c not in '0123456789abcdef' for c in token):
                    p.send(dict(type='error', code='invalid_code')); p.close(); continue
                if token in self.blocked:
                    p.send(dict(type='error', code='rejected')); p.close(); continue
                with self.lock:
                    if self.closed: p.close(); return
                    p.token = token; self.peer = p
                p.send(dict(type='welcome', code=self.code, room=self.room))
                self.emit('peer', request=p.request)
                threading.Thread(target=self.read_loop, args=(p,), daemon=True).start()
            except (OSError, ValueError, EOFError):
                p.close()

    def join(self, address, port, code, room, token):
        if not local_ip(address) or type(port) is not int or not 1024 <= port <= 65535:
            raise ValueError('invalid_code')
        p = Peer(socket.create_connection((address, port), timeout=5))
        with self.lock:
            if self.closed: p.close(); return
            self.peer = p
        p.send(dict(type='join', code=code, room=room, token=token))
        m = p.line(time.monotonic()+5)
        if m.get('type') != 'welcome':
            self.emit('error', code=m.get('code', 'incompatible')); self.close(); return
        self.code = m.get('code', '')
        self.emit('joined', code=self.code)
        self.read_loop(p)

    def read_loop(self, p):
        last_ping = time.monotonic()
        last_read = last_ping
        bucket = last_ping; count = 0
        try:
            while not self.closed and not p.closed:
                now = time.monotonic()
                # Do not preempt the game's 30-second background recovery window.
                if now-last_read > 40 or not p.approved and now-p.started > 60:
                    raise TimeoutError()
                if now-last_ping >= 5:
                    p.send(dict(type='ping')); last_ping = now
                try:
                    m = p.line(now+.5)
                except TimeoutError:
                    continue
                last_read = time.monotonic()
                if last_read-bucket >= 10: bucket = last_read; count = 0
                count += 1
                if count > 160: raise ValueError('rate_limited')
                kind = m.get('type')
                if kind == 'ping': p.send(dict(type='pong')); continue
                if kind == 'pong': continue
                if not self.host and kind == 'approved': p.approved = True; continue
                if not self.host and kind == 'error': self.emit('error', code=m.get('code','connection_lost')); self.close(); break
                if not p.approved or not valid_signal(m, not self.host):
                    raise ValueError('invalid_message')
                m.pop('v', None)
                self.emit('signal', message=m)
        except (OSError, ValueError, EOFError):
            pass
        finally:
            with self.lock:
                if self.peer is p:
                    self.peer = None
                    self.emit('departed' if self.host else 'error', code='host_left')
            p.close()

    def approve(self, request, accepted):
        with self.lock:
            p = self.peer
            if not p or p.request != request or p.approved: return
            if accepted:
                p.approved = True; p.send(dict(type='approved')); self.emit('admitted')
            else:
                self.release(True, 'rejected')

    def release(self, block=False, reason='guest_left'):
        with self.lock:
            p = self.peer
            if not p: return
            if block and len(self.blocked) < 128: self.blocked.add(p.token)
            self.peer = None
            try: p.send(dict(type='error', code=reason))
            except OSError: pass
            p.close()
            self.emit('departed')

    def send(self, m):
        with self.lock:
            if self.peer and self.peer.approved and valid_signal(m, self.host): self.peer.send(m)

    def close(self):
        self.closed = True
        if self.listener:
            try: self.listener.shutdown(socket.SHUT_RDWR)
            except OSError: pass
        for s in (self.listener, self.udp):
            if s: s.close()
        # A blocked recvfrom() can retain the UDP port after close() on Linux.
        # Wait for the bounded-time listener to exit before another host binds it.
        if self.discovery_thread and self.discovery_thread is not threading.current_thread():
            self.discovery_thread.join(timeout=1)
        if self.peer: self.peer.close()
        self.peer = None


def discover(emit, generation, cancelled=None):
    nonce = secrets.token_hex(16); rooms = {}
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1); s.bind(('', 0)); s.settimeout(.25)
        packet = encoded(dict(type='discover', nonce=nonce))
        # Limited broadcast and interface-directed broadcasts cover multihomed hosts.
        destinations = {'255.255.255.255', '127.0.0.1'}
        try:
            import fcntl, struct
            for _, name in interfaces():
                try: destinations.add(socket.inet_ntoa(fcntl.ioctl(s.fileno(), 0x8919, struct.pack('256s',name.encode()[:15]))[20:24]))
                except OSError: pass
        except ImportError: pass
        for address in destinations:
            if cancelled and cancelled.is_set(): break
            try: s.sendto(packet, (address, PORT))
            except OSError: pass
        until = time.monotonic()+2
        while time.monotonic() < until and not (cancelled and cancelled.is_set()):
            try:
                data, addr = s.recvfrom(1025); m = parse(data.decode("utf-8"))
                if len(data) <= 1024 and local_ip(addr[0]) and m.get('v') == VERSION and m.get('type') == 'room' and m.get('nonce') == nonce and isinstance(m.get('room'), str) and re.fullmatch('[a-f0-9]{32}', m['room']) and type(m.get('port')) is int and 1024 <= m['port'] <= 65535 and len(rooms) < 32:
                    rooms[m['room']] = dict(room=m['room'], address=addr[0], port=m['port'], full=bool(m.get('full')))
            except (OSError, ValueError, AttributeError): pass
    emit(dict(type='rooms', generation=generation, rooms=list(rooms.values())))


class LanBridge:
    def __init__(self, emit):
        self.emit = emit; self.active = None; self.lock = threading.Lock()
        self.scan_generation = None; self.closed = False; self.lifecycle = 0
        self.scan_cancelled = threading.Event(); self.scan_thread = None
        self.commands = queue.Queue(maxsize=128)
        threading.Thread(target=self.run, daemon=True).start()

    def run(self):
        while not self.closed:
            work = self.commands.get()
            if not self.closed: work()

    def handle(self, text):
        if self.closed or len(text) > LIMIT: return
        try:
            m = parse(text); gen = m['generation']; op = m['op']
            if type(gen) is not int or not 0 < gen <= 2147483647: return
        except (ValueError, KeyError, TypeError): return
        epoch = self.lifecycle
        def work():
            try:
                with self.lock:
                    if self.closed or epoch != self.lifecycle: return
                    if op == 'discover':
                        if self.scan_generation is not None: return
                        self.scan_generation = gen
                        self.scan_cancelled.clear()
                    elif op in ('host','join'):
                        if self.active: self.active.close()
                        self.active = LocalLan(self.emit, gen)
                        if op == 'host': self.active.start_host()
                    room = self.active
                if op == 'discover':
                    def scan():
                        try: discover(self.emit, gen, self.scan_cancelled)
                        except OSError: self.emit(dict(type='rooms',generation=gen,rooms=[]))
                        finally: self.scan_generation = None
                    self.scan_thread = threading.Thread(target=scan, daemon=True)
                    self.scan_thread.start()
                elif op == 'host': pass
                elif op == 'join':
                    def connect():
                        try: room.join(m['address'],m['port'],m['code'],m.get('room',''),m['token'])
                        except (OSError, ValueError, KeyError, TypeError): room.emit('error',code='connection_lost'); room.close()
                    threading.Thread(target=connect, daemon=True).start()
                elif room and room.generation == gen:
                    if op == 'close':
                        room.close()
                        self.scan_cancelled.set()
                        if self.scan_thread: self.scan_thread.join()
                        self.emit(dict(type='closed', generation=gen))
                    elif op == 'send': room.send(m['message'])
                    elif op == 'approve': room.approve(m['request'],m['accept'] is True)
                    elif op == 'release': room.release(m.get('block') is True, 'kicked' if m.get('block') else 'guest_left')
            except (OSError, ValueError, KeyError, TypeError):
                self.emit(dict(type='error',code='connection_lost',generation=gen))
        try: self.commands.put_nowait(work)
        except queue.Full: pass

    def stop(self):
        with self.lock:
            self.lifecycle += 1
            if self.active: self.active.close()

    def close(self):
        with self.lock:
            self.closed = True
            if self.active: self.active.close()
        try: self.commands.put_nowait(lambda: None)
        except queue.Full: pass
