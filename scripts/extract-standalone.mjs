import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const source = path.join(root, "Bordeaux (standalone).html");
