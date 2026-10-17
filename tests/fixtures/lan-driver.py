"""Test adapter: real production Python sockets with stdin/stdout UI events."""
import json
import sys
import threading
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'Linux/src'))
from king_pong_lan import LanBridge
lock=threading.Lock()
def emit(message):
    with lock:print(json.dumps(message),flush=True)
bridge=LanBridge(emit)
try:
    for line in sys.stdin:bridge.handle(line)
finally:bridge.close()
