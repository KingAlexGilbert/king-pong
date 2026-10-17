import {chromium} from 'playwright';
import {homepageBrowserChecks} from './homepage-browser-checks.mjs';

const browser = await chromium.launch({args: ['--no-sandbox']});
try {
  await homepageBrowserChecks({browser, pass: message => console.log('PASS: ' + message)});
} finally {
  await browser.close();
}
