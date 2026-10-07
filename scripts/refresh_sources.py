"""Refresh public sources in staging; promote only a complete validated generation.

Failed source fetches keep their last readable content and original extraction
date with an explicit stale notice. Raw downloads never enter the public repo.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.parse as up

ROOT = pathlib.Path(__file__).resolve().parents[1]
STALE = 'Refresh could not verify this source. This is the last readable snapshot'


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2))


def normalize_legacy_uri_urls(data):
    """Upgrade the existing public URI HTTP reference without accepting new HTTP sources."""
    def canonical(url):
        parsed = up.urlsplit(url)
        if parsed.scheme == 'http' and parsed.netloc == 'web.uri.edu':
            path = parsed.path
            if '.' not in path.rsplit('/', 1)[-1] and not path.endswith('/'):
                path += '/'
            return up.urlunsplit(('https', parsed.netloc, path, parsed.query, parsed.fragment))
        return url
    registry = {canonical(s['url']): {**s, 'url': canonical(s['url'])} for s in data['sources']}
    return {**data, 'sources': list(registry.values()),
            'passages': [{**p, 'source': canonical(p['source'])} for p in data['passages']]}


def merge_sources(old, fresh, checked_at, gaps=()):
    """Replace successful sources atomically; never relabel retained text as fresh."""
    registry = {s['url']: dict(s) for s in old['sources']}
    updated = {s['url']: dict(s) for s in fresh['sources']}
    missing = set(registry) - set(updated)
    gap_urls = {g['url'] for g in gaps}
    for url in missing:
        source = registry[url]
        if url in gap_urls:
            original_notice = source.get('notice', '').split(STALE)[0].rstrip()
            source['notice'] = (original_notice + ' ' + STALE + ' from ' + source.get('fetchedAt', 'an earlier date') + '.').strip()
            source['lastRefreshAttemptAt'] = checked_at
            source['refreshStatus'] = 'unavailable'
    registry.update(updated)
    passages = [p for p in old['passages'] if p['source'] not in updated]
    passages.extend(fresh['passages'])
    return {'builtAt': checked_at, 'sources': list(registry.values()), 'passages': passages}


def validate_index(data, previous=None):
    urls = [s['url'] for s in data['sources']]
    if not urls or len(set(urls)) != len(urls):
        raise ValueError('Source registry is empty or duplicated')
    registry = set(urls)
    seen = set()
    for passage in data['passages']:
        if passage['source'] not in registry or not passage['text'].strip():
            raise ValueError('Empty passage or unresolved provenance')
        seen.add(passage['source'])
    if registry != seen:
        raise ValueError('A source has no readable passages')
    if previous and len(data['passages']) < len(previous['passages']) * .8:
        raise ValueError('Unexpected loss of readable content; retaining published generation')
    if len(data['passages']) >= 65536:
        raise ValueError('Corpus exceeds posting identifier capacity')
    for source in data['sources']:
        url = up.urlsplit(source['url'])
        if url.scheme != 'https' or not url.netloc or url.username or url.password:
            raise ValueError('Unsafe public source URL')
        dt.datetime.fromisoformat(source['fetchedAt'].replace('Z', '+00:00'))


def build_release(root, checked_at, refresh):
    corpus = read_json(root / 'data/corpus-manifest.json')
    bills = read_json(root / 'data/bills-manifest.json')
    bill_data = read_json(root / bills['path'])
    routing = read_json(root / corpus['corpusBase'] / 'routing.json')
    if (corpus['builtAt'] != bills['builtAt'] or corpus['builtAt'] != routing['builtAt']
            or corpus['builtAt'] != bill_data['builtAt']
            or corpus['corpusBase'] != routing['corpusBase']
            or corpus['corpusBase'] != bills['corpusBase'] or bills['corpusBase'] != bill_data['corpusBase']):
        raise ValueError('Corpus and bill generation differ')
    if len(routing['sources']) != corpus['sourceCount'] or len(routing['docs']) != corpus['passageCount']:
        raise ValueError('Corpus counts differ from routing')
    if len(bill_data['records']) != bills['recordCount']:
        raise ValueError('Bill record count differs from manifest')
    for record in bill_data['records']:
        if not (0 <= record[2] < corpus['passageCount']):
            raise ValueError('Bill record points outside corpus')
    postings = (root / corpus['corpusBase'] / 'postings.bin').read_bytes()
    if not postings or len(postings) % 4:
        raise ValueError('Posting file is missing or truncated')
    if any((p[0] >> 16) >= corpus['passageCount'] for p in struct.iter_unpack('<I', postings)):
        raise ValueError('Posting points outside corpus')
    for n in range((corpus['passageCount'] + routing['shardSize'] - 1) // routing['shardSize']):
        texts = read_json(root / corpus['corpusBase'] / ('text-' + str(n) + '.json'))
        expected = min(routing['shardSize'], corpus['passageCount'] - n * routing['shardSize'])
        if len(texts) != expected or any(not isinstance(t, str) or not t.strip() for t in texts):
            raise ValueError('Missing or malformed text shard')
    return {'version': 1, 'corpus': corpus, 'bills': bills, 'checkedAt': checked_at, 'refresh': refresh}


def run(script, stage, env, timeout=10800):
    return subprocess.run([sys.executable, str(stage / 'scripts' / script)], cwd=stage,
                          env=env, timeout=timeout, check=True)


def assemble(stage, toolkit, senate, checked_at, initial_coverage):
    """Use fresh successful reads only; reviewed media retain their extraction dates."""
    sys.path.insert(0, str(stage / 'scripts'))
    import build_index as core
    import merge_senate
    core.ROOT = stage
    core.STAMP = checked_at
    core.sources.clear()
    core.passages.clear()
    failures = []
    toolkit_ready = bool(toolkit and any(p['url'].endswith(core.TOOLKIT.replace('-', '')) for p in toolkit['pages']))
    toolkit_ready = toolkit_ready and not toolkit.get('issues')
    old_pages = read_json(stage / 'data/toolkit-pages.json')
    if toolkit_ready and len(toolkit['pages']) < len(old_pages['pages']) * .8:
        toolkit_ready = False
    toolkit_meta = initial_coverage['toolkit']
    if toolkit_ready:
        current_page_urls = {page['url'] for page in toolkit['pages']}
        failures.extend({'url': page['url'], 'reason': 'Removed toolkit page: no longer reachable from the complete public toolkit.'}
                        for page in old_pages['pages'] if page['url'] not in current_page_urls)
        for page in toolkit['pages']:
            core.add_source(page['url'], page['title'], page['kind'], [page['title']] + page['lines'], page['modified'])
        toolkit_meta = {'pages': sum(p['kind'] == 'Curriculum Toolkit' for p in toolkit['pages']),
                        'databaseEntries': sum(p['kind'].endswith('database item') for p in toolkit['pages']),
                        'databases': {c['title']: len(c['rows']) for c in toolkit['catalog'].values()},
                        'attachmentsAndImages': initial_coverage['toolkit'].get('attachmentsAndImages', 0),
                        'unresolvedBlocks': len(toolkit['issues'])}
        write_json(stage / 'data/toolkit-pages.json', {'builtAt': checked_at, 'pages': toolkit['pages'], 'databases': toolkit_meta['databases']})
        assets = {a['id']: a for a in toolkit['assets'] if a['type'] in ('file', 'image')}
        reviewed = read_json(stage / 'data/toolkit-media-text.json')
        current_reviewed_count = 0
        for item in reviewed['items']:
            current = assets.pop(item['id'], None)
            if not current:
                failures.append({'url': item['url'], 'reason': 'Removed toolkit attachment: no longer referenced by the complete public toolkit.'})
            elif current.get('source') != item.get('resourceSource'):
                failures.append({'url': item['url'], 'reason': 'Changed toolkit attachment requires a new reviewed transcription.'})
            else:
                current_reviewed_count += 1
        toolkit_meta['attachmentsAndImages'] = current_reviewed_count
        failures.extend({'url': core.NOTION + '/' + a['page'].replace('-', ''),
                         'reason': 'New attachment requires text extraction or a reviewed transcription: ' + a['title']}
                        for a in assets.values())
    else:
        failures.append({'url': core.NOTION + '/' + core.TOOLKIT.replace('-', ''),
                         'reason': 'Public toolkit refresh was incomplete; retaining the previous readable toolkit snapshot.'})
    senate_ready = bool(senate and any(item['url'] == core.SENATE for item in senate['items']))
    website = initial_coverage.get('website', {})
    if senate_ready:
        website = merge_senate.apply_snapshot(senate, core)
    else:
        failures.append({'url': core.SENATE, 'reason': 'Faculty Senate refresh was unavailable; retaining the previous readable snapshot.'})
    if not toolkit_ready and not senate_ready:
        raise ValueError('Neither authoritative source could be refreshed; published generation was retained')
    previous = normalize_legacy_uri_urls(read_json(stage / 'data/index.json'))
    fresh = {'sources': list(core.sources.values()), 'passages': list(core.passages)}
    gaps = failures + (senate.get('gaps', []) if senate else [])
    # A whole-source outage marks each retained source in that scope, not just its home page.
    if not toolkit_ready:
        gaps.extend({'url': s['url']} for s in previous['sources'] if 'Curriculum Toolkit' in s.get('kind', ''))
    if not senate_ready:
        gaps.extend({'url': s['url']} for s in previous['sources'] if s.get('kind', '').startswith('Faculty Senate'))
    merged = merge_sources(previous, fresh, checked_at, gaps)
    retired = {g['url'] for g in failures if g['reason'].startswith(('Changed toolkit attachment', 'Removed toolkit'))}
    if retired:
        merged['sources'] = [s for s in merged['sources'] if s['url'] not in retired]
        merged['passages'] = [p for p in merged['passages'] if p['source'] not in retired]
    validate_index(merged, previous)
    refreshed = sum(s['fetchedAt'] >= checked_at for s in fresh['sources'])
    retained = len(merged['sources']) - refreshed
    refresh = {'status': 'complete' if toolkit_ready and senate_ready and not failures else 'partial',
               'cadence': 'daily', 'scheduleUtc': '10:17', 'freshSources': refreshed,
               'retainedSources': retained, 'gapCount': len(failures) + len(website.get('gaps', [])),
               'toolkitChecked': toolkit_ready, 'websiteChecked': senate_ready,
               'trackerCount': len(website.get('trackers', []))}
    coverage = {**initial_coverage, 'builtAt': checked_at, 'sourceCount': len(merged['sources']),
                'passageCount': len(merged['passages']), 'toolkit': toolkit_meta,
                'website': website, 'failures': failures, 'refresh': refresh}
    coverage['limitations'] = [
        'Public toolkit, Faculty Senate website and readable public trackers are checked daily. Meeting questions also receive a live website check.',
        'Each source retains its own fetchedAt extraction date. Failed refreshes retain last readable content with a stale notice.',
        'Reviewed toolkit image transcriptions retain their original dates. New or replaced attachments are recorded as gaps until reviewed.',
        'Restricted, broken and unreadable sources are listed as gaps. Their contents are unavailable.',
        'OCR can omit or misread graphical content, dates, numbers, tables and signatures. Verify them in the original.',
        'Trackers record proposal status at extraction time; they are not live Kuali status or approval guarantees.'
    ]
    write_json(stage / 'data/index.json', merged)
    write_json(stage / 'data/coverage.json', coverage)
    return refresh


def promote(stage, target, release):
    """Move immutable objects first and publish the single release pointer last."""
    corpus = release['corpus']['corpusBase']
    if not (target / corpus).exists():
        shutil.copytree(stage / corpus, target / corpus)
    bill = release['bills']['path']
    shutil.copy2(stage / bill, target / bill)
    for path in (stage / 'data').glob('*.json'):
        if path.name.startswith('bills-') or path.name == 'source-release.json':
            continue
        tmp = target / 'data' / (path.name + '.next')
        shutil.copy2(path, tmp)
        tmp.replace(target / 'data' / path.name)
    pointer = target / 'data/source-release.json.next'
    write_json(pointer, release)
    pointer.replace(target / 'data/source-release.json')
    # Keep the original Worker bootstrap plus four recent generations. Old pages
    # retain a short grace period without letting a daily refresh grow Pages forever.
    generations = []
    for directory in (target / 'data').glob('corpus-*'):
        if directory.is_dir() and (directory / 'routing.json').exists():
            generations.append((read_json(directory / 'routing.json')['builtAt'], directory))
    generations.sort(reverse=True)
    for _, directory in generations[4:]:
        if directory.name != 'corpus-14e032937a2a':
            shutil.rmtree(directory)
    bill_files = sorted((target / 'data').glob('bills-*.json'), key=lambda p: read_json(p).get('builtAt', ''), reverse=True)
    for path in bill_files[4:]:
        if path.name != 'bills-455371660268.json':
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true', help='Fetch and validate without changing the published repository data')
    parser.add_argument('--root', type=pathlib.Path, default=ROOT)
    args = parser.parse_args()
    root = args.root.resolve()
    checked_at = dt.datetime.now(dt.timezone.utc).isoformat()
    with tempfile.TemporaryDirectory(prefix='senate-refresh-') as directory:
        stage = pathlib.Path(directory)
        shutil.copytree(root / 'scripts', stage / 'scripts', ignore=shutil.ignore_patterns('__pycache__'))
        (stage / 'data').mkdir()
        for path in (root / 'data').glob('*.json'):
            shutil.copy2(path, stage / 'data' / path.name)
        for name in ('search.js', 'conversation.js', 'bills.js'):
            shutil.copy2(root / name, stage / name)
        cache = pathlib.Path(os.environ.get('SOURCE_CACHE') or stage / 'cache')
        env = {**os.environ, 'SOURCE_ROOT': str(stage), 'TOOLKIT_CACHE': str(cache / 'toolkit'),
               'TOOLKIT_REFRESH': '1', 'SENATE_CACHE': str(cache / 'senate'),
               'SENATE_REFRESH': '1', 'SENATE_OCR': '1'}
        os.environ['SOURCE_ROOT'] = str(stage)
        toolkit = None
        try:
            run('crawl_toolkit.py', stage, env, 2400)
            toolkit = read_json(cache / 'toolkit/content.json')
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            print('Toolkit refresh unavailable:', type(error).__name__, flush=True)
        linked = read_json(stage / 'data/toolkit-linked-text.json')
        seeds = [{'url': x['url'], 'title': x['title']} for x in linked['items']]
        previous_index = read_json(stage / 'data/index.json')
        # Recheck earlier official documents even if an archive/menu no longer links
        # them. A 404 retains dated, qualified last-good text; a still-public archive
        # can remain a legitimate historical source. Website images have their own OCR crawl.
        seeds.extend({'url': s['url'], 'title': s['title']} for s in previous_index['sources']
                     if s.get('kind', '').startswith('Faculty Senate')
                     and s.get('kind') != 'Faculty Senate website image')
        if toolkit:
            seeds.extend({'url': x['url'], 'title': 'Linked toolkit resource'} for x in toolkit['links'])
        seed_file = stage / 'source-seeds.json'
        write_json(seed_file, seeds)
        env['SOURCE_SEEDS'] = str(seed_file)
        senate = None
        try:
            # Delete the staged old result so a failed process cannot masquerade as a fresh crawl.
            (stage / 'data/senate-text.json').unlink(missing_ok=True)
            run('crawl_senate.py', stage, env)
            senate = read_json(stage / 'data/senate-text.json')
            if any(item['url'] == 'https://web.uri.edu/facsen/' for item in senate['items']):
                # If image extraction fails, keep dated previous image text rather than erase it.
                try:
                    run('crawl_senate_media.py', stage, env, 1800)
                except (subprocess.SubprocessError, OSError, ValueError) as error:
                    senate['gaps'].append({'url': 'https://web.uri.edu/facsen/', 'reason': 'Website image refresh incomplete; previous image extraction dates were retained.'})
        except (subprocess.SubprocessError, OSError, ValueError) as error:
            print('Website refresh unavailable:', type(error).__name__, flush=True)
        refresh = assemble(stage, toolkit, senate, checked_at, read_json(root / 'data/coverage.json'))
        for script in ('prepare_corpus.mjs', 'prepare_bills.mjs'):
            subprocess.run(['node', str(stage / 'scripts' / script)], cwd=stage, check=True, timeout=300)
        release = build_release(stage, checked_at, refresh)
        if not args.dry_run:
            promote(stage, root, release)
        print(json.dumps({'dryRun': args.dry_run, 'release': release}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
