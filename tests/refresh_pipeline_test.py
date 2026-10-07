import copy
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from refresh_sources import merge_sources, validate_index, build_release, promote, write_json, normalize_legacy_uri_urls, assemble

OLD = '2026-10-06T12:00:00+00:00'
NEW = '2026-10-07T12:00:00+00:00'


def source(url, stamp=OLD):
    return {'url': url, 'title': url, 'kind': 'Faculty Senate website', 'fetchedAt': stamp, 'notice': ''}


def index(*urls, stamp=OLD):
    return {'builtAt': stamp, 'sources': [source(u, stamp) for u in urls],
            'passages': [{'source': u, 'heading': u, 'text': 'Readable source content for ' + u} for u in urls]}


class RefreshTests(unittest.TestCase):
    def staged_inputs(self, root):
        (root / 'data').mkdir()
        base = 'https://gilded-toucan-d8a.notion.site/'
        pages = [{'url': base + ('3a57535bf92c80c78bacd5b49e9c6c12' if n == 0 else str(n) * 32),
                  'title': 'Toolkit page ' + str(n), 'kind': 'Curriculum Toolkit',
                  'lines': ['Guidance for page ' + str(n)], 'modified': None} for n in range(6)]
        home = 'https://web.uri.edu/facsen/'
        previous = index(*[p['url'] for p in pages], home)
        for s in previous['sources'][:-1]:
            s['kind'] = 'Curriculum Toolkit'
        write_json(root / 'data/index.json', previous)
        write_json(root / 'data/toolkit-pages.json', {'pages': pages})
        write_json(root / 'data/toolkit-media-text.json', {'items': []})
        coverage = {'toolkit': {'pages': 6, 'databaseEntries': 0, 'databases': {}, 'attachmentsAndImages': 0},
                    'website': {'gaps': [], 'trackers': []}}
        toolkit = {'pages': pages[:-1], 'assets': [], 'links': [], 'catalog': {}, 'issues': {}}
        senate = {'builtAt': NEW, 'publishedPages': [home], 'attemptedSources': 1, 'gaps': [], 'trackers': [],
                  'items': [{**source(home, NEW), 'lines': ['The next meeting agenda.'], 'ocrPages': []}]}
        return previous, coverage, toolkit, senate

    def test_total_source_outage_never_replaces_the_published_generation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            previous, coverage, toolkit, senate = self.staged_inputs(root)
            with self.assertRaisesRegex(ValueError, 'Neither authoritative source'):
                assemble(root, None, None, NEW, coverage)
            self.assertEqual(json.loads((root / 'data/index.json').read_text()), previous)

    def test_confirmed_removed_toolkit_page_is_excluded_and_recorded_as_gap(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            previous, coverage, toolkit, senate = self.staged_inputs(root)
            retired = previous['sources'][-2]['url']
            assemble(root, toolkit, senate, NEW, coverage)
            updated = json.loads((root / 'data/index.json').read_text())
            self.assertNotIn(retired, [s['url'] for s in updated['sources']])
            current_coverage = json.loads((root / 'data/coverage.json').read_text())
            self.assertTrue(any(g['url'] == retired and 'Removed toolkit page' in g['reason'] for g in current_coverage['failures']))

    def stage_image(self, root, previous, url, stamp=OLD):
        prior = source(url, OLD)
        prior['kind'] = 'Faculty Senate website image'
        previous['sources'].append(prior)
        previous['passages'].append({'source': url, 'heading': 'FAQ image', 'text': 'Previously readable image text.'})
        write_json(root / 'data/index.json', previous)
        return {'url': url, 'parent': 'https://web.uri.edu/facsen/', 'title': 'FAQ image',
                'kind': 'Faculty Senate website image', 'lines': ['Previously readable image text.'], 'fetchedAt': stamp}

    def test_failed_image_recheck_keeps_date_and_stale_notice_from_media_gaps(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            previous, coverage, toolkit, senate = self.staged_inputs(root)
            toolkit['pages'] = json.loads((root / 'data/toolkit-pages.json').read_text())['pages']
            url = 'https://web.uri.edu/facsen/files/faq.png'
            image = self.stage_image(root, previous, url)
            write_json(root / 'data/senate-media-text.json', {'items': [image], 'gaps': [{'url': url, 'reason': 'Image OCR unavailable'}], 'videos': []})
            with patch('merge_senate.ocr_spacing', side_effect=lambda line: line):
                assemble(root, toolkit, senate, NEW, coverage)
            result = json.loads((root / 'data/index.json').read_text())
            retained = next(s for s in result['sources'] if s['url'] == url)
            self.assertEqual(retained['fetchedAt'], OLD)
            self.assertEqual(retained['refreshStatus'], 'unavailable')
            self.assertIn('last readable snapshot', retained['notice'])
            self.assertEqual(retained['lastRefreshAttemptAt'], NEW)

    def test_whole_image_pass_failure_qualifies_prior_extraction_but_not_fresh_images(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            previous, coverage, toolkit, senate = self.staged_inputs(root)
            toolkit['pages'] = json.loads((root / 'data/toolkit-pages.json').read_text())['pages']
            old_url = 'https://web.uri.edu/facsen/files/faq.png'
            fresh_url = 'https://web.uri.edu/facsen/files/workflow.png'
            old_image = self.stage_image(root, previous, old_url)
            fresh_image = self.stage_image(root, previous, fresh_url, NEW)
            write_json(root / 'data/senate-media-text.json', {'items': [old_image, fresh_image], 'gaps': [], 'videos': []})
            senate['gaps'].append({'url': 'https://web.uri.edu/facsen/', 'reason': 'Website image refresh incomplete; previous image extraction dates were retained.'})
            with patch('merge_senate.ocr_spacing', side_effect=lambda line: line):
                assemble(root, toolkit, senate, NEW, coverage)
            result = json.loads((root / 'data/index.json').read_text())
            retained = next(s for s in result['sources'] if s['url'] == old_url)
            fresh = next(s for s in result['sources'] if s['url'] == fresh_url)
            self.assertEqual(retained['fetchedAt'], OLD)
            self.assertEqual(retained['refreshStatus'], 'unavailable')
            self.assertIn('last readable snapshot', retained['notice'])
            self.assertEqual(fresh['fetchedAt'], NEW)
            self.assertNotIn('refreshStatus', fresh)
            self.assertNotIn('last readable snapshot', fresh['notice'])
            current_coverage = json.loads((root / 'data/coverage.json').read_text())
            self.assertEqual(current_coverage['refresh']['status'], 'partial')
            self.assertTrue(any(g['url'] == old_url for g in current_coverage['website']['gaps']))
            self.assertFalse(any(g['url'] == fresh_url for g in current_coverage['website']['gaps']))

    def test_legacy_public_uri_http_reference_is_upgraded_without_redating(self):
        original = index('http://web.uri.edu/honors')
        upgraded = normalize_legacy_uri_urls(original)
        self.assertEqual(upgraded['sources'][0]['url'], 'https://web.uri.edu/honors/')
        self.assertEqual(upgraded['sources'][0]['fetchedAt'], OLD)
        self.assertEqual(upgraded['passages'][0]['source'], upgraded['sources'][0]['url'])
        validate_index(upgraded)

    def test_failed_fetch_keeps_old_text_and_date_but_labels_it_stale(self):
        a, b = 'https://web.uri.edu/facsen/', 'https://docs.google.com/spreadsheets/d/track/edit'
        old, fresh = index(a, b), index(a, stamp=NEW)
        result = merge_sources(old, fresh, NEW, [{'url': b, 'reason': 'Access restricted'}])
        retained = next(s for s in result['sources'] if s['url'] == b)
        self.assertEqual(retained['fetchedAt'], OLD)
        self.assertEqual(retained['refreshStatus'], 'unavailable')
        self.assertEqual(retained['lastRefreshAttemptAt'], NEW)
        self.assertIn('last readable snapshot', retained['notice'])
        self.assertEqual(next(p for p in result['passages'] if p['source'] == b), old['passages'][1])
        self.assertEqual(next(s for s in result['sources'] if s['url'] == a)['fetchedAt'], NEW)
        validate_index(result, old)

    def test_successful_refresh_replaces_old_text_and_clears_stale_state(self):
        url = 'https://web.uri.edu/facsen/meeting/'
        old = merge_sources(index(url), {'sources': [], 'passages': []}, NEW, [{'url': url}])
        fresh = index(url, stamp=NEW)
        fresh['passages'][0]['text'] = 'The newly posted meeting agenda.'
        result = merge_sources(old, fresh, NEW)
        self.assertEqual(len(result['passages']), 1)
        self.assertEqual(result['passages'][0]['text'], 'The newly posted meeting agenda.')
        self.assertNotIn('refreshStatus', result['sources'][0])

    def test_incomplete_provenance_or_large_content_loss_prevents_promotion(self):
        old = index('https://web.uri.edu/facsen/one/', 'https://web.uri.edu/facsen/two/')
        broken = copy.deepcopy(old)
        broken['passages'][0]['source'] = 'https://unknown.example/'
        with self.assertRaisesRegex(ValueError, 'provenance'):
            validate_index(broken, old)
        with self.assertRaisesRegex(ValueError, 'loss'):
            validate_index(index('https://web.uri.edu/facsen/one/'), old)
        broken = index('http://web.uri.edu/facsen/')
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            validate_index(broken)

    def generation(self, root):
        data = root / 'data'
        data.mkdir()
        corpus = {'builtAt': NEW, 'sourceCount': 1, 'passageCount': 1, 'corpusBase': 'data/corpus-123456abcdef'}
        bills = {'builtAt': NEW, 'corpusBase': corpus['corpusBase'], 'path': 'data/bills-123456abcdef.json', 'recordCount': 1}
        directory = root / corpus['corpusBase']
        directory.mkdir()
        write_json(data / 'corpus-manifest.json', corpus)
        write_json(data / 'bills-manifest.json', bills)
        write_json(root / bills['path'], {'builtAt': NEW, 'corpusBase': corpus['corpusBase'], 'records': [[0, 'Heading', 0]]})
        write_json(directory / 'routing.json', {'builtAt': NEW, 'corpusBase': corpus['corpusBase'], 'sources': [{}], 'docs': [[0, 'Heading', 2, '']], 'shardSize': 100})
        (directory / 'postings.bin').write_bytes(b'\x01\x00\x00\x00')
        write_json(directory / 'text-0.json', ['A newly posted agenda'])
        return corpus, bills

    def test_mixed_manifest_or_missing_text_shard_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            corpus, bills = self.generation(root)
            result = build_release(root, NEW, {'status': 'complete'})
            self.assertEqual(result['checkedAt'], NEW)
            self.assertEqual(result['corpus']['builtAt'], result['bills']['builtAt'])
            bills['builtAt'] = OLD
            write_json(root / 'data/bills-manifest.json', bills)
            with self.assertRaisesRegex(ValueError, 'differ'):
                build_release(root, NEW, {})
            bills['builtAt'] = NEW
            write_json(root / 'data/bills-manifest.json', bills)
            write_json(root / corpus['corpusBase'] / 'text-0.json', [])
            with self.assertRaisesRegex(ValueError, 'shard'):
                build_release(root, NEW, {})

    def test_publication_installs_complete_immutable_objects_before_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            stage, target = pathlib.Path(temporary) / 'stage', pathlib.Path(temporary) / 'public'
            stage.mkdir()
            target.mkdir()
            (target / 'data').mkdir()
            corpus, bills = self.generation(stage)
            release = build_release(stage, NEW, {'status': 'complete'})
            promote(stage, target, release)
            published = json.loads((target / 'data/source-release.json').read_text())
            self.assertEqual(published, release)
            self.assertTrue((target / corpus['corpusBase'] / 'text-0.json').exists())
            self.assertTrue((target / bills['path']).exists())

    def test_invalid_posting_and_bill_passage_never_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            corpus, bills = self.generation(root)
            posting = root / corpus['corpusBase'] / 'postings.bin'
            posting.write_bytes(b'\x01\x00\x01\x00')
            with self.assertRaisesRegex(ValueError, 'outside corpus'):
                build_release(root, NEW, {})
            posting.write_bytes(b'\x01\x00\x00\x00')
            bill_data = json.loads((root / bills['path']).read_text())
            bill_data['records'][0][2] = 1
            write_json(root / bills['path'], bill_data)
            with self.assertRaisesRegex(ValueError, 'outside corpus'):
                build_release(root, NEW, {})


if __name__ == '__main__':
    unittest.main()
