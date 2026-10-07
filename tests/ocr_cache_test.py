import concurrent.futures
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
# Import-time cache setup must stay inside a dedicated temporary cache.
IMPORT_CACHE = tempfile.TemporaryDirectory(prefix='senate-ocr-import-test-')
os.environ['SENATE_CACHE'] = IMPORT_CACHE.name
import crawl_senate as crawler


class OCRCacheTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='senate-ocr-cache-test-')
        self.addCleanup(self.directory.cleanup)
        self.cache = pathlib.Path(self.directory.name)
        self.addCleanup(patch.stopall)
        patch.object(crawler, 'CACHE', self.cache).start()
        patch.dict(os.environ, {'PDFTOPPM': 'test-poppler'}).start()
        self.raw = b'%PDF-1.4\nOne public document used for many pages\n%%EOF'
        self.digest = hashlib.sha256(self.raw).hexdigest()
        self.inputs = []

    def render(self, args, **kwargs):
        source, prefix = pathlib.Path(args[-2]), pathlib.Path(args[-1])
        self.inputs.append(source)
        self.assertEqual(source.read_bytes(), self.raw)
        self.assertEqual(kwargs['timeout'], 90)
        prefix.with_suffix('.png').write_bytes(b'fake rendered image')

    def engine(self, image):
        self.assertTrue(pathlib.Path(image).is_file())
        return [[None, 'Recovered public text', 1.0]], None

    def pack(self, pages, **metadata):
        path = self.cache / 'bootstrap-pack.json'
        path.write_text(json.dumps({'version': 1, 'sourceSnapshot': '2026-10-06T19:15:34Z', 'pages': pages, **metadata}))
        return path

    def test_verified_public_bootstrap_seeds_all_pages_without_pdf_inputs(self):
        path = ROOT / 'data/ocr-bootstrap.json'
        self.assertEqual(crawler.seed_ocr_bootstrap(path), 770)
        self.assertEqual(len(list(self.cache.glob('*-ocr.json'))), 770)
        self.assertEqual(list(self.cache.glob('*.pdf')), [])
        self.assertEqual(list(self.cache.glob('*.png')), [])
        self.assertEqual(list(self.cache.glob('*.tmp')), [])
        self.assertEqual(crawler.seed_ocr_bootstrap(path), 0)

    def test_existing_results_are_preserved_and_changed_pdf_bytes_miss_the_seed(self):
        key = self.digest + '-1'
        path = self.pack({key: ['Previously published page text'], self.digest + '-2': ['A second published page']})
        existing = self.cache / (key + '-ocr.json')
        existing.write_text('["Newer existing extraction"]')
        self.assertEqual(crawler.seed_ocr_bootstrap(path), 1)
        self.assertEqual(json.loads(existing.read_text()), ['Newer existing extraction'])
        with patch.object(crawler.subprocess, 'run') as render:
            self.assertEqual(crawler.ocr_page(self.raw, 1), ['A second published page'])
            render.assert_not_called()
        self.raw += b'\nA changed public PDF'
        new_digest = hashlib.sha256(self.raw).hexdigest()
        with patch.object(crawler.subprocess, 'run', side_effect=self.render) as render, patch.object(crawler, '_ocr_engine', self.engine):
            self.assertEqual(crawler.ocr_page(self.raw, 1), ['Recovered public text'])
        self.assertEqual(render.call_count, 1)
        self.assertTrue((self.cache / (new_digest + '-2-ocr.json')).exists())
        self.assertEqual(json.loads((self.cache / (self.digest + '-2-ocr.json')).read_text()), ['A second published page'])

    def test_atomic_seed_cannot_replace_a_result_created_by_another_process(self):
        key = self.digest + '-1'
        path = self.pack({key: ['Bootstrap extraction']})
        link = crawler.os.link
        def race(source, destination):
            destination.write_text('["Concurrent fresh extraction"]')
            link(source, destination)
        with patch.object(crawler.os, 'link', side_effect=race):
            self.assertEqual(crawler.seed_ocr_bootstrap(path), 0)
        self.assertEqual(json.loads((self.cache / (key + '-ocr.json')).read_text()), ['Concurrent fresh extraction'])
        self.assertEqual(list(self.cache.glob('*.tmp')), [])

    def test_invalid_pack_is_fully_rejected_before_any_cache_write(self):
        good = self.digest + '-1'
        for key, rows in [('../outside', ['Text']), (self.digest + '-0', ['Text']),
                          (self.digest + '-10001', ['Text']), (self.digest + '-2', ['Text', 5]),
                          (self.digest + '-2', []), (self.digest + '-2', ['x'] * 2001),
                          (self.digest + '-2', ['x' * 10001])]:
            path = self.pack({good: ['Valid first page'], key: rows})
            before = {p.name for p in self.cache.iterdir()}
            with patch.object(crawler.os, 'link') as link:
                with self.assertRaises(ValueError):
                    crawler.seed_ocr_bootstrap(path)
                link.assert_not_called()
            self.assertEqual({p.name for p in self.cache.iterdir()}, before)
            self.assertFalse((self.cache / (good + '-ocr.json')).exists())
        for metadata in [{'version': 2}, {'sourceSnapshot': 'invalid date'}]:
            with self.assertRaises(ValueError):
                crawler.seed_ocr_bootstrap(self.pack({good: ['Text']}, **metadata))

    def test_many_pages_share_one_document_input_and_cached_json_skips_rendering(self):
        engine = Mock(side_effect=self.engine)
        with patch.object(crawler.subprocess, 'run', side_effect=self.render) as render, patch.object(crawler, '_ocr_engine', engine):
            self.assertEqual(crawler.ocr_page(self.raw, 0), ['Recovered public text'])
            self.assertEqual(crawler.ocr_page(self.raw, 1), ['Recovered public text'])
            self.assertEqual(crawler.ocr_page(self.raw, 0), ['Recovered public text'])
        self.assertEqual(render.call_count, 2)
        self.assertEqual(engine.call_count, 2)
        self.assertEqual(self.inputs, [self.cache / (self.digest + '.pdf')] * 2)
        self.assertEqual(len(list(self.cache.glob('*.pdf'))), 1)
        self.assertEqual(list(self.cache.glob('*.png')), [])
        self.assertEqual(json.loads((self.cache / (self.digest + '-2-ocr.json')).read_text()), ['Recovered public text'])

    def test_eight_fetch_workers_coalesce_same_page_ocr_under_the_shared_lock(self):
        engine = Mock(side_effect=self.engine)
        with patch.object(crawler.subprocess, 'run', side_effect=self.render) as render, patch.object(crawler, '_ocr_engine', engine):
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda page: crawler.ocr_page(self.raw, page), [0, 0, 1, 1, 2, 2, 3, 3]))
        self.assertEqual(results, [['Recovered public text']] * 8)
        self.assertEqual(render.call_count, 4)
        self.assertEqual(engine.call_count, 4)
        self.assertEqual(len(set(self.inputs)), 1)
        self.assertEqual(list(self.cache.glob('*.png')), [])

    def test_render_timeout_and_inference_failure_always_remove_transient_images(self):
        def timeout(args, **kwargs):
            self.render(args, **kwargs)
            raise subprocess.TimeoutExpired('test-poppler', 90)
        for render, engine, expected in [
            (timeout, self.engine, subprocess.TimeoutExpired),
            (self.render, Mock(side_effect=RuntimeError('test inference failure')), RuntimeError),
        ]:
            with patch.object(crawler.subprocess, 'run', side_effect=render), patch.object(crawler, '_ocr_engine', engine):
                with self.assertRaises(expected):
                    crawler.ocr_page(self.raw, 4)
            self.assertEqual(list(self.cache.glob('*.png')), [])
            self.assertFalse((self.cache / (self.digest + '-5-ocr.json')).exists())

    def test_legacy_cleanup_only_removes_known_completed_page_inputs(self):
        names = [self.digest + '-1.pdf', self.digest + '-1-render.png', self.digest + '.pdf',
                 self.digest + '-2.pdf', 'unrelated-public-document.pdf', 'notes.png']
        for name in names:
            (self.cache / name).write_bytes(b'cached input')
        (self.cache / (self.digest + '-1-ocr.json')).write_text('["Verified cached text"]')
        self.assertEqual(crawler.cleanup_legacy_ocr_inputs(), 2)
        self.assertFalse((self.cache / names[0]).exists())
        self.assertFalse((self.cache / names[1]).exists())
        for name in names[2:]:
            self.assertTrue((self.cache / name).exists(), name)
        self.assertEqual(json.loads((self.cache / (self.digest + '-1-ocr.json')).read_text()), ['Verified cached text'])


if __name__ == '__main__':
    try:
        unittest.main()
    finally:
        IMPORT_CACHE.cleanup()
