import copy
import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import grpc

ROOT = Path(__file__).resolve().parents[1]
CODE = ROOT / 'codigo' / 'start'
STATIC = Path(__file__).resolve().parent / 'static'


class Monitor:
    def __init__(self):
        self.lock = threading.RLock()
        self.processes = []
        self.worker = None
        self.cancelled = threading.Event()
        self.reset()

    def reset(self):
        self.sequence = 0
        self.state = {
            'status': 'idle', 'started_at': None, 'finished_at': None,
            'rounds': [], 'events': [], 'logs': [], 'clients': [
                {'id': cid, 'round': 0, 'loss': None, 'accuracy': None, 'exit_code': None}
                for cid in range(5)
            ], 'total_rounds': 5, 'num_clients': 5,
            'received': {}, 'exit_codes': {}, 'error': None,
        }

    def snapshot(self):
        with self.lock:
            return copy.deepcopy(self.state)

    def event(self, source, message, kind='message', **details):
        self.sequence += 1
        self.state['events'].append({
            'seq': self.sequence, 'time': time.time(), 'source': source,
            'message': message, 'kind': kind, **details,
        })
        self.state['events'] = self.state['events'][-500:]
        if source == 'monitor' or kind in ('service_started', 'service_stopped'):
            print(f'[{source}] {message}', flush=True)

    def consume(self, source, line):
        print(f'[{source}] {line}', flush=True)
        with self.lock:
            self.sequence += 1
            self.state['logs'].append({'seq': self.sequence, 'time': time.time(), 'source': source, 'message': line})
            self.state['logs'] = self.state['logs'][-1500:]
            if source == 'server':
                received = re.search(r'Cliente (\d+): atualização recebida na rodada (\d+)', line)
                consolidated = re.search(r'Rodada (\d+)/(\d+) consolidada', line)
                metrics = re.search(r'Modelo global - loss: ([\d.]+) \| acc: ([\d.]+)', line)
                if received:
                    cid, round_number = map(int, received.groups())
                    self.state['received'].setdefault(str(round_number), []).append(cid)
                    self.event(source, f'Cliente {cid} enviou a atualização da rodada {round_number}.', 'update_received', cid=cid, round=round_number)
                if consolidated:
                    round_number, total = map(int, consolidated.groups())
                    self.state['rounds'].append({'round': round_number, 'loss': None, 'accuracy': None})
                    self.event(source, f'Rodada {round_number}/{total} consolidada com FedAvg.', 'round_consolidated', round=round_number)
                if metrics and self.state['rounds']:
                    self.state['rounds'][-1].update(loss=float(metrics[1]), accuracy=float(metrics[2]))
                if 'Servidor gRPC ouvindo' in line:
                    self.event(source, 'Servidor gRPC disponível. Preparando os clientes.', 'server_ready')
            else:
                accepted = re.search(r'\[Cliente (\d+)\] Rodada (\d+) aceita \| loss: ([\d.]+) \| acc: ([\d.]+)', line)
                if accepted:
                    cid, round_number, loss, accuracy = accepted.groups()
                    self.state['clients'][int(cid)].update(round=int(round_number), loss=float(loss), accuracy=float(accuracy))
                    self.event(source, f'Atualização da rodada {round_number} aceita pelo servidor.', 'update_accepted', cid=int(cid), round=int(round_number), loss=float(loss), accuracy=float(accuracy))

    def launch(self, source, arguments):
        with self.lock:
            if self.cancelled.is_set():
                raise InterruptedError('Execução interrompida.')
            process = subprocess.Popen(
                [sys.executable, '-u', *arguments], cwd=CODE,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1, start_new_session=True,
            )
            self.processes.append((source, process))
            self.event(source, 'Processo iniciado.', 'service_started', pid=process.pid)
        reader = threading.Thread(target=self.read_process, args=(source, process), daemon=True)
        reader.start()
        return process, reader

    def read_process(self, source, process):
        for line in process.stdout:
            self.consume(source, line.rstrip())
        process.stdout.close()
        exit_code = process.wait()
        with self.lock:
            self.event(source, f'Processo encerrado com código {exit_code}.', 'service_stopped', exit_code=exit_code)

    def start(self):
        with self.lock:
            if self.worker and self.worker.is_alive():
                return False
            self.reset()
            self.processes = []
            self.cancelled.clear()
            self.state.update(status='starting', started_at=time.time())
            self.event('monitor', 'Execução iniciada. Carregando o Iris e o modelo global.')
            self.worker = threading.Thread(target=self.run, daemon=True)
            self.worker.start()
            return True

    def terminate(self):
        with self.lock:
            processes = list(self.processes)
        for _, process in processes:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
        deadline = time.monotonic() + 3
        for _, process in processes:
            try:
                process.wait(timeout=max(0.01, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()

    def stop(self):
        with self.lock:
            if not self.worker or not self.worker.is_alive():
                return False
            self.cancelled.set()
            self.state['status'] = 'stopping'
            self.event('monitor', 'Interrupção solicitada pelo usuário.')
        self.terminate()
        return True

    def run(self):
        readers = []
        try:
            server, reader = self.launch('server', ['student_fl_server_grpc.py', '--host', '127.0.0.1'])
            readers.append(reader)
            with grpc.insecure_channel('127.0.0.1:50051') as channel:
                ready = grpc.channel_ready_future(channel)
                deadline = time.monotonic() + 180
                try:
                    while True:
                        if self.cancelled.is_set():
                            raise InterruptedError('Execução interrompida.')
                        if server.poll() is not None:
                            raise RuntimeError('O servidor encerrou durante a inicialização. Consulte os logs.')
                        if time.monotonic() >= deadline:
                            raise TimeoutError('O servidor não ficou disponível em 180 segundos.')
                        try:
                            ready.result(timeout=0.25)
                            break
                        except grpc.FutureTimeoutError:
                            continue
                finally:
                    ready.cancel()
            with self.lock:
                if not self.cancelled.is_set():
                    self.state['status'] = 'running'
            for cid in range(5):
                _, reader = self.launch(f'client-{cid}', ['student_fl_client_grpc.py', '--cid', str(cid), '--server-address', '127.0.0.1:50051'])
                readers.append(reader)
            deadline = time.monotonic() + 300
            while any(process.poll() is None for _, process in self.processes):
                if self.cancelled.wait(0.2):
                    raise InterruptedError('Execução interrompida.')
                if time.monotonic() >= deadline:
                    raise TimeoutError('A execução excedeu cinco minutos. Consulte os logs.')
                if any(process.poll() not in (None, 0) for _, process in self.processes):
                    raise RuntimeError('Um participante encerrou com erro. Consulte os logs.')
            for reader in readers:
                reader.join(timeout=3)
            with self.lock:
                complete = len(self.state['rounds']) == 5 and all(item['accuracy'] is not None for item in self.state['rounds'])
                if not complete:
                    raise RuntimeError('Os processos encerraram sem confirmar todas as rodadas.')
                self.state['status'] = 'completed'
                self.event('monitor', 'Cinco rodadas concluídas. Servidor e clientes encerraram com código 0.')
        except (InterruptedError, OSError, RuntimeError, TimeoutError) as error:
            self.terminate()
            with self.lock:
                self.state['status'] = 'stopped' if self.cancelled.is_set() else 'error'
                self.state['error'] = None if self.cancelled.is_set() else str(error)
                self.event('monitor', str(error))
        finally:
            for reader in readers:
                reader.join(timeout=3)
            with self.lock:
                self.state['finished_at'] = time.time()
                self.state['exit_codes'] = {source: process.poll() for source, process in self.processes}
                for client in self.state['clients']:
                    client['exit_code'] = self.state['exit_codes'].get(f"client-{client['id']}")


MONITOR = Monitor()


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload, content_type='application/json; charset=utf-8'):
        data = json.dumps(payload, ensure_ascii=False).encode() if isinstance(payload, dict) else payload
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/state':
            self.respond(200, MONITOR.snapshot())
            return
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/whiteboard.js': ('whiteboard.js', 'text/javascript; charset=utf-8'), '/whiteboard.css': ('whiteboard.css', 'text/css; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
        if path not in files:
            self.respond(404, {'error': 'Recurso não encontrado.'})
            return
        name, mime = files[path]
        self.respond(200, (STATIC / name).read_bytes(), mime)

    def do_POST(self):
        origin = self.headers.get('Origin')
        if origin and origin not in (f"http://{self.headers.get('Host')}", f"https://{self.headers.get('Host')}"):
            self.respond(403, {'error': 'Origem não permitida.'})
            return
        if self.path == '/api/start':
            started = MONITOR.start()
            self.respond(202 if started else 409, {'ok': started})
        elif self.path == '/api/stop':
            self.respond(200, {'ok': MONITOR.stop()})
        else:
            self.respond(404, {'error': 'Operação não encontrada.'})

    def log_message(self, format, *args):
        return


if __name__ == '__main__':
    server = ThreadingHTTPServer(('0.0.0.0', 8080), Handler)
    print('Painel disponível na porta 8080.', flush=True)
    try:
        server.serve_forever()
    finally:
        MONITOR.stop()
        server.server_close()
