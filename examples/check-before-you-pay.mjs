// node examples/check-before-you-pay.mjs <yourWallet> <payee>
import {NewJazzCity} from 'jazzcat';
const [from, to] = process.argv.slice(2);
const r = await new NewJazzCity().sendCheck(from, to);
console.log(r.verdict, r.why);
