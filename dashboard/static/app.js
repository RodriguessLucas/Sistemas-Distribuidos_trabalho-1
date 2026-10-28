const $ = id => document.getElementById(id);
const labels = {idle:'Pronto para iniciar',starting:'Preparando os dados',running:'Treinamento em curso',stopping:'Interrompendo',stopped:'Execução interrompida',completed:'Execução concluída',error:'Falha na execução'};
let state = null;
let busy = false;
let lastLogKey = '';
let connectionFailed = false;
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = value => value == null ? '—' : value.toLocaleString('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:4});
const percent = value => value == null ? '—' : (value * 100).toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}) + '%';
const timestamp = value => new Date(value * 1000).toLocaleTimeString('pt-BR');
function chart(id, rounds, key, color) {
  const values = rounds.filter(r => r[key] != null);
  const top = key === 'accuracy' ? 1 : Math.max(1,...values.map(r=>r[key])) * 1.1;
  const width=500, height=170, left=40, right=485, upper=15, bottom=141;
  const x = round => left + (round-1) / 4 * (right-left);
  const y = value => bottom - value/top * (bottom-upper);
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${key === 'accuracy' ? 'Acurácia' : 'Perda'} por rodada">`;
  for(let i=0;i<4;i++) {
    const v = top*i/3;
    svg += `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="#e8eef8" stroke-dasharray="3 5"/><text x="30" y="${y(v)+3}" text-anchor="end" fill="#7086a2" font-size="9">${key==='accuracy'?Math.round(v*100)+'%':v.toFixed(1)}</text>`;
  }
  for(let i=1;i<=5;i++)svg += `<text x="${x(i)}" y="163" text-anchor="middle" fill="#7086a2" font-size="9">R${i}</text>`;
  if(values.length) {
    const points=values.map(v=>`${x(v.round)},${y(v[key])}`);
    svg += `<defs><linearGradient id="fill-${key}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${color}" stop-opacity=".16"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;
    svg += `<path d="M${x(values[0].round)},${bottom} L${points.join(' L')} L${x(values.at(-1).round)},${bottom}Z" fill="url(#fill-${key})"/><polyline points="${points.join(' ')}" stroke="${color}" stroke-width="2.2" fill="none" stroke-linejoin="round"/>`;
    for(const v of values)svg+=`<circle cx="${x(v.round)}" cy="${y(v[key])}" r="3.5" fill="${color}" stroke="#ffffff" stroke-width="2"><title>Rodada ${v.round}: ${key==='accuracy'?percent(v[key]):number(v[key])}</title></circle>`;
  }
  svg+='</svg>';
  $(id).innerHTML=svg+(values.length?'':'<div class="chart-empty">Os resultados aparecerão após a primeira rodada.</div>');
}
function renderLogs() {
  if(!state)return;
  const filter=$('log-filter').value;
  const rows=state.logs.filter(log=>filter==='all'||log.source===filter);
  const key=`${state.started_at}-${filter}-${state.logs.length}-${state.logs.at(-1)?.time}`;
  if(key===lastLogKey)return;
  lastLogKey=key;
  const consoleBox=$('console');
  const nearBottom=consoleBox.scrollHeight-consoleBox.scrollTop-consoleBox.clientHeight<60;
  consoleBox.innerHTML=rows.map(log=>`<span class="service-log-line" style="--service-color:${typeof serviceColor==='function'?serviceColor(log.source):'#8fa7c3'}">[${timestamp(log.time)}] [${escapeHtml(log.source)}] ${escapeHtml(log.message)}</span>`).join('')||'Aguardando mensagens deste serviço…';
  if(nearBottom)consoleBox.scrollTop=consoleBox.scrollHeight;
}
function render(data) {
  state=data;
  const active=['starting','running','stopping'].includes(data.status);
  const rounds=data.rounds.filter(r=>r.accuracy!=null);
  const latest=rounds.at(-1);
  $('status').textContent=labels[data.status]||data.status;
  $('status').className=`badge ${data.status}`;
  $('start').disabled=active||busy||connectionFailed;
  $('start').textContent=data.started_at?'↻ Nova execução':'▶ Iniciar execução';
  $('stop').disabled=!active||data.status==='stopping'||busy||connectionFailed;
  $('export').disabled=!data.started_at;
  $('notice').hidden=!data.error;
  $('notice').textContent=data.error||'';
  $('round-stat').innerHTML=`${rounds.length} <small>/ 5</small>`;
  $('progress').style.width=`${rounds.length/5*100}%`;
  $('accuracy-stat').textContent=percent(latest?.accuracy);
  $('loss-stat').textContent=number(latest?.loss);
  $('chart-accuracy').textContent=percent(latest?.accuracy);
  $('chart-loss').textContent=number(latest?.loss);
  $('accuracy-detail').textContent=latest?`Resultado da rodada ${latest.round} · teste global`:'Aguardando a primeira rodada';
  const current=Math.min(rounds.length+1,5);
  const received=data.received[String(current)]||[];
  $('server-state').textContent=data.status==='completed'?'Modelo final consolidado':data.status==='running'?`Rodada ${current} · ${received.length}/5 updates`:labels[data.status];
  $('round-network').textContent=data.status==='completed'?'25 atualizações recebidas':data.status==='running'?`Rodada ${current} de 5`:'Execução local · Iris';
  $('network').classList.toggle('live',data.status==='running');
  $('network-clients').innerHTML=data.clients.map(c=>`<div class="client-node ${c.round?'accepted':''}"><b>▤</b><strong>Cliente ${c.id}</strong><small>${c.round?`Rodada ${c.round} aceita`:'Aguardando'}</small></div>`).join('');
  $('client-table').innerHTML=data.clients.map(c=>{
    let status='Aguardando início';
    if(active)status=c.round?'Atualização aceita':'Preparando / aguardando';
    if(data.status==='completed')status='Finalizado';
    if(data.status==='stopped')status='Interrompido';
    if(data.status==='error')status=c.exit_code!=null&&c.exit_code!==0?'Encerrado com erro':'Execução encerrada';
    return `<tr><td><div class="client-label"><span class="client-avatar">C${c.id}</span>Cliente ${c.id}</div></td><td><span class="pill">${status}</span></td><td class="mono">${c.round} / 5</td><td><div class="local-accuracy">${percent(c.accuracy)}<div class="tiny-bar"><i style="width:${(c.accuracy||0)*100}%"></i></div></div></td><td class="mono">${number(c.loss)}</td><td class="mono ${c.exit_code!=null&&c.exit_code!==0?'error-text':''}">${c.exit_code??'—'}</td></tr>`;
  }).join('');
  chart('accuracy-chart',rounds,'accuracy','#3988f4');
  chart('loss-chart',rounds,'loss','#a082e6');
  $('event-count').textContent=`${data.events.length} eventos`;
  $('timeline').innerHTML=data.events.length?data.events.slice(-70).reverse().map(e=>`<div class="event"><span class="event-icon">${e.source==='server'?'◈':'↗'}</span><div><p>${escapeHtml(e.message)}</p><time>${timestamp(e.time)} · ${escapeHtml(e.source)}</time></div></div>`).join(''):'<div class="empty">Sua próxima execução começa aqui.</div>';
  renderLogs();
  if(typeof renderWhiteboard==='function')renderWhiteboard(data);
  updateDuration();
}
function updateDuration(){
  const elapsed=state?.started_at?Math.max(0,Math.floor((state.finished_at||Date.now()/1000)-state.started_at)):0;
  $('duration').textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
}
async function poll(){
  try{
    const response=await fetch('/api/state',{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Não foi possível ler a execução.');
    connectionFailed=false;
    $('connection').textContent='Painel conectado';
    $('connection-dot').style.background='#3988f4';
    render(await response.json());
  }catch(error){
    connectionFailed=true;
    $('connection').textContent='Sem conexão · reconectando';
    $('connection-dot').style.background='#ff9c9c';
    $('start').disabled=true;
    $('stop').disabled=true;
  }finally{setTimeout(poll,750);}
}
async function action(name){
  busy=true;
  $('start').disabled=true;
  $('stop').disabled=true;
  try{
    const response=await fetch(`/api/${name}`,{method:'POST',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error(response.status===409?'Já existe uma execução em andamento.':'Não foi possível executar a ação.');
  }catch(error){$('notice').hidden=false;$('notice').textContent=error.message;}
  finally{busy=false;}
}
$('start').addEventListener('click',()=>action('start'));
$('stop').addEventListener('click',()=>action('stop'));
$('log-filter').addEventListener('change',renderLogs);
$('export').addEventListener('click',()=>{
  if(!state)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download='fedscope-execucao.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
poll();setInterval(updateDuration,1000);
