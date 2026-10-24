# Concurrent puts on a LocalDisk can leave a file without its metadata

In `@nestjs/storage` 0.0.3, `LocalDisk.commit()` renames the sidecar with the metadata first, and then the file. When several `put()` calls on the same key run at the same time, the renames can interleave: for example the sidecar of B, then the file of B, then the file of A. The file that stays is A's, but the sidecar is B's, so `stat()` and `get()` return empty `metadata` and an inferred `contentType`, until the next put.

The script writes 200 keys. For each key, it runs two puts one after the other (the control), or four puts at the same time, each with its own body and `metadata: { writer }`. Then it checks that the metadata matches the body that stayed.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 24.21.0, macOS:

```
=== sequential puts (control) ===
  keys where the file and its metadata do not match: 0 of 200

=== concurrent puts ===
  keys where the file and its metadata do not match: 7 of 200
  example: {"key":"concurrent/file-1.txt","body":"body from B","contentType":"text/plain; charset=utf-8","metadata":{}}

RESULT: BUG: after four concurrent puts, 7 of 200 files lost the metadata of the put that wrote them.
```

The count changes from run to run, because it depends on timing. In five more runs, it was 3, 5, 6, 1 and 10 of 200. The exit code is 1 while some files lose their metadata, and 0 when none do.
