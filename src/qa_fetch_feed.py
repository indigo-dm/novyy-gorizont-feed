from __future__ import annotations

import io
import unittest
from unittest.mock import patch

from fetch_feed import download_feed


class FeedDownloadTests(unittest.TestCase):
    def download(self, *responses: bytes) -> bytes:
        with patch('fetch_feed.urlopen', side_effect=[io.BytesIO(body) for body in responses]), patch('fetch_feed.time.sleep'):
            return download_feed('https://source.example/feed.xml', len(responses), [0] * len(responses))

    def test_xml_without_declaration_is_accepted_unchanged(self):
        body = b'<Ads><Ad><Id>1</Id></Ad></Ads>'
        self.assertEqual(self.download(body), body)

    def test_utf8_bom_is_accepted_unchanged(self):
        body = b'\xef\xbb\xbf<Ads><Ad /></Ads>'
        self.assertEqual(self.download(body), body)

    def test_empty_successful_response_is_retried(self):
        body = b'<?xml version="1.0"?><Ads><Ad /></Ads>'
        self.assertEqual(self.download(b'', body), body)

    def test_html_response_is_rejected(self):
        with self.assertRaisesRegex(SystemExit, 'invalid feed XML after 2 attempts'):
            self.download(b'<html />', b'<html />')

    def test_repeated_empty_response_has_temporary_unavailable_code(self):
        with self.assertRaises(SystemExit) as caught:
            self.download(b'', b'')
        self.assertEqual(caught.exception.code, 75)

    def test_truncated_xml_is_rejected(self):
        with self.assertRaisesRegex(SystemExit, 'invalid feed XML'):
            self.download(b'<?xml version="1.0"?><Ads><Ad>')


if __name__ == '__main__':
    unittest.main()
