import 'reflect-metadata';
import { All, Controller, Get, Module, Param } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiDefaultGetter, ApiOkResponse, ApiProperty, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// Plain JavaScript, so the decorators are applied by hand
const decorateProperty = (target, key, ...decorators) => Reflect.decorate(decorators, target.prototype, key);
const decorateMethod = (target, key, ...decorators) =>
  Reflect.defineProperty(
    target.prototype,
    key,
    Reflect.decorate(decorators, target.prototype, key, Reflect.getOwnPropertyDescriptor(target.prototype, key)),
  );
const decorateParam = (target, key, index, decorator) => decorator(target.prototype, key, index);

// GET /pets/:id answers a Pet; its `ownerId` links to the default getter of Owner
const buildApp = (getterRoute, inherited) => {
  class Owner {}
  decorateProperty(Owner, 'id', ApiProperty({ type: String }));
  class Pet {}
  decorateProperty(Pet, 'id', ApiProperty({ type: String }));
  decorateProperty(Pet, 'ownerId', ApiProperty({ type: String, link: () => Owner }));

  class OwnerGetter {
    getOwner(id) {}
  }
  decorateParam(OwnerGetter, 'getOwner', 0, Param('id'));
  decorateMethod(OwnerGetter, 'getOwner', ApiDefaultGetter(Owner, 'id'), getterRoute);

  // The getter is declared in the controller itself, or in a base class
  let OwnersController = OwnerGetter;
  if (inherited) {
    OwnersController = class OwnersController extends OwnerGetter {};
  } else {
    Object.defineProperty(OwnersController, 'name', { value: 'OwnersController' });
  }
  Controller('owners')(OwnersController);

  class PetsController {
    getPet(id) {}
  }
  decorateParam(PetsController, 'getPet', 0, Param('id'));
  decorateMethod(PetsController, 'getPet', Get(':id'), ApiOkResponse({ type: Pet }));
  Controller('pets')(PetsController);

  class AppModule {}
  Module({ controllers: [OwnersController, PetsController] })(AppModule);
  return AppModule;
};

const cases = [
  ['@Get(":id") (control)', Get(':id'), false],
  ['@Get([":id", "by-id/:id"])', Get([':id', 'by-id/:id']), false],
  ['@All(":id")', All(':id'), false],
  ['@Get(":id") in a base class', Get(':id'), true],
];

console.log('Links of GET /pets/{id} to the default getter of Owner (OwnersController.getOwner).\n');
let broken = 0;
for (const [label, route, inherited] of cases) {
  const app = await NestFactory.create(buildApp(route, inherited), { logger: false });
  const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  await app.close();
  const ownerOperations = Object.entries(document.paths)
    .filter(([path]) => path.startsWith('/owners'))
    .flatMap(([, item]) => Object.values(item).map((operation) => operation.operationId));
  const links = document.paths['/pets/{id}'].get.responses['200'].links;
  const linked = links ? Object.values(links).map((link) => link.operationId).join(', ') : 'no link';
  if (!links) broken++;
  const shown = ownerOperations.length > 2 ? `${ownerOperations.slice(0, 2).join(', ')}, ...` : ownerOperations.join(', ');
  console.log(`${label.padEnd(32)} operations: ${shown.padEnd(64)} link: ${linked}`);
}
console.log(
  broken
    ? `\nRESULT: BUG: in ${broken} of 3 cases, the document has no link to the getter.`
    : '\nRESULT: FIXED',
);
process.exitCode = broken ? 1 : 0;
