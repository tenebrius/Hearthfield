import re,sys
import os
d=os.path.dirname(os.path.abspath(__file__))+'/'
s=open(d+'forager-lab.html').read()
js=re.search(r'<script>\n(.*)</script>',s,re.S).group(1)
vals=dict(re.findall(r'<input[^>]*?id="(\w+)"[^>]*?value="([^"]*)"',s))
# stateful rng
i=js.index("  function mulberry32(a) {"); j=js.index("  function gauss()")
js=js[:i]+"""  function mulberry32(seed) {
    globalThis.S = seed | 0;
    return function () {
      var a = globalThis.S; a = (a + 0x6D2B79F5) | 0; globalThis.S = a;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
"""+js[j:]
js=js.replace("inp[11 + m] = cfg.memory ? a.mem[m] : 0;","inp[11 + m] = cfg.swap ? agents[(rng() * agents.length) | 0].mem[m] : ((cfg.memory && cfg.ablate !== m) ? a.mem[m] : 0);")
assert "cfg.swap" in js
js=js.replace("mapC.addEventListener('click'","if(false)mapC.addEventListener('click'")
js=js.replace("makeWorld(seedVal());\n  for (var warm","""globalThis.__t={step:step,get agents(){return agents},cfg:cfg,get shifts(){return shifts},get shiftInfo(){return shiftInfo},get tick(){return tick},get starved(){return starved},get thirsty(){return thirsty},get born(){return born},makeWorld:makeWorld,
    snap:function(){return {food:food.slice(),kind:kind.slice(),fert:fert.slice(),agents:agents.map(function(a){var c=Object.assign({},a);c.inputs=a.inputs.slice();c.mem=a.mem.slice();return c;}),tick:tick,nextId:nextId,S:globalThis.S,archive:archive.slice(),blobs:JSON.stringify(safeBlobs)};},
    restore:function(sn,shift){food.set(sn.food);kind.set(sn.kind);fert.set(sn.fert);agents=sn.agents.map(function(a){var c=Object.assign({},a);c.inputs=a.inputs.slice();c.mem=a.mem.slice();return c;});tick=sn.tick;nextId=sn.nextId;globalThis.S=(sn.S+shift)|0;archive=sn.archive.slice();safeBlobs=JSON.parse(sn.blobs);starved=0;thirsty=0;}};
  makeWorld(4);
  for (var warm""").replace("  frame();\n})();","})();")
stub="""
const VALS=%s;
const el=(id)=>({getContext:()=>new Proxy({}, {get:()=>()=>{} ,set:()=>true}),addEventListener(){},value:(VALS[id]!==undefined?VALS[id]:'1'),style:{},textContent:'',checked:true});
globalThis.document={getElementById:(id)=>el(id),documentElement:{},querySelectorAll:()=>[],createElement:()=>el("x")};
globalThis.window={matchMedia:()=>({matches:false})};
globalThis.getComputedStyle=()=>({getPropertyValue:()=>''});
globalThis.requestAnimationFrame=()=>{};
""" % repr(vals).replace("'",'"')
open(d+'base.js','w').write(stub+js+"\nconst t=globalThis.__t; const cfg0=Object.assign({},t.cfg); const mean=a=>a.reduce((x,y)=>x+y,0)/(a.length||1);\n")
print(vals)
