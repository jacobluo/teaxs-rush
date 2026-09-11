const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {textContent:'', innerHTML:'', value:'', disabled:false, dataset:{}, classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  const ctx = vm.createContext({document:{getElementById:el, querySelectorAll:()=>[], addEventListener(){}},
    isAdmin:()=>true, getToken:()=> 'test', WebSocket:{OPEN:1}, setInterval:()=>0, clearInterval(){},
    setTimeout:()=>0, clearTimeout(){}, Date, console, GameLogger:{addLog(){},addSystem(){}},
    PokerTable:{state:null, updateState(s){this.state=s},clearReasoningBubbles(){}}});
  vm.runInContext(fs.readFileSync('static/js/app.js','utf8'),ctx);
  return {ctx,el,run:code=>vm.runInContext(code,ctx)};
}
const turn = {request_id:'one',player_name:'我',available_actions:{can_raise:true,can_call:true,to_call:50,min_raise_to:200,max_raise_to:1000}};
test('authoritative reconnect clears an expired human request',()=>{
  const {run}=setup();
  run(`pendingHumanAction=${JSON.stringify(turn)}; updateStatusFromState({stage:'flop',pending_human_action:null});`);
  assert.equal(run('pendingHumanAction'),null);
});
test('repeated state updates preserve a typed raise for the same turn',()=>{
  const {run,el}=setup();
  run(`renderHumanActionPanel(${JSON.stringify(turn)})`);
  el('humanActionControls').innerHTML='USER EDITED CONTROLS';
  run(`renderHumanActionPanel(${JSON.stringify(turn)})`);
  assert.equal(el('humanActionControls').innerHTML,'USER EDITED CONTROLS');
});
test('pause control sends resume when table is paused',()=>{
  const {run}=setup();
  run('ws={readyState:1,send(data){this.sent=JSON.parse(data)}}; PokerTable.state={is_paused:true}; sendControl("pause")');
  assert.equal(run('ws.sent.type'),'resume');
});
test('duplicate clicks submit only one action per turn',()=>{
  const {run}=setup();
  run(`pendingHumanAction=${JSON.stringify(turn)}; ws={readyState:1,count:0,send(){this.count++}}; sendHumanAction('call'); sendHumanAction('call');`);
  assert.equal(run('ws.count'),1);
});
function tableView(state) {
  const root={innerHTML:''};
  const ctx=vm.createContext({document:{createElement:()=>({getContext:()=>null})},AvatarRenderer:{drawAvatar(){}}});
  vm.runInContext(fs.readFileSync('static/js/table_view.js','utf8'),ctx);
  ctx.root=root; ctx.state=state;
  vm.runInContext('PokerTable.init(root); PokerTable.updateState(state)',ctx);
  return root.innerHTML;
}
test('responsive table identifies own cards, turn and escaped player names',()=>{
  const html=tableView({stage:'preflop',pot:150,thinking_player_id:'me',players:[
    {id:'me',name:'<我>',player_type:'human',chips:950,hand:[{rank:'A',suit:'♠'},{rank:'K',suit:'♥'}]},
    {id:'bot',name:'电脑',player_type:'ai',chips:900,hand:[]}
  ]});
  assert.match(html,/&lt;我&gt;/);
  assert.match(html,/你的手牌/);
  assert.match(html,/轮到你/);
  assert.match(html,/底牌未公开/);
  assert.match(html,/150/);
});
test('reset view removes all previous seats and shows an entry hint',()=>{
  const html=tableView({stage:'waiting'});
  assert.match(html,/入座/);
  assert.doesNotMatch(html,/class="seat /);
});
test('last actions from engine are translated on the table',()=>{
  assert.match(tableView({players:[{id:'bot',name:'电脑',chips:900,last_action:'CALL',hand:[]}]}),/跟注/);
});
