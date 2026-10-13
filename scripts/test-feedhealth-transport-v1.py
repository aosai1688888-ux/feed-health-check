#!/usr/bin/env python3
"""Disposable HTTPS transport regression. No Paddle, Group SoR or model calls."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

IMAGE = os.environ.get("FEEDHEALTH_TEST_SITE_IMAGE", "qianwu-feedhealth-static:ci")
PYTHON_IMAGE = os.environ.get("FEEDHEALTH_TEST_PYTHON_IMAGE", "python:3.12-alpine")
HOST = "ci-feedhealth.qianwuai.com"
CLIENT = "CI_ONLY_CLIENT_ID_000000000000.access"
SECRET = "CI_ONLY_SECRET_0000000000000000000000"
ROUTES = ["/webhooks/paddle", "/v1/feedhealth/checkout-intents",
          "/v1/feedhealth/reports/read", "/v1/feedhealth/reports/ack"]
PREFIX = "fh-transport-" + uuid.uuid4().hex[:10]
containers = []
network = PREFIX + "-net"

def run(*args, ok=True):
    p = subprocess.run(args, capture_output=True, text=True, timeout=180)
    if ok and p.returncode:
        raise AssertionError("command failed: " + args[0] + "\n" + p.stderr[-1000:])
    return p

def port(name):
    return int(run("docker", "port", name, "8080/tcp").stdout.strip().rsplit(":", 1)[1])

def request(name, path, *, method="POST", body=b"{}", headers=None):
    h = {"Content-Type": "application/json", "Origin": "https://feed.qianwuai.com",
         "Sec-Fetch-Site": "same-origin"}
    h.update(headers or {})
    c = http.client.HTTPConnection("127.0.0.1", port(name), timeout=25)
    try:
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        return r.status, dict(r.getheaders()), r.read()
    finally:
        c.close()

def start_site(label, extra=()):
    name = PREFIX + "-" + label
    run("docker", "run", "-d", "--name", name, "--network", network,
        "-p", "127.0.0.1::8080", *extra, IMAGE)
    containers.append(name)
    for _ in range(40):
        try:
            if request(name, "/healthz", method="GET")[0] == 200:
                return name
        except (OSError, http.client.HTTPException):
            pass
        time.sleep(0.25)
    raise AssertionError("test site did not become healthy")

def gate_env(**changes):
    env = {"FEEDHEALTH_TRANSPORT_ENABLED": "1", "FEEDHEALTH_TRANSPORT_OWNER_RELEASE": "OWNER_APPROVED",
           "FEEDHEALTH_GATEWAY_INGRESS_HOST": HOST, "FEEDHEALTH_ACCESS_CLIENT_ID": CLIENT,
           "FEEDHEALTH_ACCESS_CLIENT_SECRET": SECRET}
    env.update(changes)
    return [item for k, v in env.items() for item in ("-e", k + "=" + v)]

try:
    run("docker", "network", "create", network)
    off = start_site("off")
    for route in ROUTES:
        assert request(off, route)[0] == 503, route
    for path in ["/v1/commands", "/v1/read", "/v1/feedhealth/ai/claim",
                 "/v1/feedhealth/payment/paddle/relay", "/webhooks/other"]:
        assert request(off, path)[0] == 404, path
    assert request(off, "/", method="GET")[0] == 200
    assert json.loads(request(off, "/checkout-config.v1.json", method="GET")[2])["enabled"] is False
    print("DEFAULT_DISABLED_STATIC_SITE_AND_PRIVATE_PATH_DENIAL=PASS", flush=True)

    for changes in [
        {"FEEDHEALTH_TRANSPORT_OWNER_RELEASE": "HOLD"},
        {"FEEDHEALTH_TRANSPORT_OWNER_RELEASE": ""},
        {"FEEDHEALTH_GATEWAY_INGRESS_HOST": "feed.qianwuai.com"},
        {"FEEDHEALTH_GATEWAY_INGRESS_HOST": "127.0.0.1"},
        {"FEEDHEALTH_GATEWAY_INGRESS_HOST": "attacker.example"},
        {"FEEDHEALTH_GATEWAY_INGRESS_HOST": 'bad";.qianwuai.com'},
        {"FEEDHEALTH_ACCESS_CLIENT_SECRET": ""},
        {"FEEDHEALTH_ACCESS_CLIENT_SECRET": 'bad"\ninclude /tmp/injected;'},
    ]:
        result = run("docker", "run", "--rm", *gate_env(**changes),
                     "--entrypoint", "/docker-entrypoint.d/40-feedhealth-transport.sh", IMAGE, ok=False)
        assert result.returncode != 0
        assert SECRET not in result.stderr
    print("ADMISSION_HOST_LOOP_INJECTION_AND_MISSING_CREDENTIAL_DENIAL=PASS", flush=True)

    with tempfile.TemporaryDirectory(prefix=PREFIX) as tmp:
        root = Path(tmp)
        run("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(root/"key.pem"), "-out", str(root/"cert.pem"),
            "-days", "1", "-subj", "/CN=" + HOST, "-addext", "subjectAltName=DNS:" + HOST)
        (root/"cert.pem").chmod(0o644)
        (root/"server.py").write_text("""
