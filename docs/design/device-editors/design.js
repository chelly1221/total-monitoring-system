const screen = document.querySelector('#screen')
const profiles = new Map()
let device = 'ups', mode = 'edit', variant = 'a', tab = 0, sample = false, registration = 'auto'
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
const isUps = () => device === 'ups'
const isNew = () => mode === 'new'
const deviceLabel = () => isUps() ? 'UPS' : '온습도'
const profile = () => {
  const key = `${device}-${mode}`
  if (!profiles.has(key)) profiles.set(key, {name: isNew() ? '' : isUps() ? '1레이더 UPS #1' : '장비실 온습도', port: isNew() ? '' : isUps() ? '6101' : '6103', protocol: 'UDP', encoding: isUps() ? 'UTF-8' : '20바이트', offline: '1', topic: '', tempLow: '10', tempHigh: '30', humidityLow: '20', humidityHigh: '70', unit: 'UPS #1'})
  return profiles.get(key)
}
function input(label, key, value, options = {}) {
  const resolved = profile()[key] ?? value
  return `<label class="field ${options.full ? 'full' : ''}"><span>${label}</span><input data-key="${key}" value="${escapeHtml(resolved ?? '')}" ${options.type ? `type="${options.type}"` : ''} ${options.placeholder ? `placeholder="${options.placeholder}"` : ''}>${options.help ? `<small>${options.help}</small>` : ''}</label>`
}
function select(label, key, options, full = false) {
  return `<label class="field ${full ? 'full' : ''}"><span>${label}</span><select data-key="${key}">${options.map(value => `<option ${profile()[key] === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label>`
}
function section(title, description, body, action = '') {
  return `<section class="section"><header class="section-head"><div><h2>${title}</h2>${description ? `<p>${description}</p>` : ''}</div>${action}</header>${body}</section>`
}
function connection() {
  return section('기본 정보 · 통신', '장비 식별 정보와 서버 수신 방식을 설정합니다.', `<div class="fields">
    ${input('장비 이름', 'name', '', {full:true, placeholder:isUps() ? '예: 1레이더 UPS #1' : '예: 장비실 온습도'})}
    ${select('프로토콜','protocol',['UDP','TCP','MQTT'])}
    ${input('수신 포트','port','',{type:'number',placeholder:isUps() ? '6101' : '6103'})}
    ${select('데이터 인코딩','encoding',['20바이트','UTF-8'])}
    ${input('오프라인 판정 (분)','offline','1',{type:'number'})}
    ${profile().protocol === 'MQTT' ? input('MQTT 토픽','topic','',{full:true,placeholder:'facility/sensors'}) : ''}
  </div><p class="help">설정한 시간 동안 데이터가 없으면 오프라인으로 판정합니다.</p>`)
}
function discovery() {
  return section('UPS 클라이언트 연결', '자동 탐지하거나 통신 정보를 직접 입력합니다.', `<div class="mode-switch"><button data-registration="auto" aria-pressed="${registration === 'auto'}">자동 탐지</button><button data-registration="manual" aria-pressed="${registration === 'manual'}">직접 입력</button></div>${registration === 'auto' ? `<div class="device-choice"><strong>1레이더 UPS PC</strong><small>192.0.2.21 · UPS #1 / #2 · 예시 장비</small><div class="fields">${select('연결할 UPS','unit',['UPS #1','UPS #2'])}<div class="field"><span>장비 탐지</span><button data-action="discover">다시 탐지</button></div></div></div><p class="help">${isNew() ? '탐지한 PC와 UPS 번호를 선택한 뒤 등록합니다.' : '현재 연결된 PC와 UPS 번호를 확인합니다.'}</p>` : '<p class="help">기본 정보에서 수신 포트와 프로토콜을 지정하세요.</p>'}`)
}
function audioSettings() {
  return section('음성 알림', 'UPS 알람 발생 시 재생할 소리를 지정합니다.', `<div class="fields">${select('알림 방식','audio',['사용 안 함','음성 읽기','파일 재생'])}${input('알림 문구','audioText','UPS 알람이 발생했습니다',{full:true})}</div><div class="table-actions"><span>예시에서는 소리를 재생하지 않습니다.</span><button data-action="audio">미리 듣기</button></div>`)
}
function upsMetrics() {
  const rows = [['입력전압','inputV','200','240','V'],['출력전압','outputV','200','240','V'],['배터리전압','batteryV','40','56','V'],['배터리잔량','battery','20','100','%'],['부하','load','0','80','%'],['입력주파수','frequency','59','61','Hz']]
  return section('감시 항목 · 알람 기준', '표시할 항목과 허용 범위를 한곳에서 관리합니다.', `<table class="metric-table"><thead><tr><th>감시 항목</th><th>하한</th><th>상한</th><th>단위</th></tr></thead><tbody>${rows.map(([name,key,low,high,unit]) => `<tr><td>${name}</td><td><input aria-label="${name} 하한" data-key="${key}Low" type="number" value="${escapeHtml(profile()[key+'Low'] ?? low)}"></td><td><input aria-label="${name} 상한" data-key="${key}High" type="number" value="${escapeHtml(profile()[key+'High'] ?? high)}"></td><td>${unit}</td></tr>`).join('')}</tbody></table><div class="table-actions"><span>범위를 벗어나면 해당 항목에 알람을 표시합니다.</span><button data-action="metric">항목 추가</button></div><details><summary>항목별 세부 설정 · 수신 데이터 연결</summary><div class="fields">${select('항목','metric',['입력전압','출력전압','배터리전압','배터리잔량','부하','입력주파수'])}${input('데이터 인덱스','index','0',{type:'number'})}${input('구분자','delimiter',',')}${select('값 처리','transform',['숫자로 변환','문자열 비교'])}</div><p class="help">표시 범위·상태 조건·데이터 매칭을 항목별로 지정합니다.</p></details>`)
}
function sensorMetrics() {
  return section('온도 · 습도 알람 기준', '정상 범위를 벗어나는 조건을 각각 설정합니다.', [['온도','temp','°C','저온 경고','고온 경고'],['습도','humidity','%','건조 경고','다습 경고']].map(([name,key,unit,low,high]) => `<div class="sensor-block"><div class="sensor-title"><h3>${name}</h3><span>단위 ${unit}</span></div><div class="limits">${input(low+' · 하한 ('+unit+')',key+'Low','',{type:'number'})}${input(high+' · 상한 ('+unit+')',key+'High','',{type:'number'})}</div><div class="limit-note"><span>하한 이하이면 ${low}</span><span>상한 이상이면 ${high}</span></div><div class="match-row"><span>수신 값 인덱스</span><input aria-label="${name} 데이터 인덱스" data-key="${key}Index" value="${escapeHtml(profile()[key+'Index'] ?? (key==='temp' ? '0':'1'))}" type="number"><span>(0부터) · 쉼표로 구분</span></div></div>`).join('') + '<details><summary>고급 설정 · 데이터 매칭 조건</summary><p class="help">특정 데이터만 처리하도록 포함·시작·끝·일치·정규식 조건을 지정합니다.</p><div class="fields">'+select('조건','match',['포함','시작','끝','일치','정규식'])+input('매칭 값','matchValue','')+'</div></details>')
}
function preview() {
  const active = !isNew() || sample
  const body = active ? `<div class="readings">${(isUps() ? [['입력전압','220.4','V'],['출력전압','220.1','V'],['배터리잔량','98','%'],['부하','32','%']] : [['온도','24.6','°C'],['습도','48.2','%']]).map(([label,value,unit])=>`<div class="reading"><small>${label}</small><strong>${value}</strong><em>${unit}</em></div>`).join('')}</div><h3>수신 데이터</h3><pre class="raw">${isUps() ? '14:32:08  220.4,220.1,52.3,98,32,60.0\n14:32:06  220.3,220.1,52.3,98,32,60.0\n14:32:04  220.4,220.0,52.3,98,31,60.0' : '14:32:08  24.6,48.2\n14:32:06  24.6,48.1\n14:32:04  24.5,48.1'}</pre><p class="sample-caption">화면 구성 확인용 예시 데이터 · 실제 수신 아님</p>` : `<div class="empty"><strong>수신 데이터를 기다립니다</strong><p>통신 정보를 입력하면 이곳에서<br>원문과 해석된 값을 확인할 수 있습니다.</p><button data-action="sample">예시 데이터 보기</button></div>`
  return section('데이터 미리보기', '원문과 해석 결과를 함께 확인합니다.', body, `<span class="status ${active ? '' : 'waiting'}">${active ? '예시 표시' : '대기'}</span>`)
}
function alarmLog() {
  return section('최근 알람', '현재 장비의 알람과 처리 상태입니다.', '<div class="log-row"><time>09:12</time><span>'+(isUps() ? '입력전압 하한 이탈' : '온도 상한 초과')+'</span><small>복구</small></div><div class="log-row"><time>어제 17:40</time><span>장비 오프라인</span><small>복구</small></div><p class="sample-caption">디자인 확인용 예시 이력</p>')
}
function advanced() {
  return `<details><summary>고급 설정 · 사용자 정의 파서</summary><p class="help">수신 데이터 형식이 다른 경우 해석 코드를 지정합니다.</p><label class="field"><span>데이터 해석 코드</span><textarea data-key="parser">${escapeHtml(profile().parser ?? 'const values = data.split(",").map(Number);\nreturn { 입력전압: values[0], 출력전압: values[1] };')}</textarea></label><div class="table-actions"><span>예시 데이터로 해석 결과를 확인합니다.</span><button data-action="parser">해석 테스트</button></div></details>`
}
function summary() {
  return section(isNew() ? '등록 정보 확인' : '현재 편집 정보', '', `<div class="summary-line"><span>장비 이름</span><strong data-summary="name">${escapeHtml(profile().name || '입력 전')}</strong></div><div class="summary-line"><span>통신 방식</span><strong data-summary="protocol">${escapeHtml(profile().protocol)}</strong></div><div class="summary-line"><span>수신 포트</span><strong data-summary="port">${escapeHtml(profile().port || '입력 전')}</strong></div><div class="summary-line"><span>오프라인 판정</span><strong><span data-summary="offline">${escapeHtml(profile().offline)}</span>분</strong></div>`)
}
function render(focusTarget) {
  const focused = document.activeElement
  const focusAttribute = ['data-key','data-tab','data-step','data-registration','data-action'].find(key => focused?.hasAttribute(key))
  const focusSelector = typeof focusTarget === 'string' ? focusTarget : focusAttribute ? '['+focusAttribute+'="'+focused.getAttribute(focusAttribute)+'"]' : null
  document.querySelector('#device').value = device
  document.querySelector('#mode').value = mode
  document.querySelector('#choose-a').setAttribute('aria-pressed', String(variant==='a'))
  document.querySelector('#choose-b').setAttribute('aria-pressed', String(variant==='b'))
  document.querySelector('#concept-description').textContent = variant === 'a' ? 'A안 · 기본 정보, 알람 기준, 수신 데이터를 3열로 배치합니다. 현재 설정 페이지와 같은 구성으로 한 번에 비교하며 수정합니다.' : isNew() ? 'B안 · 연결 → 알람 기준 → 등록 확인 순서로 진행합니다. 새 장비 등록 시 필요한 설정에 하나씩 집중합니다.' : 'B안 · 설정 종류를 상단 탭으로 나누고 수신 미리보기를 항상 유지합니다. 항목이 많은 장비를 넓은 편집 영역에서 관리합니다.'
  const tabs = isNew() ? ['연결 설정','알람 기준','등록 확인'] : isUps() ? ['감시 항목 · 알람','기본 정보 · 통신','음성 · 데이터 해석'] : ['온도 · 습도 기준','기본 정보 · 통신','데이터 확인 · 이력']
  let content
  if (variant === 'a') content = `<div class="columns-a"><div class="column">${connection()}${isUps() ? discovery() : section('등록 안내','', '<p class="help">일반 온습도 장비는 수신 포트로 등록합니다. 라즈베리파이 센서는 상단 센서 메뉴에서 자동 탐지로 등록할 수 있습니다.</p>')}</div><div class="column">${isUps() ? upsMetrics()+advanced() : sensorMetrics()}${isUps() ? `<details class="audio-details"><summary>음성 알림 · 사용 안 함</summary>${audioSettings()}</details>` : ''}</div><div class="column">${preview()}${isNew() ? summary() : alarmLog()}</div></div>`
  else {
    let work
    if (isNew()) work = tab===0 ? `<div class="connection-grid">${connection()}${isUps() ? discovery() : ''}</div>` : tab===1 ? (isUps() ? upsMetrics()+advanced() : sensorMetrics()) : section('등록 전 확인','입력한 통신 정보와 알람 기준을 확인하세요.', `<div class="confirm-grid"><div>${summary()}</div><div><h3>알람 기준</h3><p class="help">${isUps() ? '입력·출력전압, 배터리, 부하, 주파수' : '온도 '+escapeHtml(profile().tempLow)+'–'+escapeHtml(profile().tempHigh)+' °C<br>습도 '+escapeHtml(profile().humidityLow)+'–'+escapeHtml(profile().humidityHigh)+' %'}</p><p class="help">등록 후에도 장비 수정에서 변경할 수 있습니다.</p></div></div>`)+(isUps() ? audioSettings() : '')
    else work = tab===0 ? (isUps() ? upsMetrics()+advanced() : sensorMetrics()) : tab===1 ? `<div class="connection-grid">${connection()}${isUps() ? discovery() : ''}</div>` : isUps() ? audioSettings()+advanced() : preview()+alarmLog()
    content = `<div class="tabs" role="tablist" aria-label="${isNew() ? '등록 단계' : '설정 분류'}">${tabs.map((label,i)=>`<button role="tab" id="editor-tab-${i}" aria-controls="editor-panel" tabindex="${tab===i ? 0 : -1}" data-tab="${i}" aria-selected="${tab===i}">${isNew() ? (i+1)+'. ' : ''}${label}</button>`).join('')}</div><div class="layout-b"><div class="work-area" role="tabpanel" id="editor-panel" aria-labelledby="editor-tab-${tab}">${work}${isNew() ? `<div class="step-actions"><button data-step="back" ${tab===0 ? 'disabled' : ''}>이전 단계</button><p>${tab+1} / 3 단계</p><button class="primary" data-step="next">${tab===2 ? '장비 등록' : '다음 단계'}</button></div>` : ''}</div><div class="preview-rail">${preview()}${summary()}</div></div>`
  }
  screen.innerHTML = `<div class="page-heading"><div class="heading-title"><button class="back" aria-label="목록으로" data-action="back"><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6M8 12h13"/></svg></button><div><h1>${isNew() ? '새 '+deviceLabel()+' 장비 추가' : deviceLabel()+' 장비 수정'}</h1><p>${isNew() ? '통신 정보와 알람 기준을 설정하고 장비를 등록합니다.' : escapeHtml(profile().name)+' · 설정 변경 후 저장을 눌러 적용합니다.'}</p></div></div><div class="heading-actions"><button data-action="cancel">취소</button><button class="primary" data-action="save">${isNew() ? '장비 등록' : '변경 저장'}</button></div></div>${content}<footer class="footer-note"><span>${isNew() ? '장비를 등록하기 전까지 서버에 적용되지 않습니다.' : '변경 사항은 저장한 뒤 적용됩니다.'}</span><span>${deviceLabel()} ${isNew() ? '추가' : '수정'} · ${variant.toUpperCase()}안 · 디자인 시안</span></footer>`
  screen.querySelectorAll('[data-key]').forEach(el=>el.addEventListener('input',()=>{profile()[el.dataset.key]=el.value;document.querySelectorAll(`[data-summary="${el.dataset.key}"]`).forEach(node=>node.textContent=el.value || '입력 전')}))
  screen.querySelector('[data-key="protocol"]')?.addEventListener('change', render)
  screen.querySelectorAll('[data-tab]').forEach(el=>{
    el.onclick=()=>{tab=Number(el.dataset.tab);render('[data-tab="'+tab+'"]')}
    el.onkeydown=event=>{
      const keys=['ArrowLeft','ArrowRight','Home','End']
      if(!keys.includes(event.key))return
      event.preventDefault()
      tab=event.key==='Home'?0:event.key==='End'?tabs.length-1:(tab+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length
      render('[data-tab="'+tab+'"]')
    }
  })
  screen.querySelectorAll('[data-registration]').forEach(el=>el.onclick=()=>{registration=el.dataset.registration;render()})
  screen.querySelectorAll('[data-step]').forEach(el=>el.onclick=()=>{if(el.dataset.step==='back')tab--;else if(tab<2)tab++;else return save();render(tab===0 ? '[data-tab="0"]' : undefined)})
  screen.querySelectorAll('[data-action]').forEach(el=>el.onclick=()=>action(el.dataset.action))
  if(focusSelector)screen.querySelector(focusSelector)?.focus({preventScroll:true})
}
let toastTimer
function notify(message) { const el=document.querySelector('#notification');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),3500) }
function save() { if(!profile().name.trim()) return notify('장비 이름을 입력하세요.');if(profile().protocol!=='MQTT' && (!/^\d+$/.test(profile().port) || Number(profile().port)<1 || Number(profile().port)>65535)) return notify('수신 포트를 1~65535 범위로 입력하세요.');notify('시안에서 '+(isNew() ? '등록' : '저장')+' 동작을 확인했습니다. 실제 서버에는 반영되지 않습니다.') }
function action(name) {
  if(name==='save')return save()
  if(name==='sample'){sample=true;render();return}
  const messages={back:'디자인 비교 화면입니다. 상단에서 다른 장비·화면을 선택하세요.',cancel:'시안의 입력 내용을 초기화했습니다.',discover:'예시 UPS PC 1대를 표시했습니다. 실제 네트워크 탐지는 실행하지 않습니다.',audio:'미리 듣기 동작 시안입니다. 실제 소리는 재생하지 않습니다.',parser:'예시 해석 결과: 입력전압 220.4 V · 출력전압 220.1 V',metric:'항목별 세부 설정에서 추가할 항목과 수신 값 위치를 선택합니다.'}
  if(name==='cancel'){profiles.delete(`${device}-${mode}`);render()}
  if(name==='metric'){const details=screen.querySelector('details');if(details)details.open=true}
  notify(messages[name] || '')
}
function navigate() { location.hash=`${device}-${mode}-${variant}` }
function readHash() {const parts=location.hash.slice(1).split('-');device=parts[0]==='sensor'?'sensor':'ups';mode=parts[1]==='new'?'new':'edit';variant=parts[2]==='b'?'b':'a';tab=0;sample=false;render()}
document.querySelector('#device').onchange=event=>{device=event.target.value;navigate()}
document.querySelector('#mode').onchange=event=>{mode=event.target.value;navigate()}
document.querySelector('#choose-a').onclick=()=>{variant='a';navigate()}
document.querySelector('#choose-b').onclick=()=>{variant='b';navigate()}
window.addEventListener('hashchange', readHash)
readHash()
