const fs = require('fs');
const current = fs.readFileSync('src/App.tsx', 'utf8');
const uploaded = fs.readFileSync('uploaded.tsx', 'utf8');

const getClasses = (str) => {
  const regex = /className=\{?(?:["'](.*?)["']|`(.*?)`)\}?/g;
  let match;
  const classes = [];
  while ((match = regex.exec(str)) !== null) {
    classes.push(match[1] || match[2]);
  }
  return classes;
};

const currClasses = getClasses(current);
const upClasses = getClasses(uploaded);

console.log('Current classes count:', currClasses.length);
console.log('Uploaded classes count:', upClasses.length);

for (let i = 0; i < Math.min(currClasses.length, upClasses.length); i++) {
  if (currClasses[i] !== upClasses[i]) {
    console.log('Diff at index', i, ':\n-', currClasses[i], '\n+', upClasses[i]);
  }
}
