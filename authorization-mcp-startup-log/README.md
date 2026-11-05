# The startup log of @nestjs/authorization leaves out MCP primitives

The docs of `@nestjs/authorization` say that "At startup, the module logs every handler it will deny this way", for a handler without `@Can()`. In `@nestjs/authorization` 0.1.1 with `@nestjs/mcp` 0.0.2, set up as the MCP docs say (`decorators: [Public()]` on `McpModule`), a tool, a resource and a prompt without `@Can()` are denied at runtime. But the startup log names only the HTTP route without `@Can()`.

The script starts an app with `AuthorizationModule`, `McpModule`, a controller and a provider of MCP primitives. Each of them has one handler with `@Can()` and some without. The script prints the startup log, then calls each handler without `@Can()` over HTTP.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.0, macOS:

```
=== the startup log about handlers without @Can() ===
AuthorizationGuard denies every call to OrdersController.forgottenRoute: it declares no check. Add @Can(), or @Can.Anyone() where anyone may call the handler (a @Public() route from @nestjs/authentication needs neither).

  names OrdersController.forgottenRoute: true
  names OrdersTools.forgottenTool: false
  names OrdersTools.forgottenResource: false
  names OrdersTools.forgottenPrompt: false

=== the same handlers at runtime ===
  GET /orders/forgotten: 401
  tools/call forgotten-tool: tool error Unauthorized
  resources/read orders://all: error Unauthorized
  prompts/get forgotten-prompt: error Unauthorized

RESULT: BUG: the startup log leaves out the MCP tool, resource and prompt without @Can().
```

The exit code is 1 while the log leaves out the MCP tool, and 0 when it names it.
