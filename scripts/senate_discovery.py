"""Enumerate public Senate pages without treating a discovery outage as deletion."""
import json
import re
import urllib.parse as up
import xml.etree.ElementTree as ET

SENATE = 'https://web.uri.edu/facsen/'
NS = '{http://www.sitemaps.org/schemas/sitemap/0.9}'


def page_url(value):
    if not isinstance(value, str):
        raise ValueError('Published page URL is not a string')
    parsed = up.urlsplit(value)
    if (parsed.scheme not in ('http', 'https') or parsed.netloc != 'web.uri.edu'
            or not parsed.path.startswith('/facsen/') or parsed.query or parsed.fragment
            or re.search(r'/wp-json/|/feed/|\.[a-zA-Z0-9]+$', parsed.path)):
        raise ValueError('Published page URL is outside the public Senate page scope')
    return up.urlunsplit(('https', parsed.netloc, parsed.path.rstrip('/') + '/', '', ''))


def rest_inventory(fetch):
    pages = {}
    for endpoint in ('pages', 'posts'):
        endpoint_pages = {}
        for n in range(1, 101):
            raw, _ = fetch(SENATE + 'wp-json/wp/v2/' + endpoint + '?per_page=100&page=' + str(n))
            entries = json.loads(raw)
            if not isinstance(entries, list) or len(entries) > 100:
                raise ValueError('WordPress collection is not a valid page array')
            for entry in entries:
                if not isinstance(entry, dict) or not isinstance(entry.get('title'), dict):
                    raise ValueError('WordPress page record has an invalid shape')
                title = entry['title'].get('rendered')
                if not isinstance(title, str):
                    raise ValueError('WordPress page title is missing')
                url = page_url(entry.get('link'))
                if url in endpoint_pages:
                    raise ValueError('WordPress pagination repeated a published page')
                endpoint_pages[url] = re.sub('<[^>]+>', '', title)
            if len(entries) < 100:
                break
        else:
            raise ValueError('WordPress pagination exceeded the discovery limit')
        if endpoint == 'pages' and (not endpoint_pages or SENATE not in endpoint_pages):
            raise ValueError('WordPress page collection is empty or omits the Senate homepage')
        pages.update(endpoint_pages)
    return pages


def xml_tree(raw, expected):
    if len(raw) > 5000000 or b'<!DOCTYPE' in raw.upper():
        raise ValueError('Sitemap exceeds the safe XML discovery limits')
    tree = ET.fromstring(raw)
    if tree.tag != NS + expected:
        raise ValueError('Unexpected sitemap XML root or namespace')
    return tree


def sitemap_inventory(fetch):
    raw, _ = fetch(SENATE + 'wp-sitemap.xml')
    index = xml_tree(raw, 'sitemapindex')
    maps = []
    for element in index.findall(NS + 'sitemap/' + NS + 'loc'):
        url = (element.text or '').strip()
        parsed = up.urlsplit(url)
        if re.fullmatch(r'/facsen/wp-sitemap-posts-(?:page|post)-[1-9][0-9]*\.xml', parsed.path):
            if parsed.scheme != 'https' or parsed.netloc != 'web.uri.edu' or parsed.query or parsed.fragment:
                raise ValueError('Public page sitemap has an unsafe location')
            maps.append(url)
    maps = sorted(set(maps))
    if not maps or len(maps) > 100 or not any('/wp-sitemap-posts-page-' in u for u in maps):
        raise ValueError('Sitemap index has no valid published page inventory')
    pages = {}
    for url in maps:
        raw, _ = fetch(url)
        tree = xml_tree(raw, 'urlset')
        locations = tree.findall(NS + 'url/' + NS + 'loc')
        if not locations or len(locations) > 10000:
            raise ValueError('Published page sitemap is empty or exceeds the discovery limit')
        for element in locations:
            page = page_url((element.text or '').strip())
            pages[page] = 'Faculty Senate'
    if SENATE not in pages:
        raise ValueError('Published page sitemap omits the Senate homepage')
    return pages


def discover(fetch, checked_at, previous=None):
    previous = previous or {}
    errors = []
    for method, lookup in (('wordpress-rest', rest_inventory), ('wordpress-sitemap', sitemap_inventory)):
        try:
            pages = lookup(fetch)
            return pages, {'complete': True, 'method': method, 'checkedAt': checked_at,
                           'lastCompleteAt': checked_at, 'errors': errors}, []
        except Exception as error:
            errors.append({'method': method, 'reason': str(error)[:180]})
    pages = {SENATE: 'Faculty Senate'}
    for value in previous.get('publishedPages', []):
        try:
            pages[page_url(value)] = 'Faculty Senate'
        except ValueError:
            continue
    last_complete = previous.get('discovery', {}).get('lastCompleteAt')
    if not previous.get('discovery'):
        last_complete = previous.get('builtAt')
    discovery = {'complete': False, 'method': 'navigation-and-previous-inventory',
                 'checkedAt': checked_at, 'lastCompleteAt': last_complete,
                 'retainedPageCount': len(pages), 'errors': errors}
    gap = {'url': SENATE, 'reason': 'Published page discovery incomplete; navigation and the previous published-page inventory were used. New pages outside navigation may be missing.'}
    return pages, discovery, [gap]
