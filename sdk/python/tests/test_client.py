import asyncio
import base64
import hashlib
import hmac
import json
import threading
import time
import unittest
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from delivrie import AsyncDelivrie, Delivrie, DelivrieError, WebhookVerificationError, __version__, verify_webhook


class Server:
    """A local HTTP server that records requests and replies from a queue of (status, body) responses."""

    def __init__(self):
        self.requests = []
        self.responses = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _handle(self):
                n = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(n) if n else b""
                outer.requests.append({"method": self.command, "path": self.path, "headers": dict(self.headers), "body": json.loads(raw) if raw else None})
                status, body, headers = outer.responses.pop(0) if outer.responses else (200, {"ok": True}, {})
                data = json.dumps(body).encode() if not isinstance(body, bytes) else body
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = do_PATCH = do_DELETE = _handle

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}/api"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.s = Server()
        self.c = Delivrie("dlv_test", base_url=self.s.url, max_retries=2)

    def tearDown(self):
        self.s.close()

    def test_send_with_kwargs(self):
        self.s.responses.append((200, {"id": "e_1"}, {}))
        r = self.c.emails.send(
            from_="Acme <hi@acme.com>", to="ada@example.com", subject="Hi", html="<p>Hi</p>",
            scheduled_at=datetime(2026, 12, 1, 9, 0, tzinfo=timezone.utc),
            attachments=[{"filename": "a.txt", "content": b"hello"}], tags={"kind": "welcome"},
            idempotency_key="welcome-1",
        )
        self.assertEqual(r, {"id": "e_1"})
        req = self.s.requests[0]
        self.assertEqual(req["method"], "POST")
        self.assertEqual(req["path"], "/api/emails")
        self.assertEqual(req["headers"]["Authorization"], "Bearer dlv_test")
        self.assertEqual(req["headers"]["Idempotency-Key"], "welcome-1")
        self.assertEqual(req["headers"]["User-Agent"], f"delivrie-python/{__version__}")
        b = req["body"]
        self.assertEqual(b["from"], "Acme <hi@acme.com>")
        self.assertNotIn("from_", b)
        self.assertEqual(b["scheduled_at"], "2026-12-01T09:00:00Z")
        self.assertEqual(b["attachments"][0]["content"], base64.b64encode(b"hello").decode())
        self.assertEqual(b["tags"], [{"name": "kind", "value": "welcome"}])

    def test_send_with_dict(self):
        self.c.emails.send({"from": "a@acme.com", "to": ["b@x.com"], "subject": "s", "text": "t"})
        self.assertEqual(self.s.requests[0]["body"]["from"], "a@acme.com")

    def test_error_raises(self):
        self.s.responses.append((422, {"statusCode": 422, "name": "validation_error", "message": "Missing subject field"}, {}))
        with self.assertRaises(DelivrieError) as cm:
            self.c.emails.send(from_="a@acme.com", to="b@x.com", text="t")
        e = cm.exception
        self.assertEqual((e.status_code, e.name, e.message), (422, "validation_error", "Missing subject field"))
        self.assertIn("validation_error", str(e))
        self.assertEqual(len(self.s.requests), 1)

    def test_post_without_key_is_not_retried(self):
        self.s.responses.append((500, {"name": "application_error", "message": "boom"}, {}))
        with self.assertRaises(DelivrieError):
            self.c.emails.send(from_="a@acme.com", to="b@x.com", subject="s", text="t")
        self.assertEqual(len(self.s.requests), 1)

    def test_post_with_key_is_retried(self):
        self.s.responses += [(500, {"name": "application_error", "message": "boom"}, {"Retry-After": "0.01"}), (200, {"id": "e_2"}, {})]
        r = self.c.emails.send(from_="a@acme.com", to="b@x.com", subject="s", text="t", idempotency_key="k")
        self.assertEqual(r["id"], "e_2")
        self.assertEqual(len(self.s.requests), 2)
        self.assertEqual(self.s.requests[1]["headers"]["Idempotency-Key"], "k")

    def test_get_is_retried_on_rate_limit(self):
        self.s.responses += [(429, {"name": "rate_limit_exceeded", "message": "slow down"}, {"Retry-After": "0.01"}), (200, {"object": "list", "data": []}, {})]
        self.assertEqual(self.c.domains.list()["data"], [])
        self.assertEqual(len(self.s.requests), 2)

    def test_quota_429_is_not_retried(self):
        self.s.responses.append((429, {"name": "daily_quota_exceeded", "message": "Free plan: 133 emails today"}, {}))
        with self.assertRaises(DelivrieError) as cm:
            self.c.usage.get()
        self.assertEqual(cm.exception.name, "daily_quota_exceeded")
        self.assertEqual(len(self.s.requests), 1)

    def test_paths_and_queries(self):
        self.c.emails.list(limit=5, after=None)
        self.c.contacts.get("ada+1@example.com")
        self.c.metrics.get(days=7)
        self.c.events.send("user.created", email="ada@example.com", data={"plan": "pro"})
        self.c.segments.add_contacts("s_1", ["a@x.com", {"email": "b@x.com", "first_name": "B"}])
        self.c.suppressions.add(["a@x.com", "b@x.com"])
        self.c.inbox.threads.reply("th_1", text="Thanks")
        self.c.broadcasts.send("b_1", scheduled_at="in 1 hour")
        p = [(r["method"], r["path"]) for r in self.s.requests]
        self.assertEqual(p[0], ("GET", "/api/emails?limit=5"))
        self.assertEqual(p[1], ("GET", "/api/contacts/ada%2B1%40example.com"))
        self.assertEqual(p[2], ("GET", "/api/metrics?days=7"))
        self.assertEqual(self.s.requests[3]["body"], {"event": "user.created", "email": "ada@example.com", "data": {"plan": "pro"}})
        self.assertEqual(self.s.requests[4]["body"], {"contacts": [{"email": "a@x.com"}, {"email": "b@x.com", "first_name": "B"}]})
        self.assertEqual(self.s.requests[5]["body"], {"emails": ["a@x.com", "b@x.com"]})
        self.assertEqual(p[6], ("POST", "/api/inbox/threads/th_1/reply"))
        self.assertEqual(self.s.requests[7]["body"], {"scheduled_at": "in 1 hour"})

    def test_new_endpoints(self):
        c = self.c
        c.broadcasts.duplicate("b1", name="Copy")
        c.broadcasts.links("b1")
        c.broadcasts.recipients("b1", status="bounced")
        c.templates.edit_content("welcome", ops=[{"op": "delete", "id": "x"}], summary="s")
        c.api_keys.update("k1", name="Prod")
        c.emails.received_attachments("e1")
        c.emails.share("e1", expires_in_hours=48)
        c.segments.remove_contacts("s1", ["a@b.com"])
        c.contacts.import_contacts(csv="email\na@b.com", segment_ids=["s1"])
        c.automations.duplicate("a1")
        c.webhooks.remove("w1")
        c.inboxes.list()
        c.inbox.drafts.send("dr1")
        c.ai.draft(url="https://acme.com", target={"type": "template", "id": "welcome"})
        got = [f'{r["method"]} {r["path"][4:]}' for r in self.s.requests]
        self.assertEqual(got, [
            "POST /broadcasts/b1/duplicate", "GET /broadcasts/b1/links", "GET /broadcasts/b1/recipients?status=bounced",
            "POST /templates/welcome/content", "PATCH /api-keys/k1", "GET /emails/received/e1/attachments", "POST /emails/e1/share",
            "DELETE /segments/s1/contacts", "POST /contacts/imports", "POST /automations/a1/duplicate", "DELETE /webhooks/w1",
            "GET /inboxes", "POST /inbox/drafts/dr1/send", "POST /ai/draft",
        ])
        self.assertEqual(self.s.requests[7]["body"], {"contacts": ["a@b.com"]})
        self.assertEqual(self.s.requests[8]["body"], {"csv": "email\na@b.com", "segment_ids": ["s1"]})
        self.assertEqual(self.s.requests[6]["body"], {"expires_in_hours": 48})

    def test_network_error(self):
        c = Delivrie("dlv_test", base_url="http://127.0.0.1:9/api", max_retries=0, timeout=2)
        with self.assertRaises(DelivrieError) as cm:
            c.usage.get()
        self.assertEqual(cm.exception.status_code, 0)
        self.assertIn(cm.exception.name, ("network_error", "timeout"))

    def test_missing_key(self):
        import os
        old = os.environ.pop("DELIVRIE_API_KEY", None)
        try:
            with self.assertRaises(ValueError):
                Delivrie()
        finally:
            if old is not None:
                os.environ["DELIVRIE_API_KEY"] = old

    def test_async(self):
        self.s.responses.append((200, {"id": "e_3"}, {}))
        c = AsyncDelivrie("dlv_test", base_url=self.s.url)
        r = asyncio.run(c.emails.send(from_="a@acme.com", to="b@x.com", subject="s", text="t"))
        self.assertEqual(r["id"], "e_3")
        r2 = asyncio.run(c.inbox.threads.list(limit=1))
        self.assertEqual(r2, {"ok": True})


