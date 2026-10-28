const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    style: {setProperty(name,value) {this[name]=value;}}, dataset: {}, classList: {toggle() {}}, listeners: {},
    value: id.includes('filter') ? 'all' : '', checked: id === 'board-follow',
    scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    addEventListener(name, callback) {this.listeners[name] = callback;},
    setAttribute(name, value) {this[name] = value;},
    querySelector() {return null;},
    contains() {return false;},
    getBoundingClientRect() {return {left:100,top:100,bottom:200,width:100,height:280};},
  });
  return elements.get(id);
}
const context = vm.createContext({
  document: {getElementById: element, body: {classList: {toggle() {}}}},
  window:{innerWidth:1200,innerHeight:900}, clearTimeout() {},
  structuredClone, fetch: () => new Promise(() => {}),
  AbortSignal: {timeout: () => null}, setTimeout() {}, setInterval() {}, assert,
});
const code = fs.readFileSync(path.join(root, 'static/app.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'static/whiteboard.js'), 'utf8');
new vm.Script(code).runInContext(context);
const checks = `
const sample = {
  status:'running', started_at:1, finished_at:null, rounds:[], error:null,
  clients:[0,1,2,3,4].map(id=>({id,round:0,accuracy:null,loss:null,exit_code:null})),
  received:{},events:[],logs:[],
};
render(sample);
assert.equal($('board-empty').hidden,false);
assert.equal($('board-nodes').innerHTML,'');
assert.equal(new Set(Object.values(SERVICE_COLORS)).size,7);
const events = [
  {seq:1,time:1,source:'server',kind:'service_started',pid:100,message:'iniciado'},
  {seq:2,time:2,source:'server',kind:'server_ready',message:'disponível'},
  {seq:3,time:3,source:'client-0',kind:'service_started',pid:101,message:'iniciado'},
  {seq:5,time:5,source:'server',kind:'update_received',cid:0,round:1,message:'recebida'},
  {seq:7,time:7,source:'client-0',kind:'update_accepted',cid:0,round:1,accuracy:.75,loss:.5,message:'aceita'},
  {seq:8,time:8,source:'server',kind:'round_consolidated',round:1,message:'consolidada'},
  {seq:9,time:9,source:'client-0',kind:'service_stopped',exit_code:0,message:'fim'},
];
sample.events=events;
sample.logs=[
  {seq:4,time:4,source:'server',message:'Cliente 0: atualização recebida na rodada 1'},
  {seq:6,time:6,source:'client-0',message:'<script>alert(1)</script>'},
  {seq:10,time:10,source:'client-1',message:'outro cliente'},
];
assert.equal(Object.keys(boardProjection(sample,1).services).length,1);
assert.equal(Object.keys(boardProjection(sample,3).connections).length,0);
assert.equal(boardProjection(sample,4).connections['client-0'].accepted,false);
assert.equal(boardProjection(sample,5).connections['client-0'].accepted,true);
const reordered = {...sample,events:[events[0],events[1],events[2],events[4],events[6],events[3]]};
assert.equal(boardProjection(reordered,6).connections['client-0'].accepted,true);
assert.equal(boardProjection(reordered,6).services['client-0'].status,'Finalizado');
render(sample);
assert.ok($('board-edges').innerHTML.includes(SERVICE_COLORS['client-0']));
assert.ok($('board-edges').innerHTML.includes('ack-line'));
assert.ok($('board-nodes').innerHTML.includes('Finalizado'));
assert.ok($('board-logs').innerHTML.includes('&lt;script&gt;'));
assert.ok(!$('board-logs').innerHTML.includes('<script>'));
showServiceTooltip('client-0',{left:200,top:100,bottom:200,width:100});
assert.equal($('service-tooltip').hidden,false);
assert.equal($('tooltip-service').textContent,'Cliente 0');
assert.ok($('tooltip-logs').innerHTML.includes('&lt;script&gt;'));
assert.ok(!$('tooltip-logs').innerHTML.includes('outro cliente'));
assert.equal(serviceTooltipRows('client-0').length,1);
assert.equal($('board-filter').value,'all');
hideServiceTooltip();
assert.equal($('service-tooltip').hidden,true);
assert.ok(serviceIllustration('server').includes('viewBox="0 0 220 165"'));
assert.equal(DEFAULT_POSITIONS.server.x,500);
selectBoardService('client-0');
assert.equal(boardLogRows(boardView()).length,2);
assert.ok(!$('board-logs').innerHTML.includes('outro cliente'));
seekBoard(0);
assert.equal($('board-nodes').innerHTML,'');
assert.equal(boardLogRows(boardView()).length,0);
seekBoard(4);
assert.equal(boardLogRows(boardView()).length,1);
assert.ok(!$('board-edges').innerHTML.includes('ack-line'));
showServiceTooltip('client-0',{left:200,top:100,bottom:200,width:100});
assert.equal(serviceTooltipRows('client-0').length,0);
assert.ok($('tooltip-logs').innerHTML.includes('Aguardando'));
hideServiceTooltip();
switchView('whiteboard');
assert.equal($('dashboard-content').hidden,true);
assert.equal($('whiteboard-content').hidden,false);
switchView('dashboard');
assert.equal($('dashboard-content').hidden,false);
renderWhiteboard({...sample,started_at:2,events:[],logs:[]});
assert.equal(boardLive,true);
assert.equal(boardSelected,'all');
assert.equal($('board-empty').hidden,false);
`;
new vm.Script(checks).runInContext(context);
console.log('Lousa: sequência, vazio inicial, conexões, cores, filtros, replay, escape, hover de logs e troca de visão aprovados.');
