// node examples/find-paid-work.mjs
import {NewJazzCity} from 'jazzcat';
const city = new NewJazzCity();
console.log(await city.jobs());
console.log(await city.find('take a paid job'));
