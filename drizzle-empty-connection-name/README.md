# @nestjs/drizzle: an empty connection name collides with the default one

`getDrizzleToken('')` returns the token of the default connection, so a second
registration overwrites the first one and no error is raised.

```bash
npm install
npm run build
npm start
```

Output:

```
getDrizzleToken()       -> DrizzleDatabase
getDrizzleToken("")     -> DrizzleDatabase
resolved under it       -> reporting
the other one           -> unreachable, no error was raised
```

Both databases are registered and both connections are opened. Only one of
them can be injected; the other stays reachable by nothing, and is closed on
shutdown like any other.

An empty name is what `process.env.DB_NAME ?? ''` or
`config.get('DB_NAME', '')` leaves behind, and `name?: string` accepts it.
