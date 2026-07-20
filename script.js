if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXWXkUBJ8iyLK2vd9qnUJcCaiBO0-d3KmzEzgnnEypiHgxWhUQwbXYnEwUSb6xdXHyQ48x1dAcdTkk/pub?gid=131190311&single=true&output=csv";
const TARGET_YEAR = "2026";
const ACTUAL_COLOR = '#ef4444';
const ACTUAL_FILL = 'rgba(239,68,68,0.12)';
const OUTPUT_COLOR = '#3b82f6';
const OUTPUT_FILL = 'rgba(59,130,246,0.12)';

let globalData = {};       // globalData[emp][task][weekLabel] = commitment value (number) or undefined if missing
let globalWeeks = [];       // ordered list of 2026 week labels
let activeCharts = [];
let currentView = 'per-task'; // 'per-task' or 'combined'

const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;
html.setAttribute('data-theme', 'dark');

themeToggle.addEventListener('click', () => {
  const cur = html.getAttribute('data-theme');
  html.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  const emp = document.getElementById('empSelect').value;
  if (emp && globalData[emp]) renderAllCharts(emp);
});

document.getElementById('viewPerTask').addEventListener('click', () => switchView('per-task'));
document.getElementById('viewCombined').addEventListener('click', () => switchView('combined'));
document.getElementById('periodSelect').addEventListener('change', () => {
  const emp = document.getElementById('empSelect').value;
  if (emp && globalData[emp]) renderAllCharts(emp);
});

function switchView(view) {
  currentView = view;
  document.getElementById('viewPerTask').classList.toggle('active', view === 'per-task');
  document.getElementById('viewCombined').classList.toggle('active', view === 'combined');
  document.getElementById('periodField').style.display = view === 'combined' ? 'flex' : 'none';
  if (view === 'combined') populatePeriodSelect();
  const emp = document.getElementById('empSelect').value;
  if (emp && globalData[emp]) renderAllCharts(emp);
}

// Sirf globalWeeks se period labels banata hai (kisi ek task ke data par depend nahi karta),
// taaki Combined view mein "Period" dropdown har employee ke liye same rahe.
function getPeriodLabels() {
  const labels = [];
  for (let i = 0; i < globalWeeks.length; i += 2) {
    const w1 = globalWeeks[i];
    const w2 = globalWeeks[i + 1];
    labels.push(w2 ? `${w1} → ${w2}` : `${w1}`);
  }
  return labels;
}

function populatePeriodSelect() {
  const sel = document.getElementById('periodSelect');
  sel.innerHTML = '';
  const labels = getPeriodLabels();
  labels.forEach((label, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = label;
    sel.appendChild(opt);
  });
  // Default: sabse latest period select rahe
  if (labels.length > 0) sel.value = labels.length - 1;
}

function getUIColors() {
  const isDark = html.getAttribute('data-theme') === 'dark';
  return {
    datalabel: isDark ? '#ffffff' : '#1e293b',
    grid: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#94a3b8' : '#64748b',
    tooltipBg: isDark ? '#1e293b' : '#ffffff',
    tooltipText: isDark ? '#f8fafc' : '#1e293b',
    tooltipBorder: isDark ? '#475569' : '#cbd5e1',
    pointBorder: isDark ? '#0f172a' : '#ffffff'
  };
}

// "05 January 2026 → 12 January 2026" jaisa lamba label chart axis par rotate hone par
// wrap/collide ho jaata hai. Isliye axis ke liye ek chhota, saaf version banate hain —
// year hata dete hain (sab 2026 hi hai) aur month names ko 3-letter mein short karte hain.
const MONTH_SHORT = {
  January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr', May: 'May', June: 'Jun',
  July: 'Jul', August: 'Aug', September: 'Sep', October: 'Oct', November: 'Nov', December: 'Dec'
};
function shortenPeriodLabel(label) {
  if (!label) return label;
  let out = String(label).replace(/\b20\d{2}\b/g, '').trim();
  Object.keys(MONTH_SHORT).forEach(full => {
    out = out.split(full).join(MONTH_SHORT[full]);
  });
  return out.replace(/\s+/g, ' ').replace(/\s*→\s*/g, ' → ').trim();
}

function parseCSV(text) {
  const result = []; let row = []; let inQuotes = false; let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { row.push(current.trim()); current = ''; }
    else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (current || row.length > 0) { row.push(current.trim()); result.push(row); row = []; current = ''; }
      if (char === '\r' && text[i+1] === '\n') i++;
    } else { current += char; }
  }
  if (current || row.length > 0) { row.push(current.trim()); result.push(row); }
  return result;
}

