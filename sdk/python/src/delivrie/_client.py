"""The Delivrie client. Standard library only: works anywhere Python 3.10+ runs."""
from __future__ import annotations

import base64
import json
import os
import random
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional, Union

from ._errors import DelivrieError
from ._version import __version__

DEFAULT_BASE_URL = "https://delivrie.io/api"

JSON = Dict[str, Any]


def _q(value: str) -> str:
    return urllib.parse.quote(str(value), safe="")


def _iso(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    return value


def _prepare_email(params: Optional[Mapping[str, Any]], kwargs: Mapping[str, Any]) -> JSON:
    """Accepts a dict like the REST API, keyword arguments, or both. `from_` and Python types are converted."""
    out: JSON = dict(params or {})
    out.update(kwargs)
    if "from_" in out:
        out.setdefault("from", out.pop("from_"))
    if "scheduled_at" in out:
        out["scheduled_at"] = _iso(out["scheduled_at"])
    if out.get("attachments"):
        files = []
        for a in out["attachments"]:
            a = dict(a)
            content = a.get("content")
            if isinstance(content, (bytes, bytearray, memoryview)):
                a["content"] = base64.b64encode(bytes(content)).decode("ascii")
            files.append(a)
        out["attachments"] = files
    if isinstance(out.get("tags"), Mapping):
        out["tags"] = [{"name": k, "value": str(v)} for k, v in out["tags"].items()]
    return out


class Delivrie:
    """
    The Delivrie client.

        from delivrie import Delivrie

        client = Delivrie()  # reads DELIVRIE_API_KEY
        email = client.emails.send(
            from_="Acme <hello@mail.acme.com>",
            to="ada@example.com",
            subject="Welcome",
            html="<p>Thanks for signing up.</p>",
        )
        print(email["id"])

    Every method returns the API's JSON as a dict and raises DelivrieError when the API returns an error.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: Optional[str] = None,
        timeout: float = 30.0,
        max_retries: int = 2,
        headers: Optional[Mapping[str, str]] = None,
    ) -> None:
        key = api_key or os.environ.get("DELIVRIE_API_KEY")
        if not key:
            raise ValueError(
                "Missing API key. Pass it to Delivrie(api_key) or set DELIVRIE_API_KEY. "
                "Create one at https://delivrie.io/api-keys"
            )
        self._key = key
        self.base_url = (base_url or os.environ.get("DELIVRIE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout
        self.max_retries = max(0, int(max_retries))
        self._headers = dict(headers or {})

        self.emails = Emails(self)
        self.domains = Domains(self)
        self.api_keys = ApiKeys(self)
        self.webhooks = Webhooks(self)
        self.contacts = Contacts(self)
        self.segments = Segments(self)
        self.topics = Topics(self)
        self.contact_properties = ContactProperties(self)
        self.broadcasts = Broadcasts(self)
        self.templates = Templates(self)
        self.suppressions = Suppressions(self)
        self.events = Events(self)
        self.automations = Automations(self)
        self.inbox = Inbox(self)
        self.inboxes = Inboxes(self)
        self.ai = Ai(self)
        self.metrics = Metrics(self)
        self.logs = Logs(self)
        self.usage = Usage(self)

    def __repr__(self) -> str:
        return f"Delivrie(base_url={self.base_url!r})"

    # ------------------------------------------------------------------ transport

    def request(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        query: Optional[Mapping[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Any:
        """Low-level request for endpoints the SDK doesn't wrap yet. `path` is relative to the API base, e.g. "/emails"."""
        method = method.upper()
        url = self.base_url + path
        if query:
            pairs = [(k, _iso(v)) for k, v in query.items() if v is not None]
            pairs = [(k, ("true" if v else "false") if isinstance(v, bool) else v) for k, v in pairs]
            if pairs:
                url += ("&" if "?" in url else "?") + urllib.parse.urlencode(pairs)
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json",
            "User-Agent": f"delivrie-python/{__version__}",
            **self._headers,
        }
        data = None
        if body is not None:
            data = json.dumps(body, default=_iso).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        # GET and DELETE are safe to repeat; POST and PATCH only with an idempotency key, so a retry never sends twice.
        retryable = method in ("GET", "DELETE") or bool(idempotency_key)

        attempt = 0
        while True:
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as res:
                    return _parse(res.read())
            except urllib.error.HTTPError as e:
                raw = e.read()
                err = _to_error(e.code, raw)
                rate_limited = e.code == 429 and err.name == "rate_limit_exceeded"
                if (rate_limited or e.code >= 500) and retryable and attempt < self.max_retries:
                    time.sleep(_retry_after(e.headers.get("Retry-After"), attempt))
                    attempt += 1
                    continue
                raise err from None
            except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
                if retryable and attempt < self.max_retries:
                    time.sleep(_backoff(attempt))
                    attempt += 1
                    continue
                reason = getattr(e, "reason", e)
                timed_out = isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason)
                raise DelivrieError(
                    0,
                    "timeout" if timed_out else "network_error",
                    f"No response within {self.timeout:g} s" if timed_out else f"Network error: {reason}",
                ) from None


