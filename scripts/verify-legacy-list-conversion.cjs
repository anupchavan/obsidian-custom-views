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
window.cvListProof=(()=>{
  const api=app.plugins.plugins['custom-views'].nativeRules.api;
  const file=app.workspace.activeLeaf.view.file;
  const fixtures=[
    [['b','a'],'a,b'], [['a','a'],'a,b'], [['a','a'],'a,a'],
    [['a','b','a'],'a,a,b'], [[], ''], [['a'],''],
    [[2,1],'1,2'], [[true,false],'false,true'],
    [['[[Movies|Films]]'],'[[Movies|Films]]'],
    ['a','a'], [null,''], [false,'false'],
  ];
  const rows=[];
  for(const [value,query] of fixtures) for(const operator of ['is exactly','is not exactly']){
    const rules={type:'group',operator:'AND',conditions:[{type:'filter',field:'fixture',operator,value:query}]};
    const converted=cvListProbe.toBasesFilter(app,rules).and[0];
    const formula=converted.split('note["fixture"]').join('('+JSON.stringify(value)+')');
    const parsed=api.parse(formula).filters;
    const expected=cvListProbe.checkRules(app,rules,file,{fixture:value});
    const actual=api.test(parsed,file);
    rows.push({value,query,operator,expected,actual,error:parsed.hasError()});
  }
  return JSON.stringify({checked:rows.length,failures:rows.filter(row=>row.error||row.expected!==row.actual)});
})()`;
execFileSync('obsidian',['vault=obsidian-custom-views','eval','code='+code],{encoding:'utf8'});
const output=execFileSync('obsidian',['vault=obsidian-custom-views','eval','code=window.cvListProof'],{encoding:'utf8'});
process.stdout.write(output);
const result=JSON.parse(output.slice(output.indexOf('=> ')+3));
if(result.failures.length) process.exitCode=1;