class WebhookTests(unittest.TestCase):
    secret = "whsec_" + base64.b64encode(b"0123456789abcdef0123456789abcdef").decode()

    def sign(self, body, msg_id="msg_1", ts=None):
        ts = ts or int(time.time())
        key = base64.b64decode(self.secret[6:])
        sig = base64.b64encode(hmac.new(key, f"{msg_id}.{ts}.{body}".encode(), hashlib.sha256).digest()).decode()
        return {"webhook-id": msg_id, "webhook-timestamp": str(ts), "webhook-signature": f"v1,{sig}"}

    def test_valid(self):
        body = json.dumps({"type": "email.delivered", "data": {"email_id": "e_1"}})
        ev = verify_webhook(body.encode(), self.sign(body), self.secret)
        self.assertEqual(ev["type"], "email.delivered")

    def test_case_insensitive_headers_and_rotation(self):
        body = '{"type":"email.bounced"}'
        h = {k.title(): v for k, v in self.sign(body).items()}
        h["Webhook-Signature"] = "v1,AAAA " + h["Webhook-Signature"]
        self.assertEqual(verify_webhook(body, h, self.secret)["type"], "email.bounced")

    def test_tampered(self):
        body = '{"type":"email.delivered"}'
        with self.assertRaises(WebhookVerificationError):
            verify_webhook(body.replace("delivered", "bounced"), self.sign(body), self.secret)

    def test_old(self):
        body = "{}"
        with self.assertRaises(WebhookVerificationError):
            verify_webhook(body, self.sign(body, ts=int(time.time()) - 3600), self.secret)

    def test_missing_headers(self):
        with self.assertRaises(WebhookVerificationError):
            verify_webhook("{}", {}, self.secret)


if __name__ == "__main__":
    unittest.main()
