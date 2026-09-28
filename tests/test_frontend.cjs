const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup() {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, {textContent:'', innerHTML:'', value:'', disabled:false, hidden:false, dataset:{}, attributes:{}, setAttribute(name,value){this.attributes[name]=value}, classList:{add(){},remove(){},toggle(){}}});
    return elements.get(id);
  };
  const ctx = vm.createContext({document:{getElementById:el, querySelectorAll:()=>[], addEventListener(){}},
    isAdmin:()=>true, getToken:()=> 'test', WebSocket:{OPEN:1}, setInterval:()=>0, clearInterval(){},
    setTimeout:()=>0, clearTimeout(){}, Date, console, GameLogger:{addLog(){},addSystem(){}},
    PokerAdvisor:{update(){},invalidate(){},setConnected(){}},
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
test('top controls collapse and expand with an accessible toggle',()=>{
  const html=fs.readFileSync('static/index.html','utf8');
  assert.match(html,/id="navbarToggle"[^>]*aria-controls="navbarControls"[^>]*aria-expanded="true"/);
  const {run,el}=setup();
  run('toggleNavbarControls()');
  assert.equal(el('navbarControls').hidden,true);
  assert.equal(el('navbarToggle').attributes['aria-expanded'],'false');
  assert.match(el('navbarToggle').textContent,/展开/);
  run('toggleNavbarControls()');
  assert.equal(el('navbarControls').hidden,false);
  assert.equal(el('navbarToggle').attributes['aria-expanded'],'true');
  assert.match(el('navbarToggle').textContent,/收起/);
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

function feedbackTable() {
  const root={innerHTML:''};
  const timers=[];
  const ctx=vm.createContext({document:{createElement:()=>({getContext:()=>null})}, AvatarRenderer:{drawAvatar(){}},
    Date, setTimeout:(fn)=>{timers.push(fn);return timers.length;}, clearTimeout(){}});
  vm.runInContext(fs.readFileSync('static/js/table_view.js','utf8'),ctx);
  ctx.root=root;
  const run=code=>vm.runInContext(code,ctx);
  run("PokerTable.init(root); PokerTable.updateState({stage:'preflop',hand_number:1,players:[{id:'a',name:'小狐狸',chips:900,hand:[]},{id:'b',name:'我',player_type:'human',chips:900,hand:[]}]})");
  return {root,run,timers};
}
test('action reminders survive state refresh and use a precise raise-to label',()=>{
  const {root,run}=feedbackTable();
  run("PokerTable.showAction({player:{id:'a',name:'小狐狸'},action:'raise',amount:300}); PokerTable.updateState({...PokerTable.state,pot:500,thinking_player_id:'b'})");
  assert.match(root.innerHTML,/加注至 300/);
  assert.match(root.innerHTML,/刚刚行动/);
  assert.match(root.innerHTML,/has-recent-action/);
  run("PokerTable.updateState({...PokerTable.state,hand_number:2})");
  assert.doesNotMatch(root.innerHTML,/加注至 300/);
});
test('a later action by the same player is not erased by the older timer',()=>{
  const {root,run,timers}=feedbackTable();
  run("PokerTable.showAction({player:{id:'a',name:'小狐狸'},action:'call',amount:100})");
  run("PokerTable.showAction({player:{id:'a',name:'小狐狸'},action:'raise',amount:300})");
  timers[0]();
  assert.match(root.innerHTML,/加注至 300/);
  timers[1]();
  assert.doesNotMatch(root.innerHTML,/has-recent-action/);
});
test('result view shows every split-pot winner and restores from a snapshot',()=>{
  const {root,run}=feedbackTable();
  run(`PokerTable.updateState({...PokerTable.state,stage:'hand_complete',hand_result:{hand_number:1,winners:[
    {player:{id:'a',name:'<小狐狸>'},amount:600,hand_rank:'同花'},
    {player:{id:'b',name:'我'},amount:400,hand_rank:'顺子'}]}})`);
  assert.match(root.innerHTML,/本手结算/);
  assert.match(root.innerHTML,/&lt;小狐狸&gt;/);
  assert.match(root.innerHTML,/600/);
  assert.match(root.innerHTML,/400/);
  assert.match(root.innerHTML,/同花/);
  assert.equal((root.innerHTML.match(/is-winner/g)||[]).length,2);
  run("PokerTable.updateState({...PokerTable.state,stage:'preflop',hand_number:2,hand_result:null})");
  assert.doesNotMatch(root.innerHTML,/hand-result/);
});

test('resuming settlement clears paused UI before the next hand starts',()=>{
  const {run}=setup();
  run("PokerTable.state={is_paused:true,stage:'hand_complete',players:[]}; handleGameEvent({type:'game_resumed',data:{}}); handleGameEvent({type:'hand_start',data:{hand_number:2}})");
  assert.equal(run('PokerTable.state.is_paused'),false);
});

test('round changes remove old reminders and label subsequent actions with their street',()=>{
  const {root,run}=feedbackTable();
  run("PokerTable.showAction({player:{id:'a',name:'小狐狸',last_action:'CALL'},action:'call',amount:200,stage:'preflop'})");
  assert.match(root.innerHTML,/翻前 · 跟注 200/);
  run("PokerTable.updateState({...PokerTable.state,stage:'flop',players:PokerTable.state.players.map(p=>({...p,last_action:'',current_bet:0}))})");
  assert.doesNotMatch(root.innerHTML,/跟注 200/);
  assert.match(root.innerHTML,/翻牌 · 等待玩家行动/);
  run("PokerTable.showAction({player:{id:'a',name:'小狐狸',last_action:'CHECK'},action:'check',amount:0,stage:'flop'})");
  assert.match(root.innerHTML,/翻牌 · 过牌/);
  assert.doesNotMatch(root.innerHTML,/翻前 · 跟注/);
});

test('a human raise does not change the opponent action',()=>{
  const {root,run}=feedbackTable();
  run("PokerTable.showAction({player:{id:'a',name:'小狐狸',last_action:'CALL'},action:'call',amount:100,stage:'preflop'}); PokerTable.showAction({player:{id:'b',name:'我',last_action:'RAISE'},action:'raise',amount:300,stage:'preflop'})");
  const opponent=root.innerHTML.match(/<article[^>]*>[\s\S]*?<\/article>/)[0];
  assert.match(opponent,/翻前 · 跟注 100/);
  assert.doesNotMatch(opponent,/加注/);
});

test('new model form defaults to DeepSeek while edits preserve the saved provider',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(fs.readFileSync('static/js/model_panel.js','utf8'),ctx);
  const run=code=>vm.runInContext(code,ctx);
  run('ModelPanel._renderForm=function(data){this.form=data}; ModelPanel.showAddForm()');
  assert.equal(run('ModelPanel.form.base_url'),'https://api.deepseek.com');
  assert.equal(run('ModelPanel.form.model_name'),'deepseek-v4-pro');
  assert.equal(run('ModelPanel.form.api_key'),'');
  run("ModelPanel.models=[{id:'existing',base_url:'https://example.invalid/v1',model_name:'custom'}]; ModelPanel.showEditForm('existing')");
  assert.equal(run('ModelPanel.form.model_name'),'custom');
});

test('status notices expire so they do not cover the analysis panel',()=>{
  const {run,el,ctx}=setup();
  const timers=[];
  ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  run("showNotice('已入座')");
  assert.equal(timers.length,1);
  timers[0]();
  assert.equal(el('tableNotice').textContent,'');
});

test('bilingual seat positions and first/current actors are explicit',()=>{
  const html=tableView({stage:'preflop',first_actor_id:'me',thinking_player_id:'sb',
    seat_positions:{me:'BTN/SB',sb:'BB',co:'CO'},players:[
      {id:'me',name:'我',player_type:'human',hand:[]},
      {id:'sb',name:'小狐狸',hand:[]},{id:'co',name:'老陈',hand:[]}]});
  for(const label of ['BTN 庄家','SB 小盲','BB 大盲','CO 截止位','本轮先行动','现在行动']) assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/action-order|aria-label="行动顺序"/);
  const finished=tableView({stage:'hand_complete',first_actor_id:'me',players:[{id:'me',name:'我',hand:[]}]});
  assert.doesNotMatch(finished,/本轮先行动/);
});

test('table drawer opens on demand and closes without submitting a game action',()=>{
 const {run,el}=setup();
 run('PokerAdvisor.open=true; PokerAdvisor._paint=()=>{}; openTablePanel("log")');
 assert.equal(el('tableSidePanel').dataset.open,'true');
 assert.equal(run('PokerAdvisor.open'),false);
 run('closeTablePanel()');
 assert.equal(el('tableSidePanel').dataset.open,'false');
});

test('records and settings have distinct drawer titles and navigation modes',()=>{
 const {run,el}=setup();
 run('PokerAdvisor._paint=()=>{}; ModelPanel={loadModels:()=>Promise.resolve()}; ConfigPanel={render(){}}; openTablePanel("players")');
 assert.equal(el('tableSidePanel').dataset.mode,'settings');
 assert.equal(el('tablePanelTitle').textContent,'设置');
 run('openTablePanel("log")');
 assert.equal(el('tableSidePanel').dataset.mode,'records');
 assert.equal(el('tablePanelTitle').textContent,'牌局记录');
});

test('drawer starts below the navigation so its entry buttons remain clickable',()=>{
 const {run,el}=setup();
 el('tableSidePanel').style={setProperty(key,value){this[key]=value}};
 run('document.querySelector=()=>({getBoundingClientRect:()=>({bottom:164})}); PokerAdvisor._paint=()=>{}; openTablePanel("log")');
 assert.equal(el('tableSidePanel').style['--drawer-top'],'164px');
});
