// node examples/read-a-cat.mjs 1
import {NewJazzCity} from 'jazzcat';
const city = new NewJazzCity();
const cat = await city.cat(Number(process.argv[2] || 1));
console.log(`JazzCat #${cat.cat}: wallet ${cat.identity.wallet}, held by ${cat.identity.holder}`);
