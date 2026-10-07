import fs from "fs";

export function minifyCss(css) {
  // 1. Remove comments
  let min = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // 2. Collapse whitespace
  min = min.replace(/\s+/g, " ");

  // 3. Remove space around structural tokens
  min = min.replace(/\s*([\{\}:;,>~+])\s*/g, (match, p1) => p1);

  // 4. Ensure calc/clamp/min/max keep spaces around + and - (CSS spec requirement)
  min = min.replace(/(calc|clamp|min|max)\(([^)]+)\)/g, (match, fn, inner) => {
    const fixed = inner.replace(/([0-9a-zA-Z%]+)\s*([\+\-])\s*([0-9a-zA-Z%]+)/g, "$1 $2 $3");
    return `${fn}(${fixed})`;
  });

  // 5. Remove trailing semicolons
  min = min.replace(/;}/g, "}");

  return min.trim() + "\n";
}

const input = fs.readFileSync("styles.src.css", "utf8");
const output = minifyCss(input);
fs.writeFileSync("styles.css", output, "utf8");
console.log("Minified styles.css. Size before:", Buffer.byteLength(input), "after:", Buffer.byteLength(output));
