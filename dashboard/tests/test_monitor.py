import importlib.util
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('dashboard_app', Path(__file__).resolve().parents[1] / 'app.py')
APP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(APP)


class TestMonitor(unittest.TestCase):
    def setUp(self):
        self.monitor = APP.Monitor()

    def test_real_log_format_reconstructs_round_and_global_metrics(self):
        self.monitor.consume('server', '[Servidor] Cliente 3: atualização recebida na rodada 1')
        self.monitor.consume('server', '[Servidor] Rodada 1/5 consolidada')
        self.monitor.consume('server', '  Modelo global - loss: 0.4877 | acc: 0.9333')
        state = self.monitor.snapshot()
        self.assertEqual(state['received']['1'], [3])
        self.assertEqual(state['rounds'], [{'round': 1, 'loss': 0.4877, 'accuracy': 0.9333}])
        self.assertEqual(state['status'], 'idle')

    def test_client_ack_updates_only_the_corresponding_client(self):
        self.monitor.consume('client-2', '[Cliente 2] Rodada 3 aceita | loss: 0.6562 | acc: 0.7917')
        state = self.monitor.snapshot()
        self.assertEqual(state['clients'][2]['round'], 3)
        self.assertEqual(state['clients'][2]['accuracy'], 0.7917)
        self.assertEqual(state['clients'][1]['round'], 0)

    def test_unstructured_warnings_are_kept_without_inventing_metrics(self):
        self.monitor.consume('server', 'Warning: downloading dataset')
        state = self.monitor.snapshot()
        self.assertEqual(state['rounds'], [])
        self.assertEqual(state['events'], [])
        self.assertEqual(state['logs'][0]['message'], 'Warning: downloading dataset')

    def test_snapshot_is_detached_from_internal_state(self):
        self.monitor.snapshot()['clients'][0]['round'] = 99
        self.assertEqual(self.monitor.snapshot()['clients'][0]['round'], 0)

    def test_stop_without_run_is_noop(self):
        self.assertFalse(self.monitor.stop())
        self.assertEqual(self.monitor.snapshot()['status'], 'idle')

    def test_updates_include_structured_participants_and_ordered_sequences(self):
        self.monitor.consume('server', '[Servidor] Cliente 2: atualização recebida na rodada 3')
        self.monitor.consume('client-2', '[Cliente 2] Rodada 3 aceita | loss: 0.6562 | acc: 0.7917')
        state = self.monitor.snapshot()
        self.assertEqual(state['events'][0]['kind'], 'update_received')
        self.assertEqual(state['events'][0]['cid'], 2)
        self.assertEqual(state['events'][1]['kind'], 'update_accepted')
        self.assertEqual(state['events'][1]['round'], 3)
        sequence = sorted([item['seq'] for item in state['logs'] + state['events']])
        self.assertEqual(sequence, [1, 2, 3, 4])

    def test_process_lifecycle_is_recorded_before_output_and_after_exit(self):
        process, reader = self.monitor.launch('client-0', ['-c', 'print("lifecycle-test")'])
        process.wait(timeout=10)
        reader.join(timeout=10)
        state = self.monitor.snapshot()
        self.assertEqual(state['events'][0]['kind'], 'service_started')
        self.assertEqual(state['events'][0]['pid'], process.pid)
        self.assertEqual(state['events'][-1]['kind'], 'service_stopped')
        self.assertEqual(state['events'][-1]['exit_code'], 0)
        self.assertLess(state['events'][0]['seq'], state['logs'][0]['seq'])
        self.assertLess(state['logs'][0]['seq'], state['events'][-1]['seq'])


class TestHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), APP.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_static_page_and_state_are_served(self):
        with urllib.request.urlopen(self.url) as response:
            self.assertIn(b'FedScope', response.read())
        with urllib.request.urlopen(self.url + '/api/state') as response:
            self.assertEqual(json.load(response)['status'], 'idle')

    def test_cross_origin_start_is_rejected(self):
        request = urllib.request.Request(self.url + '/api/start', method='POST', headers={'Origin': 'https://example.org'})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(request)
        self.assertEqual(error.exception.code, 403)

    def test_static_path_cannot_read_application_source(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.url + '/app.py')
        self.assertEqual(error.exception.code, 404)

    def test_whiteboard_assets_are_served(self):
        for path, mime in [('/whiteboard.js', 'text/javascript'), ('/whiteboard.css', 'text/css')]:
            with urllib.request.urlopen(self.url + path) as response:
                self.assertIn(mime, response.headers['Content-Type'])
                self.assertGreater(len(response.read()), 0)
