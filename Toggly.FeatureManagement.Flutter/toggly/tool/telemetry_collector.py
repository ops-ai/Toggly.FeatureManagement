"""Loopback-only collector/static host; never forwards events externally.
Run from the example after compiling integration/telemetry_browser.dart.
"""
import gzip
import http.server
import json
import pathlib
import threading
import sys

root = pathlib.Path(sys.argv[1]).resolve()
records = []
lock = threading.Lock()
class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'content-type,content-encoding')
        self.send_header('Access-Control-Allow-Methods', 'POST,GET,OPTIONS')
    def do_OPTIONS(self):
        with lock: records.append({'method':'OPTIONS','origin':self.headers.get('Origin')})
        self.send_response(204); self.cors(); self.end_headers()
    def do_GET(self):
        if self.path.startswith('/records'):
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
            with lock: self.wfile.write(json.dumps(records).encode())
        elif '/evaluated-signed/' in self.path:
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers()
            self.wfile.write(b'{"defs":{"a":true}}')
        else:
            super().do_GET()
    def do_POST(self):
        data=self.rfile.read(int(self.headers.get('Content-Length','0')))
        encoding=self.headers.get('Content-Encoding')
        decoded=gzip.decompress(data) if encoding=='gzip' else data
        entry={'method':'POST','path':self.path,'encoding':encoding,'cookie':self.headers.get('Cookie'),
               'origin':self.headers.get('Origin'),'bytes':len(decoded),'body':json.loads(decoded)}
        with lock: records.append(entry)
        self.send_response(202); self.cors(); self.end_headers()
    def log_message(self, *args): pass
for port in (18765,18766):
    server=http.server.ThreadingHTTPServer(('127.0.0.1',port),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
print('Loopback host 18765 and collector 18766 ready',flush=True)
threading.Event().wait()