import hashlib, json, ssl
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        raw=self.rfile.read(int(self.headers.get('Content-Length','0')))
        doc={'path':self.path,'sha256':hashlib.sha256(raw).hexdigest(),'headers':dict(self.headers)}
        body=json.dumps(doc).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','public, max-age=3600')
        self.send_header('CF-Access-Client-Secret','CI_RESPONSE_SECRET')
        self.send_header('Set-Cookie','fhpd_v1=CI_ONLY; Path=/v1/feedhealth/reports/; Secure; HttpOnly; SameSite=Strict')
        self.end_headers()
        self.wfile.write(body)
server=ThreadingHTTPServer(('0.0.0.0',443),Handler)
ctx=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('/fixture/cert.pem','/fixture/key.pem')
server.socket=ctx.wrap_socket(server.socket,server_side=True)
server.serve_forever()
""")
        upstream = PREFIX + "-fixture"
        run("docker", "run", "-d", "--name", upstream, "--network", network,
            "--network-alias", HOST, "-v", str(root)+":/fixture:ro",
            "--entrypoint", "python", PYTHON_IMAGE, "/fixture/server.py")
        containers.append(upstream)
        # Wait for the actual TLS listener, not merely container creation.
        probe = ("import socket,ssl; "
                 "c=ssl.create_default_context(cafile='/fixture/cert.pem'); "
                 "s=c.wrap_socket(socket.create_connection(('127.0.0.1',443),2),"
                 "server_hostname='" + HOST + "'); s.close()")
        for attempt in range(40):
            if run("docker", "exec", upstream, "python", "-c", probe, ok=False).returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise AssertionError("fixture TLS listener unavailable: " + run("docker", "logs", upstream).stderr[-500:])
        on = start_site("on", [*gate_env(), "-v",
            str(root/"cert.pem")+":/etc/ssl/certs/ca-certificates.crt:ro"])
        raw = b'{ "event_id" : "CI_FIXTURE_ONLY", "utf8" : "\\u4e7e", "n":1 }\n'
        spoof = {"Authorization": "Bearer ATTACKER", "CF-Access-Client-Id": "ATTACKER",
                 "CF-Access-Client-Secret": "ATTACKER", "CF-Connecting-IP": "1.2.3.4",
                 "X-Forwarded-For": "1.2.3.4", "Paddle-Signature": "ts=1;h1=CI_ONLY",
                 "Cookie": "fhpd_v1=CI_ONLY"}
        for route in ROUTES:
            status, headers, data = request(on, route, body=raw, headers=spoof)
            assert status == 200, (route, status)
            doc = json.loads(data)
            got = {k.lower():v for k,v in doc["headers"].items()}
            assert doc["path"] == route
            assert doc["sha256"] == hashlib.sha256(raw).hexdigest()
            assert got["cf-access-client-id"] == CLIENT
            assert got["cf-access-client-secret"] == SECRET
            assert "authorization" not in got and "x-forwarded-for" not in got and "cf-connecting-ip" not in got
            assert ("cookie" in got) == ("/reports/" in route)
            assert ("paddle-signature" in got) == (route == "/webhooks/paddle")
            if route == "/webhooks/paddle":
                assert got["paddle-signature"] == spoof["Paddle-Signature"]
            headers = {k.lower():v for k,v in headers.items()}
            assert headers["cache-control"] == "no-store"
            assert "cf-access-client-secret" not in headers
            assert ("set-cookie" in headers) == (route == "/v1/feedhealth/checkout-intents")
            assert request(on, route, method="GET")[0] == 405
            assert request(on, route+"?token=CI_ONLY")[0] == 400
        assert request(on, "/v1/feedhealth/reports/read", headers={"Origin":"https://attacker.example"})[0] == 403
        assert request(on, "/v1/feedhealth/reports/ack", headers={"Sec-Fetch-Site":"cross-site"})[0] == 403
        assert request(on, "/v1/feedhealth/checkout-intents", body=b"x"*135001)[0] == 413
        assert request(on, "/webhooks/paddle", body=b"x"*524289)[0] == 413
        for path in ["/v1/commands", "/v1/feedhealth/ai/claim", "/v1/feedhealth/payment/paddle/relay"]:
            assert request(on, path)[0] == 404
        print("HTTPS_RAW_BODY_SIGNATURE_HEADER_COOKIE_AND_ORIGIN_BOUNDARIES=PASS", flush=True)
        untrusted = start_site("untrusted-tls", gate_env())
        assert request(untrusted, "/webhooks/paddle")[0] == 502
        print("UNTRUSTED_UPSTREAM_TLS_DENIED=PASS", flush=True)
        # Exact-path access logging is off. No body, cookie or token should appear.
        logs = run("docker", "logs", on).stdout + run("docker", "logs", on).stderr
        for forbidden in ["CI_FIXTURE_ONLY", SECRET, "fhpd_v1=CI_ONLY", "ATTACKER"]:
            assert forbidden not in logs
        print("SENSITIVE_ROUTE_LOGGING_DISABLED=PASS", flush=True)
    print("FEEDHEALTH_EXISTING_WEBSITE_TRANSPORT_FIXTURE=PASS; REAL_PAYMENT=0; SOR_WRITES=0; PROVIDER_CALLS=0")
finally:
    for name in reversed(containers):
        run("docker", "rm", "-f", name, ok=False)
    run("docker", "network", "rm", network, ok=False)
