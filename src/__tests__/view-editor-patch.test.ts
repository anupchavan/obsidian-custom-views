import { describe, it, expect } from "vitest";
import { capturePreview, patchPreview } from "../view-editor-patch";
function content(html:string) { const el=document.createElement("div"); el.innerHTML=html; return el; }
describe("live preview reconciliation",()=>{
 it("keeps unchanged images, listeners, scroll and runtime palette while changing authored text",()=>{
  const live=content('<article data-palette="pending"><img src="movie.png"><p>Before</p></article>');
  const baseline=capturePreview(live), article=live.firstElementChild as HTMLElement, img=live.querySelector("img")!;
  article.dataset.palette="ready"; article.style.setProperty("--movie-color","red"); article.scrollTop=80;
  patchPreview(baseline,content('<article data-palette="pending"><img src="movie.png"><p>After</p></article>'));
  expect(live.querySelector("img")).toBe(img); expect(article.dataset.palette).toBe("ready");
  expect(article.style.getPropertyValue("--movie-color")).toBe("red"); expect(article.scrollTop).toBe(80);
  expect(live.querySelector("p")?.textContent).toBe("After");
 });
 it("does not move unchanged subtrees around script-created siblings",()=>{
  const live=content('<article><iframe></iframe></article>'), baseline=capturePreview(live);
  const runtime=document.createElement("canvas");live.prepend(runtime);
  const mutations:MutationRecord[]=[];const observer=new MutationObserver(records=>mutations.push(...records));observer.observe(live,{childList:true});
  patchPreview(baseline,content('<article><iframe></iframe></article>'));
  expect(observer.takeRecords()).toHaveLength(0);expect(live.firstChild).toBe(runtime);observer.disconnect();
 });

 it("updates styles without replacing content and keeps runtime classes",()=>{
  const live=content('<article class="old" style="padding:1px">Hi</article><style>p{color:red}</style>');
  let baseline=capturePreview(live); const article=live.firstElementChild as HTMLElement;
  article.classList.add("ready"); article.style.setProperty("--palette","blue");
  baseline=patchPreview(baseline,content('<article class="new" style="padding:2px">Hi</article><style>p{color:blue}</style>'));
  expect(article.className).toBe("ready new"); expect(article.style.padding).toBe("2px"); expect(article.style.getPropertyValue("--palette")).toBe("blue");
  expect(live.lastElementChild?.textContent).toBe("p{color:blue}");
  patchPreview(baseline,content('<article class="new" style="padding:3px">Hi</article><style>p{color:green}</style>'));
  expect(live.firstElementChild).toBe(article); expect(article.style.padding).toBe("3px");
 });
 it("reorders keyed elements, adds and deletes authored elements, retaining runtime content",()=>{
  const live=content('<p id="one">One</p><p id="two">Two</p>'), baseline=capturePreview(live);
  const two=live.lastElementChild; const runtime=document.createElement("canvas");live.append(runtime);
  patchPreview(baseline,content('<p id="two">Two updated</p><p id="three">Three</p>'));
  expect(live.firstElementChild).toBe(two); expect(live.querySelector("#one")).toBeNull(); expect(live.querySelector("#three")).not.toBeNull(); expect(runtime.parentNode).toBe(live);
 });
});
