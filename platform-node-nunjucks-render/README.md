# `@Render()` with nunjucks answers 500 on the Node adapter

In `@nestjs/platform-node` 12.4.2, `app.setViewEngine({ engine: { nunjucks: require('nunjucks') }, templates })` and a `@Render()` route answer 500 with `TypeError: template.call is not a function`. The same options render on the Fastify adapter.

The script starts the same `@Render('index')` route three times: on the Node adapter with handlebars (a control), on the Fastify adapter with nunjucks (a control), and on the Node adapter with nunjucks.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.1, macOS:

```
Same @Render("index") route and setViewEngine({ engine, templates }) options on each adapter.

NodeAdapter, handlebars (control)    200 "Hello Nest from handlebars"
FastifyAdapter, nunjucks (control)   200 "Hello Nest from nunjucks"
NodeAdapter, nunjucks                500 "{\"statusCode\":500,\"message\":\"Internal server error\"}"
                                     logged error: TypeError: template.call is not a function

RESULT: BUG: @Render() with nunjucks fails on the NodeAdapter, although the same options render on Fastify.
```

The exit code is 1. When the Node adapter renders the nunjucks view, the script prints `RESULT: FIXED` and exits with 0.
