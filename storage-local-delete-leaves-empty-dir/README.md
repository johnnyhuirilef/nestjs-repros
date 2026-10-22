# `@nestjs/storage` LocalDisk keeps the folder of a deleted file

`LocalDisk.delete()` removes the file, but it keeps the folders that the file
was in. A later `put()` at the name of one of those folders fails with
`StorageKeyConflictError`, although `exists()` and `list()` show nothing
there. `InMemoryDisk` accepts the same steps.

## Run it

```bash
npm install
npm run repro
```

No Nest app, database or cloud service is needed. The script uses each disk
directly. It makes fresh temp directories as the `LocalDisk` roots and
removes them at the end. The process exits by itself.

Node used: v24.21.0

## What you should see

On `@nestjs/storage` 0.0.3:

```
=== InMemoryDisk ===
  put avatars/a.png:     ok
  delete avatars/a.png:  ok
  exists avatars:        false
  list:                  []
  put avatars:           ok

=== LocalDisk ===
  put avatars/a.png:     ok
  delete avatars/a.png:  ok
  exists avatars:        false
  list:                  []
  root folder holds:     ["avatars"]
  put avatars:           StorageKeyConflictError: "avatars" conflicts with an existing file or directory on this disk

=== LocalDisk, empty root (control) ===
  put avatars:           ok

RESULT: BUG: after the delete, LocalDisk refuses a key that InMemoryDisk accepts.
```

The exit code is 1. With an empty root, `LocalDisk` accepts `avatars`, so
only the folder that the delete left behind makes the `put` fail.
