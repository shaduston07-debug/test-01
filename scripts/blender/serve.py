# Static server for the repo that also accepts POST /__dump?name=<file> (used by dump.js).
#   python scripts/blender/serve.py <repo dir> <dump dir>   → http://127.0.0.1:8765
import http.server, os, sys, urllib.parse
ROOT, DUMP = sys.argv[1], sys.argv[2]
os.makedirs(DUMP, exist_ok=True)


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        q = urllib.parse.urlparse(self.path)
        name = os.path.basename(urllib.parse.parse_qs(q.query).get('name', ['dump.bin'])[0])
        with open(os.path.join(DUMP, name), 'wb') as f:
            f.write(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        self.send_response(200)
        self.end_headers()


http.server.ThreadingHTTPServer(('127.0.0.1', 8765), H).serve_forever()
