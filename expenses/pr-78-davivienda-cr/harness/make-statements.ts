import { readFileSync } from "node:fs";
import { parseDaviviendaStatement } from "/tmp/expenses-verify-pr78-wt/src/domain/banks/statements/davivienda-cr.ts";

const source = readFileSync("/tmp/expenses-verify-pr78-wt/src/domain/banks/statements/davivienda-cr_test.ts", "utf8");
const match = /const STATEMENT = `([\s\S]*?)`;/u.exec(source);
if (!match?.[1]) throw new Error("STATEMENT fixture not found");

const result = parseDaviviendaStatement(match[1], { idPrefix: process.argv[2] ?? "verify" });
console.log(JSON.stringify(result, null, 2));
