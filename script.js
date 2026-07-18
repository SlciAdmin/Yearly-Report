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

const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;
html.setAttribute('data-theme', 'dark');

themeToggle.addEventListener('click', () => {
  const cur = html.getAttribute('data-theme');
  html.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  const emp = document.getElementById('empSelect').value;
  if (emp && globalData[emp]) renderAllCharts(emp);
});

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

function buildChartForTask(taskInfo, colors) {
  const wrapper = document.createElement('div');
  wrapper.className = 'panel';

  const title = document.createElement('div');
  title.className = 'chart-title';
  title.innerHTML = `${taskInfo.task}`;
  wrapper.appendChild(title);

  const chartWrap = document.createElement('div');
  chartWrap.className = 'chart-wrap';
  const chartInner = document.createElement('div');
  chartInner.className = 'chart-inner';
  const canvas = document.createElement('canvas');
  chartInner.appendChild(canvas);
  chartWrap.appendChild(chartInner);
  wrapper.appendChild(chartWrap);
  document.getElementById('tasksContainer').appendChild(wrapper);

  const minWidth = Math.max(700, taskInfo.pairs.length * 80);
  chartInner.style.width = minWidth + 'px';

  const ctx = canvas.getContext('2d');
  const newChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: taskInfo.pairs.map(p => p.label),
      datasets: [
        {
          label: 'Actual',
          data: taskInfo.pairs.map(p => p.actual),
          borderColor: ACTUAL_COLOR, backgroundColor: ACTUAL_FILL,
          pointBackgroundColor: ACTUAL_COLOR, pointBorderColor: colors.pointBorder,
          pointBorderWidth: 2, pointRadius: 6, pointHoverRadius: 8,
          borderWidth: 3, tension: 0.3, fill: true, spanGaps: true
        },
        {
          label: 'Output',
          data: taskInfo.pairs.map(p => p.output),
          borderColor: OUTPUT_COLOR, backgroundColor: OUTPUT_FILL,
          pointBackgroundColor: OUTPUT_COLOR, pointBorderColor: colors.pointBorder,
          pointBorderWidth: 2, pointRadius: 6, pointHoverRadius: 8,
          borderWidth: 3, tension: 0.3, fill: true, spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: colors.text, font: { size: 13, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } },
        datalabels: {
          color: colors.datalabel, font: { weight: 'bold', size: 11 },
          formatter: (v) => (v !== null && v !== undefined) ? v : '',
          align: 'top', offset: 8,
          backgroundColor: () => html.getAttribute('data-theme') === 'dark' ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.8)',
          borderRadius: 4, padding: { top: 2, bottom: 2, left: 5, right: 5 }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg, titleColor: colors.tooltipText, bodyColor: colors.tooltipText,
          borderColor: colors.tooltipBorder, borderWidth: 1, padding: 12, cornerRadius: 8, displayColors: true, boxPadding: 4
        }
      },
      scales: {
        x: { ticks: { color: colors.text, maxRotation: 60, minRotation: 60, autoSkip: false, font: { size: 10, weight: '500' } }, grid: { color: colors.grid } },
        y: { ticks: { color: colors.text, font: { size: 11, weight: '500' } }, grid: { color: colors.grid }, title: { display: true, text: 'Value', color: colors.text, font: { size: 12, weight: '600' } } }
      }
    }
  });
  activeCharts.push(newChart);
}

function renderAllCharts(emp) {
  activeCharts.forEach(c => c.destroy());
  activeCharts = [];
  const container = document.getElementById('tasksContainer');
  container.innerHTML = '';

  const allTasks = computeAllTasks(emp);
  renderStats(allTasks);

  if (allTasks.length === 0) {
    container.innerHTML = `<div class="panel"><div class="empty">Is employee ke koi task nahi mile.</div></div>`;
    return;
  }
  const colors = getUIColors();
  // Sabhi tasks dikhao — zero values wale bhi
  allTasks.forEach(taskInfo => buildChartForTask(taskInfo, colors));
}

document.getElementById('empSelect').addEventListener('change', (e) => renderAllCharts(e.target.value));
fetchData();