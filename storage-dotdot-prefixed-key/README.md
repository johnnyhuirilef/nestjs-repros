# `@nestjs/storage` LocalDisk refuses a key that starts with `..`

`LocalDisk` rejects a valid key when its first segment starts with two dots,
such as `..foo/a`. The key rules only forbid segments that are exactly `.` or
`..`, and `InMemoryDisk` accepts the same key. The failed `put` also leaves an
empty `..foo` directory in the disk root.

This is not a security problem. Real escapes such as `../x` and links that
point outside the root are still refused, and they are refused correctly.

## Run it

```bash
npm install
npm run repro
```

No Nest app, database or cloud service is needed. The script uses each disk
directly. It makes a fresh temp directory as the `LocalDisk` root and removes
it at the end. The process exits by itself.

Node used: v24.19.0

## What you should see

```
InMemoryDisk foo/a    put: ok   exists: true   get: hello   list: [foo/a]   delete: ok
InMemoryDisk ..foo/a  put: ok   exists: true   get: hello   list: [..foo/a]   delete: ok
InMemoryDisk ..a      put: ok   exists: true   get: hello   list: [..a]   delete: ok
LocalDisk    foo/a    put: ok   exists: true   get: hello   list: [foo/a]   delete: ok
LocalDisk    ..foo/a  put: StorageInvalidKeyError: Invalid storage key: the key leads outside the disk's root through a link   exists: false   get: StorageFileNotFoundError: No file at "..foo/a"   list: []   delete: ok
LocalDisk    ..a      put: ok   exists: true   get: hello   list: [..a]   delete: ok

LocalDisk root holds a "..foo" directory after the failed put of "..foo/a": true

RESULT: BUG: InMemoryDisk accepts "..foo/a" and LocalDisk refuses it
```

`foo/a` is the control. Both disks store it. `..foo/a` works on `InMemoryDisk`
and fails on `LocalDisk`. The key `..a` has no directory part, so `LocalDisk`
accepts it. Only a first segment that starts with `..` and has more segments
after it fails.

## Why it happens

The shared key rules reject a segment only when it is exactly `.` or `..`
([`lib/utils/keys.util.ts:43-45`](https://github.com/nestjs/storage/blob/e75a9c5/lib/utils/keys.util.ts#L43-L45)).
So `..foo` is a valid segment.

`LocalDisk` then checks that the real path stays inside the root. The check
tests whether the relative path starts with the text `..`
([`lib/disks/local.disk.ts:361`](https://github.com/nestjs/storage/blob/e75a9c5/lib/disks/local.disk.ts#L361),
in `inside()`):

```ts
return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && ...);
```

The text `..foo` starts with `..`, so the check treats the directory `..foo` as a
path that leaves the root. It throws `StorageInvalidKeyError`. The directory is
already created by then, so it stays behind. The check needs to look for a
first segment that is exactly `..`, not for the text `..` at the start.

The docs say all disks follow the same rules
([File storage](https://docs.nestjs.com/application/file-storage)):

> Every disk has the same methods, key rules and errors. A key is a relative,
> `/`-separated path of at most 1024 UTF-8 bytes, without empty, `.` or `..`
> segments, backslashes or control characters.

`..foo/a` has none of those problems, so `LocalDisk` breaks that promise.

Versions: `@nestjs/storage` 0.0.2, source checked at commit `e75a9c5`.
