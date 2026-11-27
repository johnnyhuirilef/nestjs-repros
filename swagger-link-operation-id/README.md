# A link to a getter with several paths, `@All` or a base class is missing

In `@nestjs/swagger` 12.1.3, the link that `@ApiDefaultGetter` (or `@ApiProperty({ link })`) adds to a response is missing from the document when the getter route has several paths, is an `@All` route, or is declared in a base class of the controller. The link gets an operationId that no operation has, and `SwaggerModule.createDocument` then drops it.

The script builds a Nest app with `GET /pets/:id`, which answers a `Pet`. The `ownerId` field of `Pet` links to the default getter of `Owner`, `OwnersController.getOwner`. Each case declares that getter in another way. The control is a plain `@Get(':id')`.

## Run

```bash
npm install
npm run repro
```

## Output

On Node 26.13.1, macOS:

```
Links of GET /pets/{id} to the default getter of Owner (OwnersController.getOwner).

@Get(":id") (control)            operations: OwnersController_getOwner                                        link: OwnersController_getOwner
@Get([":id", "by-id/:id"])       operations: OwnersController_getOwner[0], OwnersController_getOwner[1]       link: no link
@All(":id")                      operations: OwnersController_getOwner_get, OwnersController_getOwner_post, ... link: no link
@Get(":id") in a base class      operations: OwnersController_getOwner                                        link: no link

RESULT: BUG: in 3 of 3 cases, the document has no link to the getter.
```

The exit code is 1. When the bug is fixed, every case has a link, the script prints `RESULT: FIXED` and exits with 0.
