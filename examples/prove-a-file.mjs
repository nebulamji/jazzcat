// node examples/prove-a-file.mjs <file> [<texel-output-id> <payment-tx>]
import {proveFile} from 'jazzcat/proof';
const [file, output, tx] = process.argv.slice(2);
const r = await proveFile(file, {output, tx});
console.log(r.ok ? r.says : r.why);
