"""
Окно сборщика в обычном браузере без Electron и Node — то же, что tools/serve.js,
но на Python. Данные подставляет src/ui/mock.js.

    python tools/serve.py 5176
"""
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'ui')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5176


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/index.html'):
            # в браузере нет preload — дотягиваем заглушку перед основным скриптом
            with open(os.path.join(ROOT, 'index.html'), encoding='utf-8') as f:
                html = f.read().replace('<script src="app.js">', '<script src="mock.js"></script>\n  <script src="app.js">')
            body = html.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


print(f'http://localhost:{PORT}')
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
