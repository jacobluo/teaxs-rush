const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const state={is_running:true,stage:'flop',hand_number:1,pot:200,pending_human_action:{request_id:'one'},players:[
  {id:'me',player_type:'human',hand:[{rank:'A',suit:'♠'},{rank:'K',suit:'♥'}],chips:900,current_bet:0,total_bet:100},
  {id:'bot',chips:900,current_bet:0,total_bet:100}]};
const stats={position_id:'one',is_turn:true,win_probability:.6,tie_probability:.1,equity:.65,call_cost:0,win_interval:[.57,.63],current_hand:'高牌 A',pot_odds:0,eligible_pot:200,improvement_probability:.4,improvements:[],threats:[],samples:2000,opponents:1,assumptions:'随机范围'};
function setup(){
 const elements=new Map(), timers=[], requests=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{dataset:{},hidden:false,disabled:false,textContent:'',innerHTML:'',setAttribute(){},appendChild(child){child.parentElement=this;}});return elements.get(id)};
 const media={matches:true,addEventListener(type,fn){this.change=fn;}};
 const ctx=vm.createContext({matchMedia:()=>media,document:{getElementById:el},isAdmin:()=>true,AbortController,
  setTimeout(fn){timers.push(fn);return timers.length},clearTimeout(){},
  authFetch(url,options){return new Promise(resolve=>requests.push({url,options,resolve}))}});
 vm.runInContext(fs.readFileSync('static/js/advisor.js','utf8'),ctx);
 const run=code=>vm.runInContext(code,ctx);
 const answer=(index,data,status=200)=>requests[index].resolve({ok:status===200,status,json:async()=>data});
 return {run,el,timers,requests,answer,media};
}
test('statistics load automatically but AI advice only runs on demand',async()=>{
 const a=setup();a.run(`PokerAdvisor.update(${JSON.stringify(state)})`);
 const loading=a.timers.pop()();a.answer(0,stats);await loading;
 assert.equal(a.requests.length,1);assert.match(a.el('analysisMetrics').innerHTML,/60.0%/);
 const advice=a.run('PokerAdvisor.requestAdvice()');a.answer(1,{position_id:'one',action:'check',reasoning:'观察对手'});await advice;
 assert.equal(a.requests[1].url,'/api/game/advice');assert.match(a.el('analysisAdvice').textContent,/观察对手/);
});
test('late statistics cannot overwrite a newer position',async()=>{
 const a=setup();a.run(`PokerAdvisor.update(${JSON.stringify(state)})`);const old=a.timers.pop()();
 a.run(`PokerAdvisor.update(${JSON.stringify({...state,pot:300})})`);const fresh=a.timers.pop()();
 a.answer(1,{...stats,position_id:'two',win_probability:.3});await fresh;
 a.answer(0,stats);await old;
 assert.equal(a.run('PokerAdvisor.stats.position_id'),'two');assert.match(a.el('analysisMetrics').innerHTML,/30.0%/);
});
test('public card changes invalidate advice even when the stage is unchanged',async()=>{
 const a=setup();a.run(`PokerAdvisor.update(${JSON.stringify(state)})`);
 const loading=a.timers.pop()();a.answer(0,stats);await loading;
 a.run(`PokerAdvisor.update(${JSON.stringify({...state,community_cards:[{rank:'Q',suit:'♠'},{rank:'J',suit:'♠'},{rank:'2',suit:'♥'}]})})`);
 assert.equal(a.run('PokerAdvisor.stats'),null);
 assert.equal(a.timers.length,1);
});
test('a pending AI reply is discarded immediately after a game action',async()=>{
 const a=setup();a.run(`PokerAdvisor.update(${JSON.stringify(state)})`);const loading=a.timers.pop()();a.answer(0,stats);await loading;
 const advice=a.run('PokerAdvisor.requestAdvice()');a.run('PokerAdvisor.invalidate()');
 a.answer(1,{position_id:'one',action:'raise',amount:300,reasoning:'过期建议'});await advice;
 assert.equal(a.run('PokerAdvisor.advice'),null);assert.doesNotMatch(a.el('analysisAdvice').textContent,/过期建议/);
});
test('AI failure preserves statistics and allows retry without submitting a poker action',async()=>{
 const a=setup();a.run(`PokerAdvisor.update(${JSON.stringify(state)})`);const loading=a.timers.pop()();a.answer(0,stats);await loading;
 const one=a.run('PokerAdvisor.requestAdvice()');const duplicate=a.run('PokerAdvisor.requestAdvice()');
 assert.equal(a.requests.length,2);a.answer(1,{detail:'模型暂不可用'},502);await one;await duplicate;
 assert.equal(a.run('PokerAdvisor.stats.equity'),.65);assert.equal(a.el('analysisAsk').disabled,false);
 assert.match(a.el('analysisAdvice').textContent,/模型暂不可用/);
});

test('analysis stays in its left drawer on desktop and mobile without repeating a model request',async()=>{
 const a=setup();a.run('PokerAdvisor.init()');
 assert.equal(a.el('analysisDetails').parentElement,a.el('analysisDrawer'));
 a.run(`PokerAdvisor.update(${JSON.stringify(state)})`);
 const loading=a.timers.pop()();a.answer(0,stats);await loading;
 const advice=a.run('PokerAdvisor.requestAdvice()');a.answer(1,{position_id:'one',action:'check',reasoning:'保留的建议'});await advice;
 a.media.matches=false;a.run('PokerAdvisor.init()');
 assert.equal(a.el('analysisDetails').parentElement,a.el('analysisDrawer'));
 assert.match(a.el('analysisAdvice').textContent,/保留的建议/);
 assert.equal(a.requests.length,2);
 a.run('PokerAdvisor.toggle()');assert.equal(a.el('analysisDetails').hidden,true);
});
test('ending a human hand closes detached analysis details',()=>{
 const a=setup();a.run('PokerAdvisor.open=true; PokerAdvisor.update({stage:"hand_complete",players:[]})');
 assert.equal(a.el('analysisDetails').hidden,true);
});
