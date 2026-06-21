const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourceFile = path.join(root, 'physics_quiz_database(2).html');
const dataDir = path.join(root, 'data');
const publicDir = path.join(root, 'public');
const dataFile = path.join(dataDir, 'physics_quiz_db.json');
const frontFile = path.join(publicDir, 'index.html');

const html = fs.readFileSync(sourceFile, 'utf8');
const match = html.match(/const DB=([\s\S]*?);\r?\nlet allItems/);
if (!match) throw new Error('Cannot find inline DB in source HTML.');

const db = vm.runInNewContext(`(${match[1]})`);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(dataFile, `${JSON.stringify(db, null, 2)}\n`, 'utf8');

let front = `${html.slice(0, match.index)}let DB={};\nlet allItems${html.slice(match.index + match[0].length)}`;

const loader = `async function loadDatabase(){
  try{
    document.getElementById('scoreLine').textContent='加载题库中';
    const res=await fetch('/api/db');
    if(!res.ok) throw new Error('HTTP '+res.status);
    DB=await res.json();
    initPicker();
    document.getElementById('scoreLine').textContent='未开始';
  }catch(err){
    console.error(err);
    document.getElementById('scoreLine').textContent='题库加载失败';
    alert('题库加载失败，请确认后端服务已启动。');
  }
}
`;

front = front.replace(/initPicker\(\);\s*(?=<\/script>)/, `${loader}loadDatabase();`);
fs.writeFileSync(frontFile, front, 'utf8');

console.log(`Wrote ${path.relative(root, dataFile)}`);
console.log(`Wrote ${path.relative(root, frontFile)}`);
console.log(`Chapters: ${Object.keys(db).length}`);
