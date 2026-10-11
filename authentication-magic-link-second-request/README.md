# `@nestjs/authentication`: a second magic link request in the same browser makes the first link unusable

With `bindToBrowser` (the default), `MagicLinkService.create()` stores one
`<hint>.<secret>` pair in the `__Host-magic_link_tx` cookie. When the same
browser requests a second link, the new pair replaces the old one. Then the
first link gets a 401 `not_this_browser` in the browser that requested it. The
second link works.

The 401 message says "Open the link in the browser you requested it from, or request a new one here".
The user is already in that browser, so the first half of the message does not help here.

The first link is not burned on the server. The browser lost the secret that
opens it.

## Run it

```bash
npm install
npm run repro
```

No network is needed after `npm install`. The script starts one Nest app on
`127.0.0.1` with a free port and keeps the mailbox in memory. A small cookie
jar plays the browser. The process exits by itself with code 0.

Versions: `@nestjs/authentication` 0.1.0, NestJS 12.1.2, Node v24.19.0, Linux.

## Steps in the script

1. Control: request one link and open it. It works.
2. Request link A, then request link B, both in the same browser.
3. Open A. It is refused. Then open B. It works.
4. Open A again with the cookie that the browser held after request A. It works, so the server did not burn A.

## Output of a run

The cookie hints are random, so they differ on each run.

```
--- control: one request, then open it ---
open the link              200 {"ok":true}
                           event: sign-in

--- case: two requests in the same browser ---
request A: cookie qHd9bSsWN_9L
request B: cookie HR2ugJuuveSo
open A (older link)        401 {"message":"Open the link in the browser you requested it from, or request a new one here","error":"not_this_browser","statusCode":401,"errorCode":"not_this_browser"}
                           event: magic-link-refused (not-this-browser)
open B (newer link)        200 {"ok":true}
                           event: sign-in

--- step 4: is link A still valid on the server? ---
A is opened again with the cookie that the browser held after request A.
open A, old cookie back    200 {"ok":true}
                           event: sign-in

RESULT: REPRODUCED: link A was refused with not_this_browser in the browser that requested it
```

`RESULT: REPRODUCED` means the control opened, A was refused with `not_this_browser`, and B opened. `RESULT: OK` means the control, A and B all opened. Any other mix prints `RESULT: UNEXPECTED`.

## Why it happens

The code is in `lib/magic-link/magic-link.service.ts` at nestjs/authentication
master [`ba8eb68`](https://github.com/nestjs/authentication/tree/ba8eb6810261265822cf9f28ba7388586dff165a):

- [line 117](https://github.com/nestjs/authentication/blob/ba8eb6810261265822cf9f28ba7388586dff165a/lib/magic-link/magic-link.service.ts#L117):
  `create()` sets the cookie to `<hint>.<secret>` for this one link. A second call sets the same cookie name again, so the browser keeps only the newest pair.
- [line 157](https://github.com/nestjs/authentication/blob/ba8eb6810261265822cf9f28ba7388586dff165a/lib/magic-link/magic-link.service.ts#L157):
  `consume()` compares the cookie hint with the hint of the opened link. They differ for link A, so it emits `magic-link-refused` with the reason `not-this-browser` and throws `MagicLinkError`.
- [lines 152-156](https://github.com/nestjs/authentication/blob/ba8eb6810261265822cf9f28ba7388586dff165a/lib/magic-link/magic-link.service.ts#L152-L156):
  the comment says that on a refusal "the cookie stays (it may be for a link this browser did request)". That holds for the newest link only.

The docs say "The refused link stays valid in the browser that requested it".
That is true when the link is opened in another browser. It does not hold for
an older link in the same browser.
