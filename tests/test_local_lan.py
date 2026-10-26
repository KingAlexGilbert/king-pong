import importlib.util
import json
import queue
import secrets
import socket
import sys
import threading
import time
import unittest
from pathlib import Path
def load_lan():
    # Import on demand. Pure protocol/bridge helpers are portable; Linux ioctl
    # imports live inside addresses()/discover(), never at module import time.
    spec = importlib.util.spec_from_file_location('king_pong_lan', Path(__file__).parents[1] / 'Linux/src/king_pong_lan.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux interface discovery requires fcntl/ioctl')
class LocalLanTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lan = load_lan()

    def setUp(self):
        self.events=queue.Queue();self.host=self.lan.LocalLan(self.events.put,1);self.host.start_host()
        self.info=self.wait(self.events,'hosting');self.peers=[]
    def tearDown(self):
        for p in self.peers:p.close()
        self.host.close()
    def wait(self,q,kind):
        until=time.monotonic()+4
        while time.monotonic()<until:
            event=q.get(timeout=max(.01,until-time.monotonic()))
            if event['type']==kind:return event
        self.fail(kind)
    def guest(self,code=None,token=None):
        q=queue.Queue();g=self.lan.LocalLan(q.put,2);self.peers.append(g)
        threading.Thread(target=g.join,args=('127.0.0.1',self.info['port'],code or self.info['code'],self.info['room'],token or secrets.token_hex(16)),daemon=True).start()
        return g,q
    def raw(self,message):
        s=socket.create_connection(('127.0.0.1',self.info['port']),timeout=2);self.peers.append(s)
        s.sendall(json.dumps(message).encode()+b'\n');return s
    def test_real_discovery_and_two_way_signaling(self):
        q=queue.Queue();self.lan.discover(q.put,10);rooms=self.wait(q,'rooms')['rooms']
        self.assertTrue(any(r['room']==self.info['room'] for r in rooms), f"host discovery={self.info['discovery']}; discovered rooms={rooms}")
        self.assertTrue(all('code' not in r for r in rooms))
        g,q=self.guest();self.wait(q,'joined');peer=self.wait(self.events,'peer')
        self.assertFalse(self.host.peer.approved)
        self.host.approve(peer['request'],True);self.wait(self.events,'admitted')
        self.host.send(dict(type='start',attempt=0,iceServers=[]))
        self.assertEqual(self.wait(q,'signal')['message']['iceServers'],[])
        g.send(dict(type='description',attempt=0,description=dict(type='answer',sdp='v=0\r\n')))
        self.assertEqual(self.wait(self.events,'signal')['message']['description']['type'],'answer')
    def test_invalid_full_reject_block_and_replacement(self):
        g,q=self.guest(code='AAAAAA');self.assertEqual(self.wait(q,'error')['code'],'invalid_code')
        token=secrets.token_hex(16);g,q=self.guest(token=token);self.wait(q,'joined');pending=self.wait(self.events,'peer')
        second,sq=self.guest();self.assertEqual(self.wait(sq,'error')['code'],'room_full')
        self.host.approve(pending['request'],False);self.assertEqual(self.wait(q,'error')['code'],'rejected')
        repeat,rq=self.guest(token=token);self.assertEqual(self.wait(rq,'error')['code'],'rejected')
        replacement,rq=self.guest();self.wait(rq,'joined');self.assertIsNotNone(self.host.peer)
    def test_guest_cannot_self_approve_or_signal_while_pending(self):
        g,q=self.guest();self.wait(q,'joined');self.wait(self.events,'peer')
        g.peer.send(dict(type='approved'))
        self.wait(self.events,'departed');self.assertIsNone(self.host.peer)
    def test_kick_retains_room_and_disconnect_releases_slot(self):
        g,q=self.guest();self.wait(q,'joined');p=self.wait(self.events,'peer');self.host.approve(p['request'],True)
        self.host.release(True,'kicked');self.assertEqual(self.wait(q,'error')['code'],'kicked')
        self.assertFalse(self.host.closed);self.assertEqual(self.host.code,self.info['code'])
        g,q=self.guest();self.wait(q,'joined');self.wait(self.events,'peer');g.close();self.wait(self.events,'departed')
    def test_version_and_oversized_frames(self):
        for data in [dict(v=2,type='join'),dict(v=1,type='join',junk='x'*66000)]:
            s=self.raw(data);self.assertEqual(s.recv(4096),b'')
    def test_closed_room_releases_tcp_port(self):
        self.host.close();time.sleep(.6)
        with self.assertRaises(OSError):socket.create_connection(('127.0.0.1',self.info['port']),timeout=.5)
    def test_closed_room_releases_udp_discovery_port(self):
        self.assertTrue(self.info['discovery'], 'host must bind its discovery port')
        listener = self.host.discovery_thread
        self.host.close()
        self.assertFalse(listener.is_alive(), 'discovery listener must exit before close returns')
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.bind(('', self.lan.PORT))
    def test_pending_deadline_and_message_rate(self):
        g,q=self.guest();self.wait(q,'joined');self.wait(self.events,'peer');self.host.peer.started-=61
        self.wait(self.events,'departed');self.assertIsNone(self.host.peer)
    def test_invalid_codes_rate_limited(self):
        for n in range(9):
            s=self.raw(dict(v=1,type='join',code='WRONG2',token=secrets.token_hex(16)))
            reply=json.loads(s.recv(1024));self.assertEqual(reply['code'],'invalid_code' if n<8 else 'rate_limited')
            s.close()

class PortableLanProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lan = load_lan()

    def test_bad_signaling_direction_and_empty_ice(self):
        self.assertFalse(self.lan.valid_signal(dict(type='description',description=dict(type='offer',sdp='v=0')),False))
        self.assertFalse(self.lan.valid_signal(dict(type='start',iceServers=[{'urls':'stun:example.com'}]),True))
        self.assertFalse(self.lan.valid_signal(dict(type='candidate',candidate={'candidate':'x'*4097}),False))
        self.assertFalse(self.lan.local_ip('8.8.8.8'));self.assertFalse(self.lan.local_ip('localhost'));self.assertFalse(self.lan.local_ip('::1'))

    def test_idle_signaling_allows_background_grace_but_still_expires(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        for returns in (False, True):
            clock = [0]
            received = []
            class Peer:
                approved = True
                closed = False
                started = 0
                def send(self, message): pass
                def line(self, _deadline):
                    clock[0] += 1
                    if returns and clock[0] == 29:
                        received.append(clock[0])
                        return {'type': 'pong'}
                    raise TimeoutError()
                def close(self): self.closed = True
            room = self.lan.LocalLan(lambda _: None, 1)
            peer = room.peer = Peer()
            with patch.object(self.lan, 'time', SimpleNamespace(monotonic=lambda: clock[0])):
                room.read_loop(peer)
            self.assertTrue(peer.closed)
            self.assertEqual(clock[0], 70 if returns else 41)
            self.assertEqual(received, [29] if returns else [])

class BridgeLifecycleTests(unittest.TestCase):
    def test_stop_discards_queued_host_but_allows_new_generation(self):
        from unittest.mock import patch
        lan = load_lan()
        entered = threading.Event(); release = threading.Event(); stopped = threading.Event()
        rooms = []
        class Room:
            def __init__(self, emit, generation):
                self.generation = generation; self.closed = False; rooms.append(self)
            def start_host(self):
                if self.generation == 1:
                    entered.set(); release.wait(3)
            def close(self): self.closed = True
        with patch.object(lan, 'LocalLan', Room):
            bridge = lan.LanBridge(lambda _: None)
            try:
                bridge.handle(json.dumps(dict(op='host', generation=1)))
                self.assertTrue(entered.wait(2))
                bridge.handle(json.dumps(dict(op='host', generation=2)))
                stop = threading.Thread(target=lambda: (bridge.stop(), stopped.set()))
                stop.start()
                self.assertFalse(stopped.wait(.05), 'stop waits for any in-flight host start')
                release.set(); stop.join(2)
                self.assertTrue(stopped.is_set())
                self.assertTrue(all(room.closed for room in rooms))
                bridge.handle(json.dumps(dict(op='host', generation=3)))
                deadline = time.monotonic() + 2
                while not any(room.generation == 3 for room in rooms) and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertEqual(rooms[-1].generation, 3)
                self.assertFalse(rooms[-1].closed)
            finally:
                release.set(); bridge.close()
            self.assertTrue(all(room.closed for room in rooms))

if __name__=='__main__':unittest.main()
