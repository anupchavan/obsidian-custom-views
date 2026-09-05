// Compare converted formulas with the legacy matcher using the real Bases parser.
// Uses literal fixtures and the active file only as evaluation context; no vault writes.
const { buildSync } = require('esbuild');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const bundle = buildSync({
  stdin: { contents: 'export {toBasesFilter} from "./src/native-filters/convert"; export {checkRules} from "./src/matcher";', resolveDir: path.resolve(__dirname, '..') },
  minify: true, bundle: true, write: false, format: 'iife', globalName: 'cvListProbe', platform: 'browser',
}).outputFiles[0].text;
const code = bundle + `
window.cvListProof=null;
window.cvListProof=(()=>{
  const api=app.plugins.plugins['custom-views'].nativeRules.api;
  const file=app.workspace.activeLeaf.view.file;
  const fixtures=[
    [3,'2'], ['3','2'], [' 3 ','2'], ['3x','2'], ['Infinity','2'],
    ['0x10','16'], ['0b10','2'], ['2e2','200'], [null,'0'], [false,'0'], [[], '0'],
    [3,'bad'], [3,'Infinity'], ['1e999','2'], ['-Infinity','2'],
    [1e21,'1e21'], [1e-7,'1e-7'], ['1e21','1e21'],
    [['b','a'],'a,b'], [['a','a'],'a,b'], [['a','a'],'a,a'],
    [['a','b','a'],'a,a,b'], [[], ''], [['a'],''],
    [[2,1],'1,2'], [[true,false],'false,true'],
    [['[[Movies|Films]]'],'[[Movies|Films]]'],
    ['a','a'], ['Alpha','a'], ['Alpha','A'], ['Alpha','ha'], ['', ''], [0,'0'], [true,'true'], [' ',''], [null,''], [false,'false'],
    [[null],'null'], [[null,'a'],'null,a'], [[null],''], [[''],''], [false,'False'],
    [['science fiction','drama'],'fiction'], [['science fiction','drama'],'fiction,dr'],
    [['science fiction','drama'],'fiction,comedy'], [['ab'],'a,b'], [['a','b'],'a'], [[1],'1'], [1,'1'],
    ['science fiction','fiction'], [['Fiction'],'fiction'], [['fiction'],'Fiction'],
    [['a.*b'],'a.*'], [['abcd'],'a.*'], [123,'2'], [null,'missing'],
    [['He said \"hi\"'],'\"hi\"'],
  ];
  const rows=[];
  for(const [value,query] of fixtures) for(const operator of ['=','≠','<','≤','>','≥','is empty','is not empty','starts with','does not start with','ends with','does not end with','is','is not','is exactly','is not exactly','contains','does not contain','contains any of','does not contain any of','contains all of','does not contain all of']){
    const rules={type:'group',operator:'AND',conditions:[{type:'filter',field:'fixture',operator,value:query}]};
    const converted=cvListProbe.toBasesFilter(app,rules).and[0];
    const literal=value=>Array.isArray(value)?'['+value.map(literal).join(',')+']':
      typeof value==='number'&&/e/i.test(String(value))?'number('+JSON.stringify(String(value))+')':JSON.stringify(value);
    const formula=converted.split('note["fixture"]').join('('+literal(value)+')');
    const expected=cvListProbe.checkRules(app,rules,file,{fixture:value});
    try {
      const parsed=api.parse(formula).filters;
      const actual=api.test(parsed,file);
      rows.push({value,query,operator,expected,actual,error:parsed.hasError()});
    } catch (error) { rows.push({value,query,operator,expected,error:String(error)}); }
  }
  return JSON.stringify({checked:rows.length,failures:rows.filter(row=>row.error||row.expected!==row.actual)});
})()`;
execFileSync('obsidian',['vault=obsidian-custom-views','eval','code='+code],{encoding:'utf8'});
const output=execFileSync('obsidian',['vault=obsidian-custom-views','eval','code=window.cvListProof'],{encoding:'utf8'});
process.stdout.write(output);
const result=JSON.parse(output.slice(output.indexOf('=> ')+3));
if(result.failures.length) process.exitCode=1;
