// Exercise the experimental hook in the real host. Does not modify note contents.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const cli = code => execFileSync('obsidian', ['vault=obsidian-custom-views','eval','code='+code], {encoding:'utf8'});
cli(`(async()=>{
  window.__cvAtomicProof = {done:false, rows:[]};
  const p=app.plugins.plugins['custom-views'];
  const leaf=app.workspace.getLeaf(false);
  const original=p._processLeaf;
  const delay=ms=>new Promise(resolve=>window.setTimeout(resolve,ms));
  const visible=el=>{
    if(!el || !el.getClientRects().length) return false;
    for(let n=el;n&&n.nodeType===1;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}
    return true;
  };
  async function check(path,state,custom,slow){
    const file=app.vault.getAbstractFileByPath(path);
    if(!file) throw new Error('Missing fixture: '+path);
    p._processLeaf=slow?async function(...args){await delay(200);return original.apply(this,args)}:original;
    let settled=false, badFrames=0, heldFrames=0;
    const pending=leaf.openFile(file,{state}).finally(()=>settled=true);
    const started=performance.now();
    while(performance.now()-started<6000){
      await new Promise(requestAnimationFrame);
      const v=leaf.view,c=v.contentEl;
      const held=!!document.querySelector('.cv-navigation-snapshot')||document.documentElement.hasAttribute('data-cv-navigation-held');
      if(held) heldFrames++;
      const overlay=c.querySelector('.obsidian-custom-view-render');
      if(custom&&v.file?.path===path&&!held&&(!visible(overlay)||overlay.classList.contains('obsidian-custom-view-pending')))badFrames++;
      if(settled&&!held&&c.getAttribute('data-cv-file-path')===path&&c.querySelectorAll('.obsidian-custom-view-render').length===(custom?1:0))break;
    }
    await pending;
    const c=leaf.view.contentEl;
    const row={path,mode:state.mode,source:state.source,slow,badFrames,heldFrames,overlays:c.querySelectorAll('.obsidian-custom-view-render').length,editors:c.querySelectorAll('.cm-editor').length,heldAfter:!!document.querySelector('.cv-navigation-snapshot'),opacity:c.style.opacity};
    window.__cvAtomicProof.rows.push(row);
    if(row.overlays!==(custom?1:0)||row.editors!==1||row.heldAfter||row.opacity==='0'||badFrames)throw new Error('Navigation invariant failed: '+JSON.stringify(row));
    p._processLeaf=original;
    await delay(250);
  }
  try{
    await check('Untitled.md',{mode:'source',source:false},false,false);
    await check('Movies/Interstellar.md',{mode:'source',source:false},true,true);
    await check('Movies/Monster.md',{mode:'source',source:false},true,true);
    await check('Music/Love and Machines/Midival Punditz – Love and Machines.md',{mode:'source',source:false},true,true);
    await check('Movies/Interstellar.md',{mode:'source',source:true},false,false);
    await check('Movies/Interstellar.md',{mode:'preview'},true,true);
    await check('Movies/Interstellar.md',{mode:'source',source:false},true,true);
    for(let round=0;round<5;round++){
    const paths=['Movies/Monster.md','Movies/Oppenheimer.md','Movies/The Amazing Spider-Man 2.md'];
    const opens=[];
    for(const path of paths){opens.push(leaf.openFile(app.vault.getAbstractFileByPath(path)));await delay(10);}
    await Promise.all(opens);await delay(250);
    const c=leaf.view.contentEl;
    const rapid={rapid:true,round,path:leaf.view.file?.path,applied:c.getAttribute('data-cv-file-path'),overlays:c.querySelectorAll('.obsidian-custom-view-render').length,editors:c.querySelectorAll('.cm-editor').length,heldAfter:!!document.querySelector('.cv-navigation-snapshot')};
    window.__cvAtomicProof.rows.push(rapid);
    if(rapid.path!==paths[2]||rapid.applied!==paths[2]||rapid.overlays!==1||rapid.editors!==1||rapid.heldAfter)throw new Error('Rapid navigation failed: '+JSON.stringify(rapid));
    }
  }catch(error){window.__cvAtomicProof.error=String(error);}
  finally{p._processLeaf=original;window.__cvAtomicProof.done=true;}
})()`);
(async()=>{
 for(let i=0;i<60;i++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  const text=cli('JSON.stringify(window.__cvAtomicProof)');
  if(!text.includes('"done":true'))continue;
  const report=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));
  fs.writeFileSync(process.argv[2] || 'docs/performance/atomic-live-checks.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
  if(report.error)process.exitCode=1;
  return;
 }
 throw new Error('Host verification timed out');
})().catch(error=>{console.error(error);process.exitCode=1});