def _parse(raw: bytes) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except ValueError:
        return raw.decode("utf-8", "replace")


def _to_error(status: int, raw: bytes) -> DelivrieError:
    body = _parse(raw)
    j = body if isinstance(body, dict) else {}
    default = {401: "invalid_api_key", 404: "not_found", 429: "rate_limit_exceeded"}.get(status, "application_error")
    text = body if isinstance(body, str) else ""
    return DelivrieError(
        j.get("statusCode") if isinstance(j.get("statusCode"), int) else status,
        j.get("name") if isinstance(j.get("name"), str) else default,
        j.get("message") if isinstance(j.get("message"), str) else (text[:300] or f"Request failed with status {status}"),
        body=body,
    )


def _backoff(attempt: int) -> float:
    return min(8.0, 0.5 * 2 ** attempt) + random.random() * 0.25


def _retry_after(value: Optional[str], attempt: int) -> float:
    try:
        seconds = float(value) if value else 0
    except ValueError:
        seconds = 0
    return min(seconds, 30.0) if seconds > 0 else _backoff(attempt)


# ---------------------------------------------------------------------- resources


class _Resource:
    def __init__(self, client: Delivrie) -> None:
        self._c = client

    def _r(self, method: str, path: str, body: Any = None, **kw: Any) -> Any:
        return self._c.request(method, path, body, **kw)


