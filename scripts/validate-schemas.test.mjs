import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateSchemas } from "./validate-schemas.mjs";

async function fixtureDirectory(name = "schemas") {
  const root = await mkdtemp(join(tmpdir(), "agent-markdown-schema-test-"));
  const directory = join(root, name);
  await mkdir(directory);
  return directory;
}

async function writeSchema(directory, basename, value) {
  await writeFile(join(directory, basename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function schema(id, extra = {}) {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: id,
    type: "object",
    additionalProperties: false,
    ...extra,
  };
}

test("validates working-tree schemas in deterministic basename order", async () => {
  const directory = await fixtureDirectory();
  await writeSchema(directory, "z.schema.json", schema("urn:agent-markdown-link:schema:z:v1"));
  await writeSchema(
    directory,
    "a.schema.json",
    schema("urn:agent-markdown-link:schema:a:v1", {
      properties: { value: { $ref: "#/definitions/value" } },
      definitions: { value: { type: "string" } },
    }),
  );

  await assert.doesNotReject(async () => {
    const result = await validateSchemas({ schemaDirectory: directory });
    assert.deepEqual(result.basenames, ["a.schema.json", "z.schema.json"]);
  });
});

test("rejects duplicate product schema IDs", async () => {
  const directory = await fixtureDirectory();
  const duplicate = schema("urn:agent-markdown-link:schema:duplicate:v1");
  await writeSchema(directory, "a.schema.json", duplicate);
  await writeSchema(directory, "b.schema.json", duplicate);

  await assert.rejects(
    validateSchemas({ schemaDirectory: directory }),
    (error) => error.code === "E_SCHEMA_ID_DUPLICATE" && error.message === "E_SCHEMA_ID_DUPLICATE b.schema.json",
  );
});

test("rejects non-product and non-URN IDs without echoing them", async () => {
  const directory = await fixtureDirectory("PRIVATE_PATH_CANARY");
  const idCanary = "https://example.invalid/SECRET_ID_CANARY";
  await writeSchema(directory, "invalid.schema.json", schema(idCanary));

  await assert.rejects(validateSchemas({ schemaDirectory: directory }), (error) => {
    assert.equal(error.code, "E_SCHEMA_ID");
    assert.equal(error.message, "E_SCHEMA_ID invalid.schema.json");
    assert.doesNotMatch(error.message, /PRIVATE_PATH_CANARY|SECRET_ID_CANARY/u);
    return true;
  });
});

test("rejects malformed JSON with content-free diagnostics", async () => {
  const directory = await fixtureDirectory();
  await writeFile(join(directory, "broken.schema.json"), '{"SECRET_CONTENT_CANARY":', "utf8");

  await assert.rejects(validateSchemas({ schemaDirectory: directory }), (error) => {
    assert.equal(error.code, "E_SCHEMA_JSON");
    assert.equal(error.message, "E_SCHEMA_JSON broken.schema.json");
    assert.doesNotMatch(error.message, /SECRET_CONTENT_CANARY|Unexpected|position/u);
    return true;
  });
});

test("rejects schemas that AJV cannot compile", async () => {
  const directory = await fixtureDirectory();
  await writeSchema(
    directory,
    "invalid.schema.json",
    schema("urn:agent-markdown-link:schema:invalid:v1", { type: 42 }),
  );

  await assert.rejects(
    validateSchemas({ schemaDirectory: directory }),
    (error) => error.code === "E_SCHEMA_COMPILE" && error.message === "E_SCHEMA_COMPILE invalid.schema.json",
  );
});

test("rejects every non-fragment reference before compilation", async () => {
  const directory = await fixtureDirectory();
  await writeSchema(
    directory,
    "remote.schema.json",
    schema("urn:agent-markdown-link:schema:remote:v1", {
      properties: { secret: { $ref: "https://example.invalid/SECRET_REF_CANARY" } },
    }),
  );

  await assert.rejects(validateSchemas({ schemaDirectory: directory }), (error) => {
    assert.equal(error.code, "E_SCHEMA_REF_REMOTE");
    assert.equal(error.message, "E_SCHEMA_REF_REMOTE remote.schema.json");
    assert.doesNotMatch(error.message, /SECRET_REF_CANARY|https:/u);
    return true;
  });
});

test("rejects an empty schema directory with a stable discovery code", async () => {
  const directory = await fixtureDirectory();
  await assert.rejects(
    validateSchemas({ schemaDirectory: directory }),
    (error) => error.code === "E_SCHEMA_DISCOVERY" && error.message === "E_SCHEMA_DISCOVERY",
  );
});
