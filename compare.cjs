const fs = require('fs');

const current = fs.readFileSync('src/App.tsx', 'utf8').split('\n');
const uploaded = fs.readFileSync('uploaded.tsx', 'utf8').split('\n');

for (let i = 0; i < Math.min(current.length, uploaded.length); i++) {
  if (current[i] !== uploaded[i]) {
    console.log(`Line ${i + 1}:`);
    console.log(`- ${current[i]}`);
    console.log(`+ ${uploaded[i]}`);
  }
}
