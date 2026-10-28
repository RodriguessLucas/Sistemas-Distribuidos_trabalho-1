const SERVICE_COLORS = {server:'#2563eb','client-0':'#7c3aed','client-1':'#008298','client-2':'#16834b','client-3':'#b56b06','client-4':'#ca3982',monitor:'#64748b'};
const SERVICE_NAMES = {server:'Servidor','client-0':'Cliente 0','client-1':'Cliente 1','client-2':'Cliente 2','client-3':'Cliente 3','client-4':'Cliente 4',monitor:'Monitor'};
const DEFAULT_POSITIONS = {server:{x:500,y:335},'client-0':{x:500,y:85},'client-1':{x:190,y:200},'client-2':{x:810,y:200},'client-3':{x:190,y:480},'client-4':{x:810,y:480}};
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
  const bend=0;
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
  if($('board-edges').innerHTML!==edges)$('board-edges').innerHTML=edges;
  const nodeMarkup=Object.values(view.services).map(service=>{
    const position=boardPositions[service.source];
    if(!position)return '';
    const selected=boardSelected===service.source;
    const details=service.source==='server'?`FedAvg · ${view.round}/5 consolidações`:`${service.round}/5 rodadas aceitas`;
    return `<button class="board-node ${service.source==='server'?'coordinator':''} ${selected?'selected':''} ${dim(service.source)?'dimmed':''}" data-service="${service.source}" style="left:${position.x/10}%;top:${position.y/6}%;--service-color:${serviceColor(service.source)}" aria-pressed="${selected}" aria-label="${serviceName(service.source)}: ${escapeHtml(service.status)}. Passe o mouse para ler os logs; clique para filtrar; arraste para mover."><span class="node-heading"><span class="board-node-icon">${serviceIllustration(service.source)}</span><span><strong>${serviceName(service.source)}</strong><small>PID ${service.pid}</small></span></span><span class="node-status">${escapeHtml(service.status)}${service.exitCode!==null?` · saída ${service.exitCode}`:''}</span><span class="node-detail">${details}</span>${service.accuracy!=null?`<span class="node-metrics">${percent(service.accuracy)} <span>acurácia local</span></span>`:''}</button>`;
  }).join('');
  if($('board-nodes').innerHTML!==nodeMarkup)$('board-nodes').innerHTML=nodeMarkup;
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
  if(hoverService)refreshServiceTooltip();
  const length=data.events.length;
  const count=boardLive?length:Math.min(boardCursor,length);
  $('board-seek').max=String(length);
  $('board-seek').value=String(count);
  $('board-mode-label').textContent=boardLive?'Acompanhando ao vivo':`Replay · evento ${count} de ${length}`;
  $('board-live').textContent=boardLive?'● Ao vivo':'◷ Replay';
  $('board-live').classList.toggle('replay',!boardLive);
  $('board-event-label').textContent=view.last?view.last.message:'Nenhum evento registrado';
  $('board-caption').textContent=boardSelected==='all'?'Setas coloridas: atualização → servidor. Setas azuis tracejadas: confirmação → cliente. Passe o mouse nos serviços para ver os logs.':`${serviceName(boardSelected)} selecionado. As cores dos logs identificam o processo de origem.`;
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
  document.body.classList.toggle('board-mode',true);
  hideServiceTooltip();
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
  hideServiceTooltip();
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
let hoverService=null;
let hoverAnchor=null;
let tooltipTimer=null;
function serviceIllustration(source){
  const start='<svg viewBox="0 0 100 100" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">';
  if(source==='server')return '<svg viewBox="0 0 220 165" aria-hidden="true"><ellipse cx="110" cy="153" rx="76" ry="6" fill="#eff5ff"/><path d="M93 129h34l6 20H87z" fill="#a8ceff"/><rect x="75" y="147" width="70" height="7" rx="3" fill="#c8dfff"/><rect x="15" y="17" width="190" height="115" rx="8" fill="#e5f0ff"/><rect x="15" y="17" width="190" height="94" rx="7" fill="#174a9a"/><rect x="23" y="25" width="174" height="79" rx="2" fill="white"/><path d="M23 25h40v79H23z" fill="#dcecff"/><circle cx="43" cy="44" r="9" fill="#7bb0f4"/><rect x="31" y="62" width="23" height="5" rx="2" fill="#90bafa"/><rect x="31" y="73" width="23" height="4" rx="2" fill="#a7cbfa"/><rect x="31" y="83" width="17" height="4" rx="2" fill="#a7cbfa"/><rect x="73" y="33" width="112" height="10" rx="4" fill="#c8dfff"/><rect x="73" y="51" width="43" height="43" rx="4" fill="#e0edff"/><path d="m79 83 9-12 8 5 12-16" stroke="#3b82f6" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="125" y="52" width="60" height="5" rx="2" fill="#b5d4ff"/><rect x="125" y="64" width="50" height="5" rx="2" fill="#c8dfff"/><rect x="125" y="76" width="54" height="5" rx="2" fill="#c8dfff"/><rect x="125" y="88" width="35" height="5" rx="2" fill="#dceaff"/><circle cx="110" cy="121" r="4" fill="#1a56ae"/></svg>';
  const icons={
    'client-0':'<path d="m28 66 6-19 32-32a8 8 0 0 1 12 12L46 59z"/><path d="m34 47 12 12M28 66l18-7M60 21l13 13"/>',
    'client-1':'<circle cx="44" cy="43" r="23"/><path d="m61 61 20 20M30 41a14 14 0 0 1 13-12"/>',
    'client-2':'<circle cx="50" cy="50" r="29" fill="currentColor" stroke="none"/><path d="m35 50 10 11 21-24" stroke="white"/>',
    'client-3':'<path d="M21 77V61h10v16zm23 0V48h10v29zm23 0V33h10v44z" fill="currentColor" stroke="none"/><path d="m22 45 20-18 17 8 20-20"/><circle cx="22" cy="45" r="3"/><circle cx="42" cy="27" r="3"/><circle cx="59" cy="35" r="3"/><circle cx="79" cy="15" r="3"/>',
    'client-4':'<path d="M63 20a22 22 0 0 0-27 27L17 66a10 10 0 0 0 14 14l20-20a22 22 0 0 0 27-27L63 47 50 34z" fill="currentColor" stroke="none"/><circle cx="25" cy="73" r="3" fill="white" stroke="none"/>',
  };
  return start+(icons[source]||icons['client-0'])+'</svg>';
}
function serviceTooltipRows(source){
  const view=boardView();
  const cutoff=boardLive?Infinity:(view.last?.seq||0);
  return (boardData?.logs||[]).filter(log=>log.source===source&&log.seq<=cutoff).slice(-7);
}
function refreshServiceTooltip(){
  if(!hoverService||!boardData)return;
  const service=boardView().services[hoverService];
  if(!service){hideServiceTooltip();return;}
  const box=$('service-tooltip');
  box.hidden=false;
  box.style.setProperty('--service-color',serviceColor(hoverService));
  $('tooltip-service').textContent=serviceName(hoverService);
  $('tooltip-summary').textContent=`${service.status} · PID ${service.pid}${service.exitCode!==null?` · saída ${service.exitCode}`:''}`;
  const rows=serviceTooltipRows(hoverService);
  $('tooltip-logs').innerHTML=rows.length?rows.map(log=>`<div class="hover-log"><time>${timestamp(log.time)}</time><p>${escapeHtml(log.message)}</p></div>`).join(''):'<p class="tooltip-empty">Processo iniciado. Aguardando seus primeiros logs…</p>';
}
function showServiceTooltip(source,rect){
  clearTimeout(tooltipTimer);
  hoverService=source;
  hoverAnchor=rect;
  refreshServiceTooltip();
  const box=$('service-tooltip');
  const width=Math.min(380,window.innerWidth-24);
  box.style.width=`${width}px`;
  const left=Math.max(12,Math.min(rect.left+rect.width/2-width/2,window.innerWidth-width-12));
  const height=Math.min(box.getBoundingClientRect().height||300,window.innerHeight-24);
  const below=rect.bottom+10;
  const top=below+height<window.innerHeight-12?below:Math.max(12,rect.top-height-10);
  box.style.left=`${left}px`;
  box.style.top=`${top}px`;
}
function hideServiceTooltip(){
  clearTimeout(tooltipTimer);
  hoverService=null;
  $('service-tooltip').hidden=true;
}
function scheduleTooltipHide(){tooltipTimer=setTimeout(hideServiceTooltip,180);}
$('board-stage').addEventListener('pointerover',event=>{
  const node=event.target.closest('[data-service]');
  if(node&&!boardDrag)showServiceTooltip(node.dataset.service,node.getBoundingClientRect());
});
$('board-stage').addEventListener('pointerout',event=>{
  const node=event.target.closest('[data-service]');
  if(node&&!node.contains(event.relatedTarget)&&!$('service-tooltip').contains(event.relatedTarget))scheduleTooltipHide();
});
$('board-nodes').addEventListener('focusin',event=>{
  const node=event.target.closest('[data-service]');
  if(node)showServiceTooltip(node.dataset.service,node.getBoundingClientRect());
});
$('board-nodes').addEventListener('focusout',event=>{
  if(!$('service-tooltip').contains(event.relatedTarget))scheduleTooltipHide();
});
$('service-tooltip').addEventListener('pointerenter',()=>clearTimeout(tooltipTimer));
$('service-tooltip').addEventListener('pointerleave',scheduleTooltipHide);
$('tooltip-close').addEventListener('click',hideServiceTooltip);
$('service-tooltip').addEventListener('keydown',event=>{if(event.key==='Escape')hideServiceTooltip();});
$('board-stage').addEventListener('keydown',event=>{if(event.key==='Escape')hideServiceTooltip();});