async function fetchData() {
  try {
    const response = await fetch(SHEET_URL);
    const csvText = await response.text();
    const rows = parseCSV(csvText);
    if (rows.length < 4) throw new Error("Invalid CSV format");

    const row0 = rows[0];
    const datePairs = [];
    // Har week block 4 columns ka hai: [Score>NotDone, Score>Delay, Commitment>NotDone, Commitment>Delay]
    // Real per-week value "Commitment > Not Done" (i+2) column mein hai.
    for (let i = 0; i < row0.length; i++) {
      const cell = row0[i] ? row0[i].trim() : '';
      const yearMatch = cell.match(/(20\d{2})/);
      if (yearMatch && i + 2 < row0.length) {
        datePairs.push({ label: cell, year: yearMatch[1], valCol: i + 2 });
      }
    }

    const filteredPairs = datePairs.filter(p => p.year === TARGET_YEAR);
    globalWeeks = filteredPairs.map(p => p.label);

    let currentTeam = '';
    const data = {};

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 2) continue;
      const team = row[0];
      const task = row[1];
      if (team && team.trim() !== '') currentTeam = team.trim();
      if (!currentTeam || !task || task.trim() === '') continue;

      const cleanTask = task.trim();
      if (!data[currentTeam]) data[currentTeam] = {};
      if (!data[currentTeam][cleanTask]) data[currentTeam][cleanTask] = {};

      filteredPairs.forEach(pair => {
        let v = row[pair.valCol];
        v = (v === '' || v === undefined || v === null) ? null : parseFloat(v);
        if (v !== null && !isNaN(v)) {
          data[currentTeam][cleanTask][pair.label] = v;
        }
      });
    }

    globalData = data;
    document.getElementById('loadingMsg').style.display = 'none';
    document.getElementById('controlsRow').style.display = 'flex';
    populateEmployees();
  } catch (error) {
    console.error("Error fetching data:", error);
    document.getElementById('loadingMsg').textContent = "❌ Data load karne mein error aaya. Page refresh karein.";
  }
}

function populateEmployees() {
  const empSelect = document.getElementById('empSelect');
  empSelect.innerHTML = '';
  const employees = Object.keys(globalData).sort();
  employees.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp; opt.textContent = emp;
    empSelect.appendChild(opt);
  });
  if (employees.length > 0) {
    empSelect.value = employees[0];
    renderAllCharts(employees[0]);
  }
}

// Weeks ko consecutive pairs mein todta hai: week1=Actual, week2=Output; week3=Actual, week4=Output; ...
function buildPairs(taskData) {
  const pairs = [];
  for (let i = 0; i < globalWeeks.length; i += 2) {
    const w1 = globalWeeks[i];
    const w2 = globalWeeks[i + 1]; // undefined if odd count ka last week hai

    const actualVal = taskData[w1] !== undefined ? taskData[w1] : null;
    const outputVal = (w2 !== undefined && taskData[w2] !== undefined) ? taskData[w2] : null;

    pairs.push({
      label: w2 ? `${w1} → ${w2}` : `${w1}`,
      actual: actualVal,
      output: outputVal
    });
  }
  return pairs;
}

function computeAllTasks(emp) {
  const tasks = Object.keys(globalData[emp] || {}).sort();
  return tasks.map(task => {
    const taskData = globalData[emp][task];
    const pairs = buildPairs(taskData);
    const hasAnyData = pairs.some(p => p.actual !== null || p.output !== null);
    return { task, pairs, hasAnyData };
  });
}

// Task ke sabhi pairs mein Actual aur Output dono hamesha zero (ya missing) hain to true return karta hai.
// Aisa task poori tarah zero maana jaata hai, isliye uska graph show nahi kiya jaata.
function isTaskAllZero(taskInfo) {
  return taskInfo.pairs.every(p =>
    (p.actual === null || p.actual === 0) && (p.output === null || p.output === 0)
  );
}

// Ek employee ke sabhi tasks ka, ek selected period (week-pair) ka Actual/Output nikalta hai.
function computeCombinedData(emp, periodIndex) {
  const tasks = Object.keys(globalData[emp] || {}).sort();
  const rows = tasks.map(task => {
    const taskData = globalData[emp][task];
    const pairs = buildPairs(taskData);
    const p = pairs[periodIndex] || { actual: null, output: null };
    return { task, actual: p.actual, output: p.output };
  });
  // Jin tasks mein is period ke liye koi data hi nahi (dono null), ya dono zero hain,
  // unhe combined graph se bhi hide kar do — per-task view jaisa hi rule.
  return rows.filter(r => !((r.actual === null || r.actual === 0) && (r.output === null || r.output === 0)));
}

