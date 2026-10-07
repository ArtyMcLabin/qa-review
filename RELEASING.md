# Releasing `@artymclabin/qa-review`

🚨 **A release is a TAG PUSH, nothing else (since 0.3.8, 2026-08-12).**
`.github/workflows/publish.yml` publishes over npm trusted publishing (OIDC): no
token, no login, no authenticator code, no human. Never run `npm publish` from a
laptop and never ask Arty for a code - he has no authenticator app, and asking
him for one sent a 2026-10-07 session down a dead end this file used to document.

```bash
npm test && npm run build
# bump "version" in package.json + add a CHANGELOG.md section, commit, push
git tag vX.Y.Z && git push origin vX.Y.Z    # the workflow publishes in ~40s
gh run list -L 1                            # confirm success
npm view @artymclabin/qa-review version     # confirm the registry has it
```

Then point consumers at the new version (`GR_NextJS/package.json`, and any other
repo mounting `QAReviewOverlay`).

Everything below the next heading is the pre-OIDC history (manual login, vendored
tarballs). Kept for the traps it records; it is NOT the release procedure.

## 🚨 A 404 on PUT is an AUTH failure, not a missing package

```
npm error code E404
npm error 404 Not Found - PUT https://registry.npmjs.org/@artymclabin%2fqa-review
npm error 404  '@artymclabin/qa-review@0.3.8' is not in this registry.
```

npm answers an unauthenticated write to a **scoped** package with 404 rather than
401, so the error reads as "this package does not exist" when the package exists
and is published. Do not go looking for a naming or scope problem. Confirm which
it is in one call:

```bash
npm whoami                                        # 401  -> the token is dead
curl -s https://registry.npmjs.org/@artymclabin%2Fqa-review | head -c 400
                                                  # returns the package -> it exists
```

Cost of getting this wrong once: a session concluded the package might never have
been published, while `0.3.7` had been live since 2026-08-02.

## Re-authenticating (2026-08-09)

The token in `~/.npmrc` expired silently; nothing surfaces it until a publish. Web
login needs exactly one click from Arty and no password in any terminal - but an
agent must NOT drive it with the CLI.

🚨 **`npm login --auth-type=web` is a trap in any non-TTY shell** (which is every
backgrounded agent shell). It prints a perfectly real
`Login at: https://www.npmjs.com/login?next=/login/cli/<uuid>`, then - because it
cannot open a browser - falls back to the legacy `Username:` prompt and dies on
EOF. Nothing is left listening, so the click accomplishes nothing and the URL you
handed over was dead before the human read it. Holding stdin open with a pipe does
not help; a pipe is still not a TTY. Observed twice, 2026-08-09.

Drive the same handshake directly instead, and the poller is yours:

```
POST https://registry.npmjs.org/-/v1/login    headers: npm-auth-type: web
     body {"hostname": "<machine>"}           -> {loginUrl, doneUrl}
GET  <doneUrl>   -> 202 + Retry-After while pending, 200 {"token": "npm_..."} on approval
```

Print `loginUrl` to Arty verbatim, poll `doneUrl`, and write the token to
`~/.npmrc` as `//registry.npmjs.org/:_authToken=<token>`. Script:
`scripts/npm-weblogin.py`.

🚨 **THE SESSION LIVES ABOUT FIVE MINUTES.** Measured 2026-08-09: a session polled
cleanly (HTTP 202) 48 times at 6s intervals and then returned
`404 {"message":"not found"}` - so the 404 is a real expiry, not a bot-management
or header problem. Consequence for the workflow: **do not pre-generate a link and
wait for the human to get round to it.** Ask first, generate only when they say
they are at the keyboard, and tell them the link is good for about five minutes.
Four links were burned in one session learning this, each handed over with a
different confident and wrong explanation.

## 🚨 Logging in is NOT enough to publish, and no email will ever arrive

Confirmed end-to-end 2026-08-09. After a fully successful web login (`npm whoami`
-> `artymclabin`), `npm publish` still returns:

```
npm error code E403
npm error 403 Forbidden - PUT https://registry.npmjs.org/@artymclabin%2fqa-review
npm error 403 Two-factor authentication or granular access token with bypass 2fa
              enabled is required to publish packages.
```

**Login 2FA and publish 2FA are different mechanisms on this account.** Login
sends an email OTP to `npm@artymclabin.com` (which forwards into the Gmail account
an agent can read, so an agent CAN complete a login unaided). Publish does not
send anything: it wants a TOTP authenticator code (`npm publish --otp=<code>`) or a
granular token with bypass-2FA. Waiting on the inbox for a publish OTP is watching
a mailbox that will never receive one - verified with three searches over the
window.

So an agent can get this account **logged in** on its own, and cannot **publish**
on its own. Publishing needs either Arty's authenticator app, or a decision from
him to mint a bypass-2FA token - and that second one is a security posture change
npm is actively deprecating (account changes Aug 2026, direct publishing Jan 2027),
so it is his call to make, not one to route around. Do not re-dispatch a browser
agent to mint one after it has declined: that is shopping for a different answer to
the same question.

When a release is blocked here, vendor the tarball (below) and ask him.

## Fallback: vendor the tarball

When a release is blocked on credentials but the fix must ship, consumers can take
it as a local tarball instead of waiting:

```bash
npm pack                                   # -> artymclabin-qa-review-X.Y.Z.tgz
cp artymclabin-qa-review-X.Y.Z.tgz <consumer>/vendor/qa-review-X.Y.Z-<sha>.tgz
# consumer package.json: "@artymclabin/qa-review": "file:vendor/qa-review-X.Y.Z-<sha>.tgz"
```

Name the file with the source commit so the bytes are traceable to a revision.

🚨 **Do NOT adopt the tarball with a plain `pnpm install` on Windows.** It re-resolves
the lockfile for the local platform and silently DROPS every other platform's
optional binaries (`@next/swc-linux-*` among them) - the Linux Vercel build then
breaks. Instead patch the three qa-review entries in `pnpm-lock.yaml` by hand
(importer `specifier`/`version`, the `packages:` key with `resolution: {integrity,
tarball}` + `version`, the `snapshots:` key), compute the integrity as
`sha512-` + base64(sha512(tarball bytes)), then run `pnpm install --frozen-lockfile`
and confirm `git diff --stat pnpm-lock.yaml` touches only those lines (2026-10-07,
0.3.13: an unchecked install removed 86 lockfile lines).
GR_NextJS is on `vendor/qa-review-0.3.8-c51d0fd.tgz` as of 2026-08-09; put it back
on a semver range once 0.3.8 is on the registry.
