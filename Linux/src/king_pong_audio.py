"""One fixed optional asset, hash checked and atomically cached; no general URL API."""
import base64
import hashlib
import os
from pathlib import Path
import re
import threading
import time
import urllib.request
URL='https://kingalexgilbert.github.io/king-pong/audio/secret-boss-v1.ogg'
SIZE=684920
SHA256='2e88685119d386d9597cf62930a9335a4e894f599f4d580770cad7b4e2734167'
def valid(data):return len(data)==SIZE and hashlib.sha256(data).hexdigest()==SHA256
def load_track(directory):
    path=Path(directory)/'secret-boss-v1.ogg'
    try:
        with path.open('rb') as f:data=f.read(SIZE+1)
        if valid(data):return data
    except OSError:pass
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args):return None
    with urllib.request.build_opener(NoRedirect).open(URL,timeout=4) as response:
        if response.status!=200:raise ValueError('audio unavailable')
        data=bytearray();deadline=time.monotonic()+10
        while len(data)<=SIZE:
            chunk=response.read(min(16384,SIZE+1-len(data)))
            if not chunk:break
            data.extend(chunk)
            if time.monotonic()>deadline:raise TimeoutError()
    if not valid(data):raise ValueError('audio integrity')
    try:
        path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_suffix('.tmp')
        with temporary.open('wb') as f:f.write(data)
        os.replace(temporary,path)
    except OSError:pass
    return data
class BossAudioCache:
    def __init__(self,emit):self.emit=emit;self.lock=threading.Lock()
    def load(self,request):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,32}',request) or not self.lock.acquire(False):return
        def work():
            result=None
            try:
                directory=Path(os.environ.get('XDG_CACHE_HOME') or Path.home()/'.cache')/'king-pong'
                result=base64.b64encode(load_track(directory)).decode('ascii')
            except (OSError,ValueError):pass
            finally:self.lock.release()
            self.emit(request,result)
        threading.Thread(target=work,daemon=True).start()