function renderStatsCombined(rows) {
  const allActual = rows.map(r => r.actual).filter(v => v !== null);
  const allOutput = rows.map(r => r.output).filter(v => v !== null);
  const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  document.getElementById('statsRow').innerHTML = `
    <div class="stat"><div class="k">Total Tasks</div><div class="v">${rows.length}</div></div>
    <div class="stat"><div class="k"><span class="legend-dot" style="background:#ef4444"></span>Actual Avg</div><div class="v">${avg(allActual).toFixed(1)}</div></div>
    <div class="stat"><div class="k"><span class="legend-dot" style="background:#3b82f6"></span>Output Avg</div><div class="v">${avg(allOutput).toFixed(1)}</div></div>
  `;
}

// Combined graph: horizontal bars — vertical (y) axis par saare tasks, horizontal (x) axis par values.
// Zero hamesha axis par visible rehta hai; positive values right/upar ki taraf, negative values
// left/nicha ki taraf zero se hi shuru hoti hain (Chart.js khud hi zero baseline se diverge karta hai).
function buildCombinedChart(emp, periodLabel, rows, colors) {
  const wrapper = document.createElement('div');
  wrapper.className = 'panel';

  const title = document.createElement('div');
  title.className = 'chart-title';
  title.innerHTML = `All Tasks — ${periodLabel}`;
  wrapper.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'chart-sub';
  sub.textContent = 'Har task ek row hai; bar zero se right (positive) ya left (negative) ki taraf jaati hai.';
  wrapper.appendChild(sub);

  const chartWrap = document.createElement('div');
  chartWrap.className = 'chart-wrap';
  const chartInner = document.createElement('div');
  chartInner.className = 'chart-inner';
  chartInner.style.height = Math.max(360, rows.length * 56) + 'px';
  chartInner.style.width = '100%';
  const canvas = document.createElement('canvas');
  chartInner.appendChild(canvas);
  chartWrap.appendChild(chartInner);
  wrapper.appendChild(chartWrap);
  document.getElementById('tasksContainer').appendChild(wrapper);

  const ctx = canvas.getContext('2d');
  const newChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.task),
      datasets: [
        { label: 'Actual', data: rows.map(r => r.actual), backgroundColor: ACTUAL_COLOR, borderRadius: 4, barPercentage: 0.7, categoryPercentage: 0.7 },
        { label: 'Output', data: rows.map(r => r.output), backgroundColor: OUTPUT_COLOR, borderRadius: 4, barPercentage: 0.7, categoryPercentage: 0.7 }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      layout: { padding: { left: 8, right: 28 } },
      plugins: {
        legend: { labels: { color: colors.text, font: { size: 13, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        datalabels: {
          color: colors.datalabel, font: { weight: 'bold', size: 11 },
          formatter: (v) => (v !== null && v !== undefined) ? v : '',
          anchor: 'end', align: (ctx) => (ctx.raw ?? 0) < 0 ? 'left' : 'right', clamp: true,
          backgroundColor: () => html.getAttribute('data-theme') === 'dark' ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.8)',
          borderRadius: 4, padding: { top: 2, bottom: 2, left: 5, right: 5 }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg, titleColor: colors.tooltipText, bodyColor: colors.tooltipText,
          borderColor: colors.tooltipBorder, borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 4
        }
      },
      scales: {
        x: {
          ticks: { color: colors.text, font: { size: 11, weight: '500' }, precision: 0 },
          grid: { color: colors.grid },
          title: { display: true, text: 'Value', color: colors.text, font: { size: 12, weight: '600' } }
        },
        y: {
          ticks: { color: colors.text, font: { size: 11, weight: '500' }, autoSkip: false },
          grid: { color: colors.grid }
        }
      }
    }
  });
  activeCharts.push(newChart);
}

function renderCombinedView(emp, colors) {
  const labels = getPeriodLabels();
  const sel = document.getElementById('periodSelect');
  let periodIndex = parseInt(sel.value, 10);
  if (isNaN(periodIndex)) periodIndex = labels.length - 1;

  const rows = computeCombinedData(emp, periodIndex);
  renderStatsCombined(rows);

  const container = document.getElementById('tasksContainer');
  if (rows.length === 0) {
    container.innerHTML = `<div class="panel"><div class="empty">Is period ke liye is employee ke koi task nahi mile.</div></div>`;
    return;
  }
  buildCombinedChart(emp, labels[periodIndex] || '', rows, colors);
}

