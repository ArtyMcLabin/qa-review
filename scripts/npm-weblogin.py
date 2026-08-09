"""
npm's web login, driven directly over HTTP.

WHY NOT `npm login --auth-type=web`: the CLI prints the login URL and then, when
it cannot open a browser (any non-TTY stdin - which is every backgrounded agent
shell), silently falls back to the legacy username/password prompt and dies on
EOF. The URL it printed is real but nothing is left listening for the token, so
the click accomplishes nothing. Doing the same handshake here means the poller
is ours and survives.

  POST /-/v1/login            -> {loginUrl, doneUrl}
  GET  doneUrl                -> 202 + Retry-After while pending, 200 {token}

Usage:
  python npm-weblogin.py start   # prints loginUrl + doneUrl
  python npm-weblogin.py poll <doneUrl>   # blocks, writes ~/.npmrc on success
"""

import json
import os
import sys
import time
import urllib.request

REGISTRY = "https://registry.npmjs.org"
UA = "npm/10.9.0 node/v22.17.0 win32 x64 workspaces/false"


def _req(url, data=None, method=None):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("user-agent", UA)
    req.add_header("npm-auth-type", "web")
    req.add_header("accept", "*/*")
    # 🚨 CONTENT-TYPE ONLY ON THE POST. Sending `content-type: application/json`
    # on the GET to /-/v1/done makes the registry answer 404 "not found" - i.e.
    # exactly what a dead session looks like, on a session that is alive and
    # polling fine without the header. Cost of not knowing: a login URL handed
    # over as working while the poller had already given up on it.
    if data is not None:
        req.add_header("content-type", "application/json")
    return req


def start():
    body = json.dumps({"hostname": os.environ.get("COMPUTERNAME", "agent")}).encode()
    with urllib.request.urlopen(_req(f"{REGISTRY}/-/v1/login", data=body, method="POST")) as r:
        payload = json.load(r)
    print(payload["loginUrl"])
    print(payload["doneUrl"])


def npmrc_write(token):
    path = os.path.join(os.path.expanduser("~"), ".npmrc")
    line = f"//registry.npmjs.org/:_authToken={token}"
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except FileNotFoundError:
        lines = []
    out, replaced = [], False
    for ln in lines:
        if ln.startswith("//registry.npmjs.org/:_authToken="):
            out.append(line)
            replaced = True
        else:
            out.append(ln)
    if not replaced:
        out.append(line)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(out) + "\n")
    print("wrote ~/.npmrc")


def poll(done_url, timeout_s=1800):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(_req(done_url)) as r:
                if r.status == 200:
                    token = json.load(r).get("token")
                    if token:
                        npmrc_write(token)
                        print("AUTHENTICATED")
                        return 0
                wait = int(r.headers.get("retry-after") or 5)
        except urllib.error.HTTPError as e:
            if e.code in (202,):
                wait = int(e.headers.get("retry-after") or 5)
            else:
                print(f"HTTP {e.code}: {e.read()[:300]!r}")
                return 1
        time.sleep(max(2, min(wait, 15)))
    print("TIMED OUT waiting for the click")
    return 1


if __name__ == "__main__":
    if sys.argv[1] == "start":
        start()
    else:
        sys.exit(poll(sys.argv[2]))
