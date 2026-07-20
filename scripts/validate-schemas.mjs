import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";

const PRODUCT_ID_PATTERN = /^urn:agent-markdown-link:schema:[a-z0-9][a-z0-9-]*:v1$/u;

export class SchemaValidationError extends Error {
  constructor(code, schemaBasename) {
    super(schemaBasename === undefined ? code : `${code} ${schemaBasename}`);
    this.name = "SchemaValidationError";
    this.code = code;
    this.schemaBasename = schemaBasename;
  }
}

function fail(code, schemaBasename) {
  throw new SchemaValidationError(code, schemaBasename);
}

function compareBasenames(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertFragmentReferences(value, schemaBasename) {
  if (Array.isArray(value)) {
    for (const item of value) assertFragmentReferences(item, schemaBasename);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string" && !child.startsWith("#")) {
      fail("E_SCHEMA_REF_REMOTE", schemaBasename);
    }
    assertFragmentReferences(child, schemaBasename);
  }
}

async function discoverBasenames(schemaDirectory) {
  let entries;
  try {
    entries = await readdir(schemaDirectory, { withFileTypes: true });
  } catch {
    fail("E_SCHEMA_DISCOVERY");
  }

  const basenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".schema.json"))
    .map((entry) => entry.name)
    .sort(compareBasenames);
  if (basenames.length === 0) fail("E_SCHEMA_DISCOVERY");
  return basenames;
}

async function readSchema(schemaDirectory, schemaBasename) {
  let source;
  try {
    source = await readFile(resolve(schemaDirectory, schemaBasename), "utf8");
  } catch {
    fail("E_SCHEMA_JSON", schemaBasename);
  }

  try {
    return JSON.parse(source);
  } catch {
    fail("E_SCHEMA_JSON", schemaBasename);
  }
}

export async function validateSchemas({ schemaDirectory = resolve(process.cwd(), "schemas") } = {}) {
  const basenames = await discoverBasenames(schemaDirectory);
  const schemas = [];
  const seenIds = new Set();

  for (const schemaBasename of basenames) {
    const schema = await readSchema(schemaDirectory, schemaBasename);
    const id = typeof schema === "object" && schema !== null ? schema.$id : undefined;
    if (typeof id !== "string" || !PRODUCT_ID_PATTERN.test(id)) {
      fail("E_SCHEMA_ID", schemaBasename);
    }
    if (seenIds.has(id)) fail("E_SCHEMA_ID_DUPLICATE", schemaBasename);
    seenIds.add(id);
    assertFragmentReferences(schema, schemaBasename);
    schemas.push({ schemaBasename, schema });
  }

  const ajv = new Ajv({ allErrors: true, jsonPointers: true, schemaId: "auto" });
  for (const { schemaBasename, schema } of schemas) {
    try {
      ajv.compile(schema);
    } catch {
      fail("E_SCHEMA_COMPILE", schemaBasename);
    }
  }

  return { basenames };
}

function isDirectExecution() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isDirectExecution()) {
  validateSchemas().catch((error) => {
    const safeError =
      error instanceof SchemaValidationError ? error : new SchemaValidationError("E_SCHEMA_COMPILE");
    process.stderr.write(`${safeError.message}\n`);
    process.exitCode = 1;
  });
}