function renderStats(allTasks) {
  const totalTasks = allTasks.length;
  const allActual = allTasks.flatMap(t => t.pairs.map(p => p.actual).filter(v => v !== null));
  const allOutput = allTasks.flatMap(t => t.pairs.map(p => p.output).filter(v => v !== null));
  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length) : 0;

  document.getElementById('statsRow').innerHTML = `
    <div class="stat"><div class="k">Total Tasks</div><div class="v">${totalTasks}</div></div>
    <div class="stat"><div class="k"><span class="legend-dot" style="background:#ef4444"></span>Actual Avg</div><div class="v">${avg(allActual).toFixed(1)}</div></div>
    <div class="stat"><div class="k"><span class="legend-dot" style="background:#3b82f6"></span>Output Avg</div><div class="v">${avg(allOutput).toFixed(1)}</div></div>
  `;
}

function buildSeriesSubchart({ seriesLabel, color, fill, values, labels, colors, minWidth, isDark, zeroLineColor, showXLabels }) {
  const labelTag = document.createElement('div');
  labelTag.style.cssText = `font-size:12px; font-weight:700; color:${color}; margin:4px 4px 2px;`;
  labelTag.textContent = seriesLabel;

  const chartWrap = document.createElement('div');
  chartWrap.className = 'chart-wrap';
  const chartInner = document.createElement('div');
  chartInner.className = 'chart-inner';
  chartInner.style.height = '210px';
  chartInner.style.width = minWidth + 'px';
  const canvas = document.createElement('canvas');
  chartInner.appendChild(canvas);
  chartWrap.appendChild(chartInner);

  const outer = document.createElement('div');
  outer.appendChild(labelTag);
  outer.appendChild(chartWrap);

  // Har series apni khud ki hasNegative check karti hai — taaki jis series mein
  // delay/negative value ho sirf uska hi axis reverse ho (zero neeche fix, negative upar).
  const hasNegative = values.some(v => v !== null && v < 0);

  // Jab sab values 0 (ya missing) hon, Chart.js apne aap ek chhota decimal range
  // (jaise -1 se 1, step 0.5) bana deta hai jo dekhne mein ajeeb lagta hai.
  // Isliye is case mein axis ko khud se ek clean whole-number range de rahe hain.
  const nonNull = values.filter(v => v !== null);
  const allZero = nonNull.length > 0 && nonNull.every(v => v === 0);

  // Peak point (chart ke sabse upar wale point) ki datalabel value cut/clip na ho,
  // isliye axis mein thoda extra "headroom" jodte hain — na to axis ka top exact
  // data ke peak ke barabar rahe.
  let suggestedMin, suggestedMax;
  if (!allZero && nonNull.length > 0) {
    const dataMin = Math.min(...nonNull, 0);
    const dataMax = Math.max(...nonNull, 0);
    const range = Math.max(dataMax - dataMin, 1);
    const pad = Math.max(Math.ceil(range * 0.25), 2);
    if (hasNegative) {
      // Axis reversed hai: sabse negative value canvas ke TOP par dikhti hai,
      // isliye min ko aur neeche (aur negative) kar ke top par jagah banate hain.
      suggestedMin = dataMin - pad;
      suggestedMax = 0;
    } else {
      // Normal axis: sabse badi value TOP par hoti hai, max ko aur upar badhate hain.
      suggestedMin = 0;
      suggestedMax = dataMax + pad;
    }
  }

  const ctx = canvas.getContext('2d');
  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: seriesLabel,
        data: values,
        borderColor: color, backgroundColor: fill,
        pointBackgroundColor: color, pointBorderColor: colors.pointBorder,
        pointBorderWidth: 2, pointRadius: 6, pointHoverRadius: 8,
        borderWidth: 3, tension: 0.3, fill: true, spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 26, right: 14, left: 4, bottom: 2 } },
      plugins: {
        legend: { display: false },
        datalabels: {
          color: colors.datalabel, font: { weight: 'bold', size: 11 },
          formatter: (v) => (v !== null && v !== undefined) ? v : '',
          align: 'top', offset: 8, clamp: true,
          backgroundColor: () => html.getAttribute('data-theme') === 'dark' ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.8)',
          borderRadius: 4, padding: { top: 2, bottom: 2, left: 5, right: 5 }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg, titleColor: colors.tooltipText, bodyColor: colors.tooltipText,
          borderColor: colors.tooltipBorder, borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 4
        }
      },
      scales: {
        x: {
          ticks: {
            display: showXLabels, color: colors.text, maxRotation: 60, minRotation: 60, autoSkip: false,
            font: { size: 10, weight: '500' },
            callback: function (value) { return shortenPeriodLabel(this.getLabelForValue(value)); }
          },
          grid: { color: colors.grid }
        },
        y: {
          reverse: hasNegative,
          min: allZero ? 0 : undefined,
          max: allZero ? 5 : undefined,
          suggestedMin: allZero ? undefined : suggestedMin,
          suggestedMax: allZero ? undefined : suggestedMax,
          ticks: {
            color: colors.text, font: { size: 11, weight: '500' },
            precision: 0,                     // hamesha whole-number ticks, 0.5 jaise decimal kabhi nahi
            stepSize: allZero ? 1 : undefined
          },
          grid: {
            color: (c) => c.tick && c.tick.value === 0 ? zeroLineColor : colors.grid,
            lineWidth: (c) => c.tick && c.tick.value === 0 ? 2 : 1
          },
          title: { display: true, text: 'Value', color: colors.text, font: { size: 12, weight: '600' } }
        }
      }
    }
  });

  return { outer, chart };
}

