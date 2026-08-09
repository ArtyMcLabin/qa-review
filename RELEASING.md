# Releasing `@artymclabin/qa-review`

```bash
npm test && npm run build
# bump "version" in package.json + add a CHANGELOG.md section
npm publish --access public
```

Then point consumers at the new version (`GR_NextJS/package.json`, and any other
repo mounting `QAReviewOverlay`).

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

Print `loginUrl` to Arty verbatim, poll `doneUrl` in the background, and write the
token to `~/.npmrc` as `//registry.npmjs.org/:_authToken=<token>`. Working script:
`scripts/npm-weblogin.py` (`start` / `poll <doneUrl>`).

🚨 npm is restricting **tokens that bypass 2FA**. If publishing later fails with a
message naming a *token type* ("granular access token with bypass 2fa enabled is
required"), re-logging in cannot fix it - that needs a granular token minted in the
npm UI. Different failure, different remedy.

## Fallback: vendor the tarball

When a release is blocked on credentials but the fix must ship, consumers can take
it as a local tarball instead of waiting:

```bash
npm pack                                   # -> artymclabin-qa-review-X.Y.Z.tgz
cp artymclabin-qa-review-X.Y.Z.tgz <consumer>/vendor/qa-review-X.Y.Z-<sha>.tgz
# consumer package.json: "@artymclabin/qa-review": "file:vendor/qa-review-X.Y.Z-<sha>.tgz"
```

Name the file with the source commit so the bytes are traceable to a revision.
GR_NextJS is on `vendor/qa-review-0.3.8-c51d0fd.tgz` as of 2026-08-09; put it back
on a semver range once 0.3.8 is on the registry.