class Emails(_Resource):
    def send(self, params: Optional[Mapping[str, Any]] = None, *, idempotency_key: Optional[str] = None, **kwargs: Any) -> JSON:
        """Send one email. Pass a dict like the REST API, or keyword arguments (use `from_` for the sender)."""
        return self._r("POST", "/emails", _prepare_email(params, kwargs), idempotency_key=idempotency_key)

    def batch(self, emails: Iterable[Mapping[str, Any]], *, idempotency_key: Optional[str] = None) -> JSON:
        """Send up to 100 emails in one request."""
        return self._r("POST", "/emails/batch", [_prepare_email(e, {}) for e in emails], idempotency_key=idempotency_key)

    def get(self, email_id: str) -> JSON:
        return self._r("GET", f"/emails/{_q(email_id)}")

    def list(self, **params: Any) -> JSON:
        return self._r("GET", "/emails", query=params)

    def list_received(self, **params: Any) -> JSON:
        return self._r("GET", "/emails/received", query=params)

    def update(self, email_id: str, *, scheduled_at: Union[str, datetime]) -> JSON:
        """Reschedule a scheduled email."""
        return self._r("PATCH", f"/emails/{_q(email_id)}", {"scheduled_at": _iso(scheduled_at)})

    def cancel(self, email_id: str) -> JSON:
        return self._r("POST", f"/emails/{_q(email_id)}/cancel")

    def forward(self, email_id: str, params: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> JSON:
        return self._r("POST", f"/emails/{_q(email_id)}/forward", _prepare_email(params, kwargs))

    def attachments(self, email_id: str) -> JSON:
        """A sent email's files with download links that work for an hour."""
        return self._r("GET", f"/emails/{_q(email_id)}/attachments")

    def received_attachments(self, email_id: str) -> JSON:
        """A received email's files with download links that work for an hour."""
        return self._r("GET", f"/emails/received/{_q(email_id)}/attachments")

    def share(self, email_id: str, *, expires_in_hours: Optional[int] = None) -> JSON:
        """A public link to the email and its delivery timeline (1 to 720 hours, default 24)."""
        return self._r("POST", f"/emails/{_q(email_id)}/share", {"expires_in_hours": expires_in_hours} if expires_in_hours else {})

    def unshare(self, email_id: str) -> JSON:
        """Revoke every share link for the email."""
        return self._r("DELETE", f"/emails/{_q(email_id)}/share")


class Domains(_Resource):
    def create(self, name: str, **params: Any) -> JSON:
        return self._r("POST", "/domains", {"name": name, **params})

    def get(self, domain_id: str) -> JSON:
        return self._r("GET", f"/domains/{_q(domain_id)}")

    def verify(self, domain_id: str) -> JSON:
        return self._r("POST", f"/domains/{_q(domain_id)}/verify")

    def update(self, domain_id: str, **params: Any) -> JSON:
        return self._r("PATCH", f"/domains/{_q(domain_id)}", params)

    def list(self) -> JSON:
        return self._r("GET", "/domains")

    def remove(self, domain_id: str) -> JSON:
        return self._r("DELETE", f"/domains/{_q(domain_id)}")


class ApiKeys(_Resource):
    def create(self, name: str, **params: Any) -> JSON:
        return self._r("POST", "/api-keys", {"name": name, **params})

    def list(self) -> JSON:
        return self._r("GET", "/api-keys")

    def update(self, key_id: str, *, name: str) -> JSON:
        """Rename a key."""
        return self._r("PATCH", f"/api-keys/{_q(key_id)}", {"name": name})

    def remove(self, key_id: str) -> JSON:
        return self._r("DELETE", f"/api-keys/{_q(key_id)}")


class Webhooks(_Resource):
    def create(self, endpoint: str, events: List[str], **params: Any) -> JSON:
        return self._r("POST", "/webhooks", {"endpoint": endpoint, "events": events, **params})

    def list(self) -> JSON:
        return self._r("GET", "/webhooks")

    def update(self, webhook_id: str, **params: Any) -> JSON:
        """Change the endpoint, events or status (enabled, disabled)."""
        return self._r("PATCH", f"/webhooks/{_q(webhook_id)}", params)

    def remove(self, webhook_id: str) -> JSON:
        return self._r("DELETE", f"/webhooks/{_q(webhook_id)}")

    def deliveries(self, webhook_id: str) -> JSON:
        return self._r("GET", f"/webhooks/{_q(webhook_id)}/events")

    def test(self, webhook_id: str) -> JSON:
        return self._r("POST", f"/webhooks/{_q(webhook_id)}/test")

    def replay(self, delivery_id: str) -> JSON:
        return self._r("POST", f"/webhook-deliveries/{_q(delivery_id)}/replay")

    @staticmethod
    def verify(payload: Union[str, bytes], headers: Mapping[str, Any], secret: str, *, tolerance_seconds: int = 300) -> JSON:
        """Same as delivrie.verify_webhook."""
        from ._webhooks import verify_webhook

        return verify_webhook(payload, headers, secret, tolerance_seconds=tolerance_seconds)


class Contacts(_Resource):
    def create(self, email: str, **params: Any) -> JSON:
        return self._r("POST", "/contacts", {"email": email, **params})

    def get(self, id_or_email: str) -> JSON:
        return self._r("GET", f"/contacts/{_q(id_or_email)}")

    def update(self, id_or_email: str, **params: Any) -> JSON:
        return self._r("PATCH", f"/contacts/{_q(id_or_email)}", params)

    def list(self, **params: Any) -> JSON:
        return self._r("GET", "/contacts", query=params)

    def remove(self, id_or_email: str) -> JSON:
        return self._r("DELETE", f"/contacts/{_q(id_or_email)}")

    def import_contacts(self, *, csv: Optional[str] = None, contacts: Optional[Iterable[Any]] = None, **params: Any) -> JSON:
        """Import up to 50,000 contacts from CSV text or a list. Runs in the background; check it with get_import()."""
        body: Dict[str, Any] = dict(params)
        if csv is not None:
            body["csv"] = csv
        if contacts is not None:
            body["contacts"] = list(contacts)
        return self._r("POST", "/contacts/imports", body)

    def get_import(self, import_id: str) -> JSON:
        return self._r("GET", f"/contacts/imports/{_q(import_id)}")

    def list_imports(self, **params: Any) -> JSON:
        return self._r("GET", "/contacts/imports", query=params)


class Segments(_Resource):
    def create(self, name: str) -> JSON:
        return self._r("POST", "/segments", {"name": name})

    def list(self) -> JSON:
        return self._r("GET", "/segments")

    def get(self, segment_id: str) -> JSON:
        return self._r("GET", f"/segments/{_q(segment_id)}")

    def update(self, segment_id: str, *, name: str) -> JSON:
        """Rename a segment."""
        return self._r("PATCH", f"/segments/{_q(segment_id)}", {"name": name})

    def contacts(self, segment_id: str, **params: Any) -> JSON:
        """The contacts in a segment."""
        return self._r("GET", f"/segments/{_q(segment_id)}/contacts", query=params)

    def remove_contacts(self, segment_id: str, contacts: Iterable[str]) -> JSON:
        """Take contacts (emails or ids) out of a segment. The contacts aren't deleted."""
        return self._r("DELETE", f"/segments/{_q(segment_id)}/contacts", {"contacts": list(contacts)})

    def remove(self, segment_id: str) -> JSON:
        return self._r("DELETE", f"/segments/{_q(segment_id)}")

    def add_contacts(self, segment_id: str, contacts: Iterable[Union[str, Mapping[str, Any]]]) -> JSON:
        """Add contacts by email address, or as dicts with email, first_name, last_name and properties."""
        items = [{"email": c} if isinstance(c, str) else dict(c) for c in contacts]
        return self._r("POST", f"/segments/{_q(segment_id)}/contacts", {"contacts": items})


class Topics(_Resource):
    def list(self) -> JSON:
        return self._r("GET", "/topics")


class ContactProperties(_Resource):
    def list(self) -> JSON:
        return self._r("GET", "/contact-properties")


class Broadcasts(_Resource):
    def create(self, params: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> JSON:
        return self._r("POST", "/broadcasts", _prepare_email(params, kwargs))

    def get(self, broadcast_id: str) -> JSON:
        return self._r("GET", f"/broadcasts/{_q(broadcast_id)}")

    def list(self) -> JSON:
        return self._r("GET", "/broadcasts")

    def send(self, broadcast_id: str, *, scheduled_at: Optional[Union[str, datetime]] = None) -> JSON:
        body = {} if scheduled_at is None else {"scheduled_at": _iso(scheduled_at)}
        return self._r("POST", f"/broadcasts/{_q(broadcast_id)}/send", body)

    def cancel(self, broadcast_id: str) -> JSON:
        return self._r("POST", f"/broadcasts/{_q(broadcast_id)}/cancel")

    def update(self, broadcast_id: str, params: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> JSON:
        """Edit a draft."""
        return self._r("PATCH", f"/broadcasts/{_q(broadcast_id)}", {**dict(params or {}), **kwargs})

    def duplicate(self, broadcast_id: str, *, name: Optional[str] = None) -> JSON:
        """Copy it as a new draft."""
        return self._r("POST", f"/broadcasts/{_q(broadcast_id)}/duplicate", {"name": name} if name else {})

    def links(self, broadcast_id: str) -> JSON:
        """Clicked links with total and unique clicks."""
        return self._r("GET", f"/broadcasts/{_q(broadcast_id)}/links")

    def get_content(self, broadcast_id: str) -> JSON:
        return self._r("GET", f"/broadcasts/{_q(broadcast_id)}/content")

    def edit_content(self, broadcast_id: str, params: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> JSON:
        """Edit a draft block by block ({ops} or {blocks}). Anyone with it open in the editor sees the change live."""
        return self._r("POST", f"/broadcasts/{_q(broadcast_id)}/content", {**dict(params or {}), **kwargs})

    def recipients(self, broadcast_id: str, **params: Any) -> JSON:
        """Who it went to (with delivered/opened/clicked/bounced flags), or before sending, who it will reach.
        `recipients` is the count after unsubscribes, topic opt-outs and suppressions."""
        return self._r("GET", f"/broadcasts/{_q(broadcast_id)}/recipients", query=params)

    def remove(self, broadcast_id: str) -> JSON:
        return self._r("DELETE", f"/broadcasts/{_q(broadcast_id)}")


class Templates(_Resource):
    def create(self, name: str, **params: Any) -> JSON:
        return self._r("POST", "/templates", {"name": name, **params})

    def get(self, id_or_alias: str) -> JSON:
        return self._r("GET", f"/templates/{_q(id_or_alias)}")

    def list(self) -> JSON:
        return self._r("GET", "/templates")

    def update(self, id_or_alias: str, **params: Any) -> JSON:
        """Change it. Saved as a draft until published."""
        return self._r("PATCH", f"/templates/{_q(id_or_alias)}", params)

    def duplicate(self, id_or_alias: str, **params: Any) -> JSON:
        return self._r("POST", f"/templates/{_q(id_or_alias)}/duplicate", params)

    def remove(self, id_or_alias: str) -> JSON:
        return self._r("DELETE", f"/templates/{_q(id_or_alias)}")

    def get_content(self, id_or_alias: str) -> JSON:
        return self._r("GET", f"/templates/{_q(id_or_alias)}/content")

    def edit_content(self, id_or_alias: str, params: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> JSON:
        """Edit it block by block ({ops} or {blocks}). Anyone with it open in the editor sees the change live."""
        return self._r("POST", f"/templates/{_q(id_or_alias)}/content", {**dict(params or {}), **kwargs})

    def publish(self, id_or_alias: str) -> JSON:
        return self._r("POST", f"/templates/{_q(id_or_alias)}/publish")


class Suppressions(_Resource):
    def add(self, email: Union[str, Iterable[str]]) -> JSON:
        body = {"email": email} if isinstance(email, str) else {"emails": list(email)}
        return self._r("POST", "/suppressions", body)

    def list(self) -> JSON:
        return self._r("GET", "/suppressions")

    def remove(self, email: str) -> JSON:
        return self._r("DELETE", f"/suppressions/{_q(email)}")


class Events(_Resource):
    def send(self, event: str, *, email: str, data: Optional[Mapping[str, Any]] = None) -> JSON:
        """Record an event about a contact, like "user.created". It starts any live automation listening for it."""
        body: JSON = {"event": event, "email": email}
        if data is not None:
            body["data"] = dict(data)
        return self._r("POST", "/events", body)

    def list(self) -> JSON:
        return self._r("GET", "/events")


class Automations(_Resource):
    def list(self) -> JSON:
        return self._r("GET", "/automations")

    def get(self, automation_id: str) -> JSON:
        return self._r("GET", f"/automations/{_q(automation_id)}")

    def create(self, params: Mapping[str, Any]) -> JSON:
        return self._r("POST", "/automations", dict(params))

    def runs(self, automation_id: str) -> JSON:
        return self._r("GET", f"/automations/{_q(automation_id)}/runs")

    def publish(self, automation_id: str) -> JSON:
        return self._r("POST", f"/automations/{_q(automation_id)}/publish")

    def pause(self, automation_id: str) -> JSON:
        return self._r("POST", f"/automations/{_q(automation_id)}/pause")

    def duplicate(self, automation_id: str, *, name: Optional[str] = None) -> JSON:
        """Copy it, with its trigger and steps, as a new draft."""
        return self._r("POST", f"/automations/{_q(automation_id)}/duplicate", {"name": name} if name else {})

    def update(self, automation_id: str, **params: Any) -> JSON:
        """Rename it or change re-entry: name, reentry."""
        return self._r("PATCH", f"/automations/{_q(automation_id)}", params)

    def remove(self, automation_id: str) -> JSON:
        return self._r("DELETE", f"/automations/{_q(automation_id)}")

    def resume(self, automation_id: str) -> JSON:
        return self._r("POST", f"/automations/{_q(automation_id)}/resume")


class _Threads(_Resource):
    def list(self, **params: Any) -> JSON:
        return self._r("GET", "/inbox/threads", query=params)

    def get(self, thread_id: str) -> JSON:
        return self._r("GET", f"/inbox/threads/{_q(thread_id)}")

    def update(self, thread_id: str, **params: Any) -> JSON:
        return self._r("PATCH", f"/inbox/threads/{_q(thread_id)}", params)

    def reply(self, thread_id: str, params: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> JSON:
        return self._r("POST", f"/inbox/threads/{_q(thread_id)}/reply", _prepare_email(params, kwargs))

    def run_agent(self, thread_id: str) -> JSON:
        """Run the inbox's agent on this thread now."""
        return self._r("POST", f"/inbox/threads/{_q(thread_id)}/agent")

    def notes(self, thread_id: str) -> JSON:
        return self._r("GET", f"/inbox/threads/{_q(thread_id)}/notes")

    def add_note(self, thread_id: str, body: str) -> JSON:
        return self._r("POST", f"/inbox/threads/{_q(thread_id)}/notes", {"body": body})


class _Drafts(_Resource):
    def list(self, **params: Any) -> JSON:
        return self._r("GET", "/inbox/drafts", query=params)

    def create(self, params: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> JSON:
        return self._r("POST", "/inbox/drafts", {**dict(params or {}), **kwargs})

    def update(self, draft_id: str, **params: Any) -> JSON:
        return self._r("PATCH", f"/inbox/drafts/{_q(draft_id)}", params)

    def send(self, draft_id: str) -> JSON:
        return self._r("POST", f"/inbox/drafts/{_q(draft_id)}/send")

    def remove(self, draft_id: str) -> JSON:
        return self._r("DELETE", f"/inbox/drafts/{_q(draft_id)}")


class _Notes(_Resource):
    def remove(self, note_id: str) -> JSON:
        return self._r("DELETE", f"/inbox/notes/{_q(note_id)}")


class _Labels(_Resource):
    def list(self) -> JSON:
        return self._r("GET", "/inbox/labels")


class Inbox(_Resource):
    def __init__(self, client: Delivrie) -> None:
        super().__init__(client)
        self.threads = _Threads(client)
        self.labels = _Labels(client)
        self.drafts = _Drafts(client)
        self.notes = _Notes(client)


class Inboxes(_Resource):
    """Inboxes (addresses on receiving domains) and their agent settings."""

    def list(self) -> JSON:
        return self._r("GET", "/inboxes")

    def create(self, address: str, **params: Any) -> JSON:
        return self._r("POST", "/inboxes", {"address": address, **params})

    def get(self, id_or_address: str) -> JSON:
        return self._r("GET", f"/inboxes/{_q(id_or_address)}")

    def update(self, id_or_address: str, **params: Any) -> JSON:
        return self._r("PATCH", f"/inboxes/{_q(id_or_address)}", params)

    def remove(self, id_or_address: str) -> JSON:
        return self._r("DELETE", f"/inboxes/{_q(id_or_address)}")

    def agent_runs(self, id_or_address: str, **params: Any) -> JSON:
        return self._r("GET", f"/inboxes/{_q(id_or_address)}/agent-runs", query=params)


class Ai(_Resource):
    """AI writing in the team's brand voice."""

    def draft(self, params: Optional[Mapping[str, Any]] = None, **kwargs: Any) -> JSON:
        """Write an email from url and/or brief. With target={"type": ..., "id": ...}, writes it into that email."""
        return self._r("POST", "/ai/draft", {**dict(params or {}), **kwargs})

    def rewrite(self, blocks: Iterable[Mapping[str, Any]], instruction: str, **params: Any) -> JSON:
        """Rewrite blocks with an instruction, like "shorter"."""
        return self._r("POST", "/ai/rewrite", {"blocks": list(blocks), "instruction": instruction, **params})

    def subjects(self, text: str, **params: Any) -> JSON:
        """Subject line ideas for an email's text."""
        return self._r("POST", "/ai/subjects", {"text": text, **params})


class Metrics(_Resource):
    def get(self, *, days: Optional[int] = None, domain_id: Optional[str] = None) -> JSON:
        return self._r("GET", "/metrics", query={"days": days, "domain_id": domain_id})


class Logs(_Resource):
    def list(self, **params: Any) -> JSON:
        return self._r("GET", "/logs", query=params)

    def get(self, log_id: str) -> JSON:
        return self._r("GET", f"/logs/{_q(log_id)}")


class Usage(_Resource):
    def get(self) -> JSON:
        return self._r("GET", "/usage")