function buildChartForTask(taskInfo, colors) {
  const wrapper = document.createElement('div');
  wrapper.className = 'panel';

  const title = document.createElement('div');
  title.className = 'chart-title';
  title.innerHTML = `${taskInfo.task}`;
  wrapper.appendChild(title);

  const sub = document.createElement('div');
  sub.className = 'chart-sub';
  sub.textContent = 'Actual vs Output — do alag panels mein (lines mix/cross nahi hoti)';
  wrapper.appendChild(sub);

  document.getElementById('tasksContainer').appendChild(wrapper);

  const labels = taskInfo.pairs.map(p => p.label);
  const minWidth = Math.max(700, taskInfo.pairs.length * 100);
  const isDark = html.getAttribute('data-theme') === 'dark';
  const zeroLineColor = isDark ? '#f8fafc' : '#1a1d21';

  // Actual — upar wala panel, X-axis labels hide (space bachane ke liye; dono panels same x share karte hain)
  const actualBlock = buildSeriesSubchart({
    seriesLabel: 'Actual', color: ACTUAL_COLOR, fill: ACTUAL_FILL,
    values: taskInfo.pairs.map(p => p.actual),
    labels, colors, minWidth, isDark, zeroLineColor,
    showXLabels: false
  });
  wrapper.appendChild(actualBlock.outer);
  activeCharts.push(actualBlock.chart);

  // Output — neeche wala panel, X-axis labels yahin dikhte hain
  const outputBlock = buildSeriesSubchart({
    seriesLabel: 'Output', color: OUTPUT_COLOR, fill: OUTPUT_FILL,
    values: taskInfo.pairs.map(p => p.output),
    labels, colors, minWidth, isDark, zeroLineColor,
    showXLabels: true
  });
  wrapper.appendChild(outputBlock.outer);
  activeCharts.push(outputBlock.chart);
}

function renderAllCharts(emp) {
  activeCharts.forEach(c => c.destroy());
  activeCharts = [];
  const container = document.getElementById('tasksContainer');
  container.innerHTML = '';
  const colors = getUIColors();

  if (currentView === 'combined') {
    renderCombinedView(emp, colors);
    return;
  }

  // Sirf wahi tasks rakho jinke kisi bhi pair mein actual ya output ki koi
  // real value ho (0 bhi valid value hai). Jin tasks mein har jagah data
  // hi missing/null hai (kabhi report hi nahi hua), unhe hide kar do.
  // Saath hi jin tasks mein Actual aur Output dono hamesha zero hain,
  // unka graph bhi show nahi karna — baki sabhi tasks ka graph dikhega.
  const allTasksRaw = computeAllTasks(emp);
  const allTasks = allTasksRaw.filter(t => t.hasAnyData && !isTaskAllZero(t));

  renderStats(allTasks);

  if (allTasks.length === 0) {
    container.innerHTML = `<div class="panel"><div class="empty">Is employee ke koi task nahi mile.</div></div>`;
    return;
  }
  allTasks.forEach(taskInfo => buildChartForTask(taskInfo, colors));
}

document.getElementById('empSelect').addEventListener('change', (e) => renderAllCharts(e.target.value));
fetchData();