---
title: Python
group: SDKs and frameworks
order: 4
description: Send email from Python, Django, Flask and FastAPI with the official delivrie package, verify webhooks, or use Django's SMTP backend.
---
The official [`delivrie`](https://pypi.org/project/delivrie/) package covers the whole API. It has no dependencies, works on Python 3.10 and later, and comes in sync and async versions. (Already using the `resend` package? Set `RESEND_API_URL=https://delivrie.io/api` and it talks to Delivrie; see [Migrate from Resend](/docs/migrate-from-resend).)

```bash
pip install delivrie
```

## Send an email

Create an API key in [API keys](https://delivrie.io/api-keys) and set it as `DELIVRIE_API_KEY`.

```python send.py
from delivrie import Delivrie

client = Delivrie()  # reads DELIVRIE_API_KEY

email = client.emails.send(
    from_="Acme <hello@mail.acme.com>",
    to="ada@example.com",
    subject="Welcome to Acme",
    html="<p>Thanks for signing up.</p>",
    idempotency_key="welcome-42",
)
print(email["id"])
```

`from` is a Python keyword, so pass `from_`, or pass a dict exactly like the REST API: `client.emails.send({"from": ..., "to": ..., ...})`. A `datetime` works for `scheduled_at`, `bytes` for attachment content and a dict for `tags`.

With an `idempotency_key`, the SDK retries network errors, rate limits and server errors safely: a retry returns the original email instead of sending a second one. Without one, sends aren't retried. See [Idempotency and retries](/docs/idempotency).

## Errors

Methods return the API's JSON as a dict and raise `DelivrieError` on failure:

```python
from delivrie import DelivrieError

try:
    client.emails.send(from_="Acme <hello@mail.acme.com>", to="ada@example.com", subject="Hi", text="Hello")
except DelivrieError as e:
    print(e.status_code, e.name, e.message)
```

Branch on `e.name` (see [Errors](/docs/errors)). `status_code` is 0 for `network_error` and `timeout`.

## Templates and attachments

```python
client.emails.send(
    from_="Acme <billing@mail.acme.com>",
    to="ada@example.com",
    template={"id": "invoice", "variables": {"first_name": "Ada", "total": "$20.00"}},
    attachments=[{"filename": "invoice.pdf", "content": open("invoice.pdf", "rb").read()}],
)
```

## Async (FastAPI)

```python main.py
from delivrie import AsyncDelivrie, DelivrieError
from fastapi import FastAPI, HTTPException

app = FastAPI()
client = AsyncDelivrie()

@app.post("/signup")
async def signup(email: str):
    try:
        sent = await client.emails.send(
            from_="Acme <hello@mail.acme.com>",
            to=email,
            subject="Welcome",
            html="<p>Thanks for signing up.</p>",
            idempotency_key=f"welcome-{email}",
        )
    except DelivrieError as e:
        raise HTTPException(502, e.message)
    return {"email_id": sent["id"]}
```

## Django

The simplest setup is Django's SMTP backend with the [SMTP relay](/docs/smtp), so `send_mail` and password-reset emails go through Delivrie:

```python settings.py
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "smtp.delivrie.io"
EMAIL_PORT = 587
EMAIL_USE_TLS = True
EMAIL_HOST_USER = "delivrie"
EMAIL_HOST_PASSWORD = os.environ["DELIVRIE_API_KEY"]
DEFAULT_FROM_EMAIL = "Acme <hello@mail.acme.com>"
```

For templates, scheduling or tags, call the SDK from your views or tasks instead.

## Flask

```python app.py
from delivrie import Delivrie, DelivrieError
from flask import Flask, request

app = Flask(__name__)
client = Delivrie()

@app.post("/contact")
def contact():
    try:
        client.emails.send(
            from_="Website <forms@mail.acme.com>",
            to="team@acme.com",
            reply_to=request.form["email"],
            subject="New contact form message",
            text=request.form["message"],
        )
    except DelivrieError as e:
        return e.message, 502
    return "Sent", 200
```

## Verify webhooks

Pass the raw body, before parsing it:

```python webhooks.py
import os
from delivrie import verify_webhook, WebhookVerificationError

@app.post("/webhooks/delivrie")
def delivrie_webhook():
    try:
        event = verify_webhook(request.get_data(), request.headers, os.environ["DELIVRIE_WEBHOOK_SECRET"])
    except WebhookVerificationError:
        return "", 400
    if event["type"] == "email.bounced":
        ...
    return "", 204
```

In Django pass `request.body` and `request.headers`; in FastAPI, `await request.body()` and `request.headers`.

## Everything else

The client uses the same names as the [Node.js SDK](/docs/sdks), in snake_case: `client.domains`, `client.api_keys`, `client.webhooks`, `client.contacts`, `client.segments`, `client.broadcasts`, `client.templates`, `client.suppressions`, `client.events`, `client.automations`, `client.inbox` (threads, drafts, notes), `client.inboxes`, `client.ai`, `client.metrics`, `client.logs` and `client.usage`. For example, `client.broadcasts.duplicate(id)`, `client.contacts.import_contacts(csv=...)`, `client.emails.received_attachments(id)` and `client.templates.edit_content(id, ops=[...])`. For anything else, `client.request("GET", "/path")` calls the API directly.

## Without the SDK

The API is a single JSON request, so `requests` or `httpx` work too:

```python
import os, requests

res = requests.post(
    "https://delivrie.io/api/emails",
    headers={"Authorization": f"Bearer {os.environ['DELIVRIE_API_KEY']}", "Idempotency-Key": "welcome-42"},
    json={"from": "Acme <hello@mail.acme.com>", "to": "ada@example.com", "subject": "Welcome", "html": "<p>Hi</p>"},
    timeout=30,
)
res.raise_for_status()
print(res.json()["id"])
```
