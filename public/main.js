let uploadId = null;
let report = null;

const stepEls = [
  document.getElementById('step1'),
  document.getElementById('step2'),
  document.getElementById('step3'),
];
const panelEls = [
  document.getElementById('panel1'),
  document.getElementById('panel2'),
  document.getElementById('panel3'),
];

function setStep(i){
  stepEls.forEach((el, idx)=> el.classList.toggle('active', idx===i));
  panelEls.forEach((el, idx)=> el.classList.toggle('hidden', idx!==i));
}

function setBar(id, val){
  document.getElementById(id).style.width = val+'%';
}

// ---- Preview helpers (client-side CSV/JSON) ----
function parseLocal(text){
  const t = (text||'').trim();
  if (!t) return [];
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const j = JSON.parse(t);
      return Array.isArray(j) ? j.slice(0,20) : [j];
    } catch(e) { /* fallback to CSV */ }
  }
  return parseCSV(t).slice(0,20);
}

function parseCSV(text){
  const lines = text.split(/\r?\n/).filter(l=>l.length>0);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  const rows = [];
  for (let i=1;i<lines.length;i++){
    const cols = splitCsvLine(lines[i]);
    const row = {}; headers.forEach((h,idx)=> row[h]=cols[idx]);
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line){
  const out=[]; let cur=''; let q=false;
  for (let i=0;i<line.length;i++){
    const c=line[i];
    if (c==='"') { if (q && line[i+1]==='"'){cur+='"'; i++;} else q=!q; }
    else if (c===',' && !q){ out.push(cur); cur=''; }
    else cur+=c;
  }
  out.push(cur); return out.map(s=>s.trim());
}

function inferType(v){
  if (v===null || v===undefined || v==='') return 'empty';
  if (!isNaN(Number(v))) return 'number';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return 'date';
  return 'text';
}

function renderPreview(rows){
  const status = document.getElementById('previewStatus');
  const table = document.getElementById('previewTable');
  if (!rows || !rows.length){
    status.textContent = 'No data yet.';
    table.classList.add('hidden');
    table.innerHTML='';
    return;
  }
  status.textContent = `Showing first ${Math.min(20, rows.length)} rows`;
  const cols = new Set(); rows.forEach(r=> Object.keys(r).forEach(k=>cols.add(k)));
  const columns = Array.from(cols);
  table.classList.remove('hidden');
  const thead = `<thead><tr>${columns.map(c=>`<th>${c}<br/><span class="badge">${inferType(rows.find(r=>r[c]!==undefined && r[c]!=='' )?.[c])}</span></th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.slice(0,20).map(r=>`<tr>${columns.map(c=>`<td>${r[c]??''}</td>`).join('')}</tr>`).join('')}</tbody>`;
  table.innerHTML = thead + tbody;
}

async function doUpload() {
  const country = document.getElementById('country').value;
  const erp = document.getElementById('erp').value;
  const file = document.getElementById('fileInput').files[0];
  const text = document.getElementById('textInput').value.trim();

  let res;
  if (file) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('country', country);
    fd.append('erp', erp);
    res = await fetch('/upload', { method: 'POST', body: fd });
  } else if (text) {
    res = await fetch('/upload', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ text, country, erp }) });
  } else {
    alert('Provide a file or pasted text.');
    return;
  }

  if (!res.ok) { alert('Upload failed'); return; }
  const data = await res.json();
  uploadId = data.uploadId;
  document.getElementById('previewStatus').textContent = 'Uploaded. Ready to analyze.';
}

async function analyze() {
  const questionnaire = {
    webhooks: document.getElementById('q_webhooks').checked,
    sandbox_env: document.getElementById('q_sandbox').checked,
    retries: document.getElementById('q_retries').checked,
  };
  const res = await fetch('/analyze', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ uploadId, questionnaire }) });
  if (!res.ok) { alert('Analyze failed'); return; }
  report = await res.json();
  renderResults(report);
}

function renderResults(r){
  setBar('barData', r.scores.data); document.getElementById('valData').textContent = r.scores.data;
  setBar('barCoverage', r.scores.coverage); document.getElementById('valCoverage').textContent = r.scores.coverage;
  setBar('barRules', r.scores.rules); document.getElementById('valRules').textContent = r.scores.rules;
  setBar('barPosture', r.scores.posture); document.getElementById('valPosture').textContent = r.scores.posture;
  setBar('barOverall', r.scores.overall); document.getElementById('valOverall').textContent = r.scores.overall;

  document.getElementById('matched').textContent = r.coverage.matched.join(', ');
  const closeUl = document.getElementById('close');
  closeUl.innerHTML = '';
  (r.coverage.close||[]).forEach(c => {
    const li = document.createElement('li');
    li.textContent = `${c.candidate} → ${c.target} (${c.confidence})`;
    closeUl.appendChild(li);
  });
  document.getElementById('missing').textContent = r.coverage.missing.join(', ');

  const rf = document.getElementById('ruleFindings');
  rf.innerHTML='';
  r.ruleFindings.forEach(f => {
    const li = document.createElement('li');
    li.textContent = `${f.rule}: ${f.ok ? 'PASS' : 'FAIL'}` + (f.exampleLine?` (line ${f.exampleLine}, expected ${f.expected}, got ${f.got})`: '') + (f.value?` (value ${f.value})`: '');
    rf.appendChild(li);
  });

  const link = `${location.origin}/report/${r.reportId}`;
  const a = document.getElementById('shareLink');
  a.href = link; a.classList.remove('hidden'); a.textContent = 'Open Report JSON';

  document.getElementById('downloadJson').onclick = () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${r.reportId}.json`; a.click();
    URL.revokeObjectURL(url);
  };
  document.getElementById('copyLink').onclick = async () => {
    await navigator.clipboard.writeText(link);
    alert('Link copied');
  };
}

// UI wiring
setStep(0);
document.getElementById('toUpload').onclick = () => setStep(1);
document.getElementById('back1').onclick = () => setStep(0);
document.getElementById('back2').onclick = () => setStep(1);

document.getElementById('uploadBtn').onclick = async () => {
  document.getElementById('previewStatus').textContent = 'Uploading...';
  await doUpload();
  document.getElementById('previewStatus').textContent = 'Analyzing...';
  await analyze();
  setStep(2);
};

// live preview when selecting file or typing text
document.getElementById('fileInput').addEventListener('change', async (e)=>{
  const f = e.target.files[0]; if (!f){ renderPreview([]); return; }
  const text = await f.text();
  renderPreview(parseLocal(text));
});
document.getElementById('textInput').addEventListener('input', (e)=>{
  const t = e.target.value; renderPreview(parseLocal(t));
});
