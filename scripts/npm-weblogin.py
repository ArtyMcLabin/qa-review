"""
npm web login, with the two things the earlier attempts got wrong.

1. THE SESSION LIVES ABOUT FIVE MINUTES. Measured: 48 clean 202 polls at 6s
   intervals, then 404 `{"message":"not found"}`. So the 404 is a genuine expiry.
   It is NOT a header problem and NOT Cloudflare bot management - both were
   confidently blamed first, and both were wrong. The cookie jar below is kept
   because carrying `__cf_bm` is correct behaviour for a Cloudflare-fronted API,
   not because it fixed anything.

   The real consequence is about WORKFLOW, not code: do not pre-generate a login
   URL and wait for a human to get round to it. Ask first, generate when they say
   they are ready, and tell them it is good for about five minutes.

2. PROVE IT SURVIVES BEFORE HANDING THE URL TO A HUMAN. The login URL is only
   printed after the poller has held a session for ~a minute of real polling. A
   link that dies thirty seconds after it is handed over costs someone a click
   and their trust; a link that has already been kept alive costs nothing.
"""

import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request

REGISTRY = "https://registry.npmjs.org"
UA = "npm/10.9.0 node/v22.17.0 win32 x64 workspaces/false"
PROVE_POLLS = 8          # ~50s of successful polling before the URL is printed
INTERVAL = 6             # registry asks for 3; poll slower, not faster

opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
)


def _req(url, data=None, method=None):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("user-agent", UA)
    req.add_header("accept", "*/*")
    if data is not None:
        req.add_header("npm-auth-type", "web")
        req.add_header("content-type", "application/json")
    return req


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


def main(timeout_s=2400):
    body = json.dumps({"hostname": os.environ.get("COMPUTERNAME", "agent")}).encode()
    with opener.open(_req(f"{REGISTRY}/-/v1/login", data=body, method="POST")) as r:
        payload = json.load(r)
    login_url, done = payload["loginUrl"], payload["doneUrl"]

    deadline = time.time() + timeout_s
    ok_polls = 0
    announced = False
    while time.time() < deadline:
        try:
            with opener.open(_req(done)) as r:
                if r.status == 200:
                    token = json.load(r).get("token")
                    if token:
                        npmrc_write(token)
                        if not announced:
                            print(f"LOGIN_URL {login_url}", flush=True)
                        print("AUTHENTICATED", flush=True)
                        return 0
                ok_polls += 1
        except urllib.error.HTTPError as e:
            if e.code == 202:
                ok_polls += 1
            else:
                print(f"DEAD after {ok_polls} good polls: HTTP {e.code}", flush=True)
                return 1

        if ok_polls == PROVE_POLLS and not announced:
            # Only now is the link worth a human's click.
            print(f"LOGIN_URL {login_url}", flush=True)
            announced = True
        time.sleep(INTERVAL)

    print(f"TIMED OUT after {ok_polls} good polls", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main())
