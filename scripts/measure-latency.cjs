// Run against the development vault with Obsidian's CLI. No note contents are changed.
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex < 0 ? null : process.argv[outputIndex + 1];
if (outputIndex >= 0 && (!outputPath || outputPath.startsWith('--'))) throw new Error('--output requires a filename');
const code = `(async () => {
const p = app.plugins.plugins['custom-views'];
if (${process.argv.includes('--cold-palette') || process.argv.includes('--reset-memory')}) {
window.__cvPaletteCache?.clear();
window.__cvMoviePalettes?.clear();
}
if (${process.argv.includes('--cold-palette')}) {
window.localStorage.removeItem('custom-views:movie-palettes:64-v1');
}
const rows = window.__cvLatency = []; window.__cvLatencyDone = false; window.__cvLatencyError = null;
const paths = ['Movies/Interstellar.md','Movies/Monster.md','Movies/Oppenheimer.md','Movies/The Amazing Spider-Man 2.md'];
if (app.workspace.getActiveFile()?.path === paths[0]) await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(paths[paths.length-1]));
for (let round=0; round<3; round++) for (const path of paths) {
  await new Promise(r=>setTimeout(r,600));
  const el = document.querySelector('.nav-file-title[data-path="'+path+'"]');
  if (!el) throw new Error('Sidebar item missing: '+path);
  const start = performance.now();
  let opened, rendered, palette, paletteAtFirstPaint;
  const frames = [];
  const ref = app.workspace.on('file-open', f => {if(f?.path===path) opened=performance.now()-start;});
  el.dispatchEvent(new MouseEvent('click',{bubbles:true}));
  await new Promise(resolve => {
    const tick=()=>{
      const v=app.workspace.activeLeaf.view;
      const c=v.contentEl;
      const overlay=c.querySelector('.obsidian-custom-view-render');
      if (${process.argv.includes('--frames')}) {
        const visible = el => {
          if (!el || !el.getClientRects().length) return false;
          for(let node=el; node && node.nodeType===1; node=node.parentElement) {
            const s=getComputedStyle(node);
            if(s.display==='none' || s.visibility==='hidden' || Number(s.opacity)===0) return false;
          }
          return true;
        };
        const ready = visible(overlay) && !overlay.classList.contains('obsidian-custom-view-pending');
        frames.push({at:performance.now()-start,stage:document.querySelector('.cv-navigation-snapshot')||document.documentElement.hasAttribute('data-cv-navigation-held')?'held':ready?(c.getAttribute('data-cv-file-path')===path?'custom':'previous-custom'):visible(c.querySelector('.markdown-source-view'))||visible(c.querySelector('.markdown-preview-view'))?'native':'blank'});
      }
      if(v.file?.path===path && overlay && !overlay.classList.contains('obsidian-custom-view-pending') && c.getAttribute('data-cv-file-path')===path && !document.documentElement.hasAttribute('data-cv-navigation-held') && !document.querySelector('.cv-navigation-snapshot')){
        if (rendered === undefined) paletteAtFirstPaint = !!overlay.querySelector('#flexoki-palette');
        rendered ??= performance.now()-start;
        if(overlay.querySelector('#flexoki-palette')) palette ??= performance.now()-start;
      }
      if(palette!==undefined || performance.now()-start>5000) resolve(); else requestAnimationFrame(tick);
    }; requestAnimationFrame(tick);
  });
  app.workspace.offref(ref);
  rows.push({round,path,opened,rendered,palette,paletteAtFirstPaint,...(${process.argv.includes('--frames')}?{frames}:{})});
}
window.__cvLatencyDone = true; return JSON.stringify(rows);
})().catch(error => {window.__cvLatencyError = String(error); window.__cvLatencyDone = true;})`;
execFileSync('obsidian',['vault=obsidian-custom-views','eval','code='+code],{encoding:'utf8',timeout:120000});
const read = () => execFileSync('obsidian',['vault=obsidian-custom-views','eval','code=JSON.stringify({done:window.__cvLatencyDone,error:window.__cvLatencyError,rows:window.__cvLatency})'],{encoding:'utf8'});
(async()=>{
  for(let i=0;i<90;i++) {
    await new Promise(r=>setTimeout(r,1000));
    const out=read();
    if(!out.includes('"done":true')) continue;
    const data=JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}')+1));
    if(data.error) throw new Error(data.error);
    if(data.rows.length !== 12 || data.rows.some(row => row.rendered === undefined || row.palette === undefined)) {
      throw new Error('A note failed to render its custom view and palette within five seconds: '+JSON.stringify(data.rows));
    }
    const report=JSON.stringify(data, null, 2)+'\n';
    if(outputPath) fs.writeFileSync(outputPath, report);
    console.log(report);
    return;
  }
  throw new Error('Latency measurement timed out');
})().catch(error=>{console.error(error);process.exitCode=1;});
