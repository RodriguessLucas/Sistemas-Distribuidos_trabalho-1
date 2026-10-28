const SERVICE_COLORS = {server:'#6d4cdb','client-0':'#2563eb','client-1':'#008298','client-2':'#16834b','client-3':'#b56b06','client-4':'#ca3982',monitor:'#64748b'};
const SERVICE_NAMES = {server:'Servidor','client-0':'Cliente 0','client-1':'Cliente 1','client-2':'Cliente 2','client-3':'Cliente 3','client-4':'Cliente 4',monitor:'Monitor'};
const DEFAULT_POSITIONS = {server:{x:500,y:220},'client-0':{x:150,y:110},'client-1':{x:850,y:110},'client-2':{x:850,y:430},'client-3':{x:500,y:500},'client-4':{x:150,y:430}};
let boardData = null;
let boardRun = null;
let boardLive = true;
let boardCursor = 0;
let boardSelected = 'all';
let boardPositions = structuredClone(DEFAULT_POSITIONS);
let boardDrag = null;
let boardPlaying = false;
let boardLastLogs = '';
function serviceColor(source){return SERVICE_COLORS[source]||SERVICE_COLORS.monitor;}
function serviceName(source){return SERVICE_NAMES[source]||source;}
function boardProjection(data, count) {
  const events=data.events.slice(0,count);
  const services={};
  const connections={};
  let round=0;
  for(const event of events){
    if(event.kind==='service_started')services[event.source]={source:event.source,pid:event.pid,status:'Iniciado',round:0,exitCode:null};
    if(event.kind==='server_ready'&&services.server)services.server.status='gRPC disponível';
    if(event.kind==='service_stopped'&&services[event.source]){
      services[event.source].status=event.exit_code===0?'Finalizado':'Encerrado';
      services[event.source].exitCode=event.exit_code;
    }
    if(event.kind==='update_received'){
      const source=`client-${event.cid}`;
      const previous=connections[source];
      if(!previous||previous.round<=event.round)connections[source]={source,round:event.round,accepted:previous?.round===event.round&&previous.accepted,seq:event.seq};
      if(services[source]&&services[source].exitCode===null)services[source].status=connections[source]?.accepted?'Atualização aceita':'Atualização recebida';
    }
    if(event.kind==='update_accepted'){
      const source=`client-${event.cid}`;
      if(services[source]){
        Object.assign(services[source],{round:event.round,accuracy:event.accuracy,loss:event.loss});
        if(services[source].exitCode===null)services[source].status='Atualização aceita';
      }
      if(!connections[source]||connections[source].round<=event.round)connections[source]={source,round:event.round,accepted:true,seq:event.seq};
    }
    if(event.kind==='round_consolidated'){
      round=event.round;
      if(services.server)services.server.round=event.round;
    }
  }
  return {events,services,connections,round,last:events.at(-1)};
}
function boardView(){
  const count=boardLive?(boardData?.events.length||0):boardCursor;
  return boardProjection(boardData||{events:[]},count);
}
function boardCurve(source, offset=0){
  const start=boardPositions[source];
  const end=boardPositions.server;
  const dx=end.x-start.x,dy=end.y-start.y;
  const length=Math.max(1,Math.hypot(dx,dy));
  const shiftX=-dy/length*offset,shiftY=dx/length*offset;
  const x1=start.x+dx/length*85+shiftX,y1=start.y+dy/length*50+shiftY;
  const x2=end.x-dx/length*95+shiftX,y2=end.y-dy/length*58+shiftY;
  const bend=length*.12;
  return `M ${x1} ${y1} Q ${(x1+x2)/2-dy/length*bend} ${(y1+y2)/2+dx/length*bend} ${x2} ${y2}`;
}
function renderBoardGraph(view){
  const dim=source=>boardSelected!=='all'&&source!==boardSelected&&source!=='server';
  let edges='<defs>';
  for(const [source,color] of Object.entries(SERVICE_COLORS))edges+=`<marker id="arrow-${source}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"/></marker>`;
  edges+='</defs>';
  for(const connection of Object.values(view.connections)){
    if(!view.services[connection.source]||!view.services.server)continue;
    const selected=boardSelected==='all'||boardSelected==='server'||boardSelected===connection.source;
    const recent=boardLive&&boardData?.status==='running'&&view.last&&view.last.time>Date.now()/1000-2.5&&(view.last.cid===Number(connection.source.split('-')[1]));
    edges+=`<g class="board-edge ${selected?'':'dimmed'} ${recent?'edge-active':''}" data-source="${connection.source}"><path class="connection-line" d="${boardCurve(connection.source,-5)}" stroke="${serviceColor(connection.source)}" marker-end="url(#arrow-${connection.source})"><title>${serviceName(connection.source)} → Servidor: atualização recebida, rodada ${connection.round}</title></path>`;
    if(connection.accepted)edges+=`<path class="connection-line ack-line" d="${boardCurve(connection.source,5)}" stroke="${serviceColor('server')}" marker-start="url(#arrow-server)"><title>Servidor → ${serviceName(connection.source)}: confirmação de aceite, rodada ${connection.round}</title></path>`;
    edges+='</g>';
  }
  $('board-edges').innerHTML=edges;
  $('board-nodes').innerHTML=Object.values(view.services).map(service=>{
    const position=boardPositions[service.source];
    if(!position)return '';
    const selected=boardSelected===service.source;
    const details=service.source==='server'?`FedAvg · ${view.round}/5 consolidações`:`${service.round}/5 rodadas aceitas`;
    return `<button class="board-node ${service.source==='server'?'coordinator':''} ${selected?'selected':''} ${dim(service.source)?'dimmed':''}" data-service="${service.source}" style="left:${position.x/10}%;top:${position.y/6}%;--service-color:${serviceColor(service.source)}" aria-pressed="${selected}" aria-label="${serviceName(service.source)}: ${escapeHtml(service.status)}. Clique para filtrar logs; arraste para mover."><span class="node-heading"><span class="board-node-icon">${service.source==='server'?'⌘':'▤'}</span><span><strong>${serviceName(service.source)}</strong><small>PID ${service.pid}</small></span></span><span class="node-status">${escapeHtml(service.status)}${service.exitCode!==null?` · saída ${service.exitCode}`:''}</span><span class="node-detail">${details}</span>${service.accuracy!=null?`<span class="node-metrics">${percent(service.accuracy)} <span>acurácia local</span></span>`:''}</button>`;
  }).join('');
  $('board-empty').hidden=Object.keys(view.services).length>0;
  const count=Object.keys(view.services).length;
  $('board-summary').textContent=`${count} ${count===1?'serviço':'serviços'} · ${Object.keys(view.connections).length} conexões observadas`;
}
function boardLogRows(view){
  const cutoff=boardLive?Infinity:(view.last?.seq||0);
  return (boardData?.logs||[]).filter(log=>log.seq<=cutoff&&(boardSelected==='all'||log.source===boardSelected||(boardSelected.startsWith('client-')&&log.source==='server'&&new RegExp(`Cliente ${boardSelected.split('-')[1]}:`).test(log.message))));
}
function renderBoardLogs(view){
  const rows=boardLogRows(view);
  const key=`${boardRun}-${boardSelected}-${boardLive}-${view.last?.seq}-${rows.length}-${rows.at(-1)?.seq}`;
  if(key===boardLastLogs)return;
  boardLastLogs=key;
  const box=$('board-logs');
  const previousScroll=box.scrollTop;
  box.innerHTML=rows.length?rows.map(log=>`<div class="board-log" data-source="${escapeHtml(log.source)}" style="--service-color:${serviceColor(log.source)}"><div><time>${timestamp(log.time)}</time><span>${escapeHtml(serviceName(log.source))}</span></div><p>${escapeHtml(log.message)}</p></div>`).join(''):'<p class="board-log-empty">Nenhum log neste ponto da execução.</p>';
  if($('board-follow').checked)box.scrollTop=box.scrollHeight;
  else box.scrollTop=previousScroll;
  $('board-log-count').textContent=String(rows.length);
}
function renderWhiteboard(data){
  boardData=data;
  if(boardRun!==data.started_at){
    boardRun=data.started_at;
    boardLive=true;
    boardPlaying=false;
    boardCursor=0;
    boardLastLogs='';
    boardSelected='all';
    $('board-filter').value='all';
  }
  if(boardDrag)return;
  const view=boardView();
  renderBoardGraph(view);
  renderBoardLogs(view);
  const length=data.events.length;
  const count=boardLive?length:Math.min(boardCursor,length);
  $('board-seek').max=String(length);
  $('board-seek').value=String(count);
  $('board-mode-label').textContent=boardLive?'Acompanhando ao vivo':`Replay · evento ${count} de ${length}`;
  $('board-live').textContent=boardLive?'● Ao vivo':'◷ Replay';
  $('board-live').classList.toggle('replay',!boardLive);
  $('board-event-label').textContent=view.last?view.last.message:'Nenhum evento registrado';
  $('board-caption').textContent=boardSelected==='all'?'Linhas na cor do cliente: atualização recebida → servidor. Linhas roxas: confirmação de aceite → cliente.':`${serviceName(boardSelected)} selecionado. As cores dos logs identificam o processo de origem.`;
  $('board-prev').disabled=count===0;
  $('board-next').disabled=count>=length;
  $('board-play').disabled=length===0;
  $('board-play').textContent=boardPlaying?'Ⅱ Pausar':'▶ Replay';
  $('board-go-live').disabled=boardLive;
  $('board-clear-selection').disabled=boardSelected==='all';
  $('board-legend').innerHTML=Object.entries(SERVICE_NAMES).filter(([source])=>source!=='monitor').map(([source,name])=>`<button data-legend="${source}" class="legend-chip ${boardSelected===source?'chosen':''}" style="--service-color:${serviceColor(source)}" aria-pressed="${boardSelected===source}"><i></i>${name}</button>`).join('');
}
function selectBoardService(source){
  boardSelected=boardSelected===source?'all':source;
  $('board-filter').value=boardSelected;
  boardLastLogs='';
  if(boardData)renderWhiteboard(boardData);
}
function seekBoard(count){
  boardLive=false;
  boardPlaying=false;
  boardCursor=Math.max(0,Math.min(count,boardData?.events.length||0));
  if(boardData)renderWhiteboard(boardData);
}
function switchView(view){
  const isBoard=view==='whiteboard';
  $('whiteboard-content').hidden=!isBoard;
  $('dashboard-content').hidden=isBoard;
  document.body.classList.toggle('board-mode',isBoard);
  for(const name of ['dashboard','whiteboard']){
    $(`view-${name}`).classList.toggle('active',name===view);
    $(`view-${name}`).setAttribute('aria-selected',String(name===view));
  }
  if(boardData)renderWhiteboard(boardData);
}
$('view-dashboard').addEventListener('click',()=>switchView('dashboard'));
$('view-whiteboard').addEventListener('click',()=>switchView('whiteboard'));
$('board-filter').addEventListener('change',()=>{boardSelected=$('board-filter').value;boardLastLogs='';if(boardData)renderWhiteboard(boardData);});
$('board-follow').addEventListener('change',()=>{if($('board-follow').checked)$('board-logs').scrollTop=$('board-logs').scrollHeight;});
$('board-clear-selection').addEventListener('click',()=>{boardSelected='all';$('board-filter').value='all';if(boardData)renderWhiteboard(boardData);});
$('board-legend').addEventListener('click',event=>{const chip=event.target.closest('[data-legend]');if(chip)selectBoardService(chip.dataset.legend);});
$('board-nodes').addEventListener('click',event=>{const node=event.target.closest('[data-service]');if(node&&event.detail===0)selectBoardService(node.dataset.service);});
$('board-reset').addEventListener('click',()=>{boardPositions=structuredClone(DEFAULT_POSITIONS);if(boardData)renderWhiteboard(boardData);});
$('board-seek').addEventListener('input',()=>seekBoard(Number($('board-seek').value)));
$('board-prev').addEventListener('click',()=>seekBoard((boardLive?boardData.events.length:boardCursor)-1));
$('board-next').addEventListener('click',()=>seekBoard(boardCursor+1));
$('board-go-live').addEventListener('click',()=>{boardLive=true;boardPlaying=false;if(boardData)renderWhiteboard(boardData);});
$('board-play').addEventListener('click',()=>{
  if(boardPlaying){boardPlaying=false;}
  else{if(boardLive||boardCursor>=boardData.events.length)boardCursor=0;boardLive=false;boardPlaying=true;}
  if(boardData)renderWhiteboard(boardData);
});
setInterval(()=>{
  if(!boardPlaying||!boardData)return;
  boardCursor=Math.min(boardCursor+1,boardData.events.length);
  if(boardCursor>=boardData.events.length)boardPlaying=false;
  renderWhiteboard(boardData);
},850);
$('board-stage').addEventListener('pointerdown',event=>{
  const node=event.target.closest('[data-service]');
  if(!node||event.button!==0)return;
  boardDrag={source:node.dataset.service,startX:event.clientX,startY:event.clientY,moved:false};
  $('board-stage').setPointerCapture(event.pointerId);
});
$('board-stage').addEventListener('pointermove',event=>{
  if(!boardDrag)return;
  if(Math.hypot(event.clientX-boardDrag.startX,event.clientY-boardDrag.startY)<5&&!boardDrag.moved)return;
  boardDrag.moved=true;
  const rect=$('board-stage').getBoundingClientRect();
  boardPositions[boardDrag.source]={x:Math.max(100,Math.min(900,(event.clientX-rect.left)/rect.width*1000)),y:Math.max(75,Math.min(525,(event.clientY-rect.top)/rect.height*600))};
  renderBoardGraph(boardView());
});
function finishBoardDrag(event){
  if(!boardDrag)return;
  const drag=boardDrag;
  boardDrag=null;
  if($('board-stage').hasPointerCapture(event.pointerId))$('board-stage').releasePointerCapture(event.pointerId);
  if(drag.moved){
    const node=$('board-nodes').querySelector(`[data-service="${drag.source}"]`);
    if(node)node.dataset.dragged='true';
  }else if(event.type==='pointerup')selectBoardService(drag.source);
  if(boardData)renderWhiteboard(boardData);
}
$('board-stage').addEventListener('pointerup',finishBoardDrag);
$('board-stage').addEventListener('pointercancel',finishBoardDrag);
