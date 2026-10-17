#!/usr/bin/env python3
"""Exercise production Python/Java LAN cores on real local UDP/TCP sockets.

This is not an Android-device or WebRTC gameplay test. Java uses the small
test-only org.json jar in place of Android's built-in implementation.
"""
import argparse
import json
import queue
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path


class Driver:
    def __init__(self, command):
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        text=True, bufsize=1)
        self.events = queue.Queue()
        def read():
            for line in self.process.stdout:
                self.events.put(json.loads(line))
        threading.Thread(target=read, daemon=True).start()

    def send(self, op, **fields):
        self.process.stdin.write(json.dumps(dict(op=op, generation=1, **fields)) + '\n')
        self.process.stdin.flush()

    def wait(self, kind):
        deadline = time.monotonic() + 6
        while time.monotonic() < deadline:
            event = self.events.get(timeout=max(.01, deadline - time.monotonic()))
            if event['type'] == kind:
                return event
        raise AssertionError('Missing event: ' + kind)

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            self.process.wait(timeout=3)
        self.process.stdout.close()


def check(host_command, guest_command):
    host, guest = Driver(host_command), Driver(guest_command)
    try:
        host.send('host'); info = host.wait('hosting')
        guest.send('discover'); rooms = guest.wait('rooms')['rooms']
        assert any(r['room'] == info['room'] for r in rooms)
        assert all('code' not in r for r in rooms)
        guest.send('join', address='127.0.0.1', port=info['port'], room=info['room'],
                   code=info['code'], token=secrets.token_hex(16))
        guest.wait('joined'); request = host.wait('peer')['request']
        host.send('approve', request=request, accept=True); host.wait('admitted')
        host.send('send', message=dict(type='start', attempt=0, iceServers=[]))
        assert guest.wait('signal')['message']['iceServers'] == []
        host.send('send', message=dict(type='description', attempt=0,
                                     description=dict(type='offer', sdp='v=0\r\n')))
        assert guest.wait('signal')['message']['description']['type'] == 'offer'
        guest.send('send', message=dict(type='description', attempt=0,
                                      description=dict(type='answer', sdp='v=0\r\n')))
        assert host.wait('signal')['message']['description']['type'] == 'answer'
        host.send('release', block=True)
        assert guest.wait('error')['code'] == 'kicked'
        host.wait('departed')
        host.send('close')
    finally:
        guest.close(); host.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--java', required=True)
    parser.add_argument('--classpath', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    commands = {
        'Python': [sys.executable, str(root / 'tests/fixtures/lan-driver.py')],
        'Java': [args.java, '-Djava.net.preferIPv4Stack=true', '-cp', args.classpath,
                 'com.kingalex.kingpong.LanDriver'],
    }
    for host_name, host_command in commands.items():
        for guest_name, guest_command in commands.items():
            check(host_command, guest_command)
            print('PASS ' + host_name + ' host -> ' + guest_name + ' guest (real UDP/TCP)', flush=True)
