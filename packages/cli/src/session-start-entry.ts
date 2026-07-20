#!/usr/bin/env node

import { sessionStartMain } from "./session-start.js";

process.exitCode = await sessionStartMain({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
});
