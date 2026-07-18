// Register Chart.js Datalabels Plugin
Chart.register(ChartDataLabels);

// gid=131190311 => "MIS-2025" tab (confirmed from sheet). Data isi tab se aata hai.
const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXWXkUBJ8iyLK2vd9qnUJcCaiBO0-d3KmzEzgnnEypiHgxWhUQwbXYnEwUSb6xdXHyQ48x1dAcdTkk/pub?gid=131190311&single=true&output=csv";

// Sirf 2025 ka data chahiye
const TARGET_YEAR = "2025";

// Fixed colors: Actual = Red, Output = Blue (theme se independent)
const ACTUAL_COLOR = '#ef4444';
const ACTUAL_FILL = 'rgba(239,68,68,0.12)';
const OUTPUT_COLOR = '#3b82f6';
const OUTPUT_FILL = 'rgba(59,130,246,0.12)';

let globalData = {};
let globalDates = [];
let activeCharts = []; // sab dynamically bane charts yahan store honge taaki destroy kar sakein
let employeesList = [];

// Theme Management
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
  html.setAttribute('data-theme', 'dark');
} else {
  html.setAttribute('data-theme', 'light');
}

themeToggle.addEventListener('click', () => {
  const currentTheme = html.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);

  const emp = document.getElementById('empSelect').value;
  if (emp && globalData[emp]) {
    renderAllCharts(emp);
  }
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

// Robust CSV Parser
function parseCSV(text) {
  const result = [];
  let row = [];
  let inQuotes = false;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current.trim());
      current = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (current || row.length > 0) {
        row.push(current.trim());
        result.push(row);
        row = [];
        current = '';
      }
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else {
      current += char;
    }
  }
  if (current || row.length > 0) {
    row.push(current.trim());
    result.push(row);
  }
  return result;
}

async function fetchData() {
  try {
    const response = await fetch(SHEET_URL);
    if (!response.ok) throw new Error("Network response not ok: " + response.status);
    const csvText = await response.text();
    const rows = parseCSV(csvText);

    if (rows.length < 3) throw new Error("Invalid CSV format");

    // Har hafte ka date-header column dhoondo (jisme ek 4-digit saal jaisa 2025/2026 ho).
    // Sheet structure: date-col => Score>NotDone (Actual); date-col+2 => Commitment>NotDone (Output)
    const row0 = rows[0];
    const datePairs = [];

    for (let i = 0; i < row0.length; i++) {
      const cell = row0[i] ? row0[i].trim() : '';
      const yearMatch = cell.match(/(20\d{2})/); // e.g. "2025", "2026"
      // Har week-block 6 columns ka hai: [Score][Not Done][Delay][Commitment][Not Done][Delay]
      // Date-label sirf pehle column (Score) mein hoti hai, isliye offset se actual/output nikaalte hain
      if (yearMatch && i + 4 < row0.length) {
        datePairs.push({
          label: cell,
          year: yearMatch[1],
          actualCol: i + 1,  // Score > Not Done
          outputCol: i + 4   // Commitment > Not Done
        });
      }
    }

    // Sirf TARGET_YEAR (2026) wale hafte-columns rakhein
    const filteredPairs = datePairs.filter(p => p.year === TARGET_YEAR);

    globalDates = filteredPairs.map(p => p.label);
    let currentTeam = '';
    const data = {};

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 2) continue;

      const team = row[0];
      const task = row[1];

      if (team && team.trim() !== '' && !team.match(/^\s*$/)) {
        currentTeam = team.trim();
      }

      if (!currentTeam || !task || task.trim() === '' || task.match(/^\s*$/)) continue;

      const cleanTask = task.trim();
      if (!data[currentTeam]) data[currentTeam] = {};
      if (!data[currentTeam][cleanTask]) data[currentTeam][cleanTask] = {};

      filteredPairs.forEach(pair => {
        let actualVal = row[pair.actualCol];
        let outputVal = row[pair.outputCol];

        actualVal = (actualVal === '' || actualVal === undefined || actualVal === null) ? null : parseFloat(actualVal);
        outputVal = (outputVal === '' || outputVal === undefined || outputVal === null) ? null : parseFloat(outputVal);

        if (!isNaN(actualVal) || !isNaN(outputVal)) {
          data[currentTeam][cleanTask][pair.label] = {
            actual: isNaN(actualVal) ? null : actualVal,
            output: isNaN(outputVal) ? null : outputVal
          };
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
  employeesList = Object.keys(globalData).sort();
  employeesList.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp;
    opt.textContent = emp;
    empSelect.appendChild(opt);
  });

  if (employeesList.length > 0) {
    empSelect.value = employeesList[0];
    document.getElementById('empSearch').value = employeesList[0];
    renderAllCharts(employeesList[0]);
  }
}

// Har task ke liye 2026 ke records banata hai aur (actual - output) ka average diff nikalta hai
function computeTaskDiffs(emp) {
  const tasks = Object.keys(globalData[emp] || {}).sort();
  const results = [];

  tasks.forEach(task => {
    const taskData = globalData[emp][task];
    const activeDates = globalDates.filter(d => taskData[d]);
    const records = activeDates.map(d => ({
      date: d,
      actual: taskData[d].actual,
      output: taskData[d].output
    }));

    let diffSum = 0;
    let count = 0;
    records.forEach(r => {
      if (r.actual !== null && r.output !== null) {
        diffSum += (r.actual - r.output);
        count++;
      }
    });

    const avgDiff = count > 0 ? (diffSum / count) : null;

    // Kitne months mein shortfall (actual < output) hua, aur list bhi banao
    const shortfallMonths = records.filter(r => r.actual !== null && r.output !== null && r.actual < r.output);
    const hasAnyShortfall = shortfallMonths.length > 0;

    results.push({ task, records, avgDiff, shortfallMonths, hasAnyShortfall });
  });

  return results;
}

function renderStats(allTaskDiffs, minusTasks) {
  const totalTasks = allTaskDiffs.length;
  const minusCount = minusTasks.length;

  const allActual = minusTasks.flatMap(t => t.records.map(r => r.actual).filter(v => v !== null));
  const allOutput = minusTasks.flatMap(t => t.records.map(r => r.output).filter(v => v !== null));
  const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  document.getElementById('statsRow').innerHTML = `
    <div class="stat"><div class="k">Total Tasks</div><div class="v">${totalTasks}</div></div>
    <div class="stat"><div class="k"><span class="legend-dot" style="background:#ef4444"></span>Tasks with Any Shortfall</div><div class="v">${minusCount}</div></div>
    <div class="stat"><div class="k">These Tasks — Actual Avg</div><div class="v">${avg(allActual).toFixed(1)}</div></div>
    <div class="stat"><div class="k">These Tasks — Output Avg</div><div class="v">${avg(allOutput).toFixed(1)}</div></div>
  `;
}

function buildChartForTask(taskInfo, colors) {
  const wrapper = document.createElement('div');
  wrapper.className = 'panel';

  const title = document.createElement('div');
  title.className = 'chart-title';
  const monthsList = taskInfo.shortfallMonths.map(r => r.date).join(', ');
  title.innerHTML = `<span class="legend-dot" style="background:#ef4444"></span>${taskInfo.task} <span style="color:var(--muted);font-weight:500;font-size:13px;margin-left:8px;">(${taskInfo.shortfallMonths.length} month${taskInfo.shortfallMonths.length > 1 ? 's' : ''} minus: ${monthsList})</span>`;
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

  const minWidth = Math.max(700, taskInfo.records.length * 70);
  chartInner.style.width = minWidth + 'px';

  const ctx = canvas.getContext('2d');

  const newChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: taskInfo.records.map(r => r.date),
      datasets: [
        {
          label: 'Actual',
          data: taskInfo.records.map(r => r.actual),
          borderColor: ACTUAL_COLOR,
          backgroundColor: ACTUAL_FILL,
          pointBackgroundColor: ACTUAL_COLOR,
          pointBorderColor: colors.pointBorder,
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8,
          borderWidth: 3,
          tension: 0.35,
          fill: true,
          spanGaps: true
        },
        {
          label: 'Output',
          data: taskInfo.records.map(r => r.output),
          borderColor: OUTPUT_COLOR,
          backgroundColor: OUTPUT_FILL,
          pointBackgroundColor: OUTPUT_COLOR,
          pointBorderColor: colors.pointBorder,
          pointBorderWidth: 2,
          pointRadius: 6,
          pointHoverRadius: 8,
          borderWidth: 3,
          tension: 0.35,
          fill: true,
          spanGaps: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: colors.text,
            font: { size: 13, weight: '600' },
            usePointStyle: true,
            pointStyle: 'circle'
          }
        },
        datalabels: {
          color: colors.datalabel,
          font: { weight: 'bold', size: 11 },
          formatter: (value) => (value !== null && value !== undefined) ? value : '',
          align: 'top',
          offset: 8,
          backgroundColor: () => html.getAttribute('data-theme') === 'dark' ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.8)',
          borderRadius: 4,
          padding: { top: 2, bottom: 2, left: 5, right: 5 }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          titleColor: colors.tooltipText,
          bodyColor: colors.tooltipText,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          displayColors: true,
          boxPadding: 4
        }
      },
      scales: {
        x: {
          ticks: { color: colors.text, maxRotation: 60, minRotation: 60, autoSkip: false, font: { size: 11, weight: '500' } },
          grid: { color: colors.grid, drawBorder: false }
        },
        y: {
          ticks: { color: colors.text, font: { size: 11, weight: '500' } },
          grid: { color: colors.grid, drawBorder: false },
          title: { display: true, text: 'Value', color: colors.text, font: { size: 12, weight: '600' } }
        }
      }
    }
  });

  activeCharts.push(newChart);
}

function renderAllCharts(emp) {
  // Purane charts destroy karo aur container khali karo
  activeCharts.forEach(c => c.destroy());
  activeCharts = [];
  const container = document.getElementById('tasksContainer');
  container.innerHTML = '';

  const allTaskDiffs = computeTaskDiffs(emp);
  // Wo saare tasks jinme KAM SE KAM ek bhi month mein shortfall (Actual < Output) hua ho
  const minusTasks = allTaskDiffs.filter(t => t.hasAnyShortfall);

  renderStats(allTaskDiffs, minusTasks);

  if (minusTasks.length === 0) {
    container.innerHTML = `<div class="panel"><div class="empty">Is employee ke ${TARGET_YEAR} tasks mein koi bhi task "minus" (shortfall) mein nahi hai. 🎉</div></div>`;
    return;
  }

  const colors = getUIColors();
  minusTasks.forEach(taskInfo => buildChartForTask(taskInfo, colors));
}

// ---- Employee dropdown ----
document.getElementById('empSelect').addEventListener('change', (e) => {
  document.getElementById('empSearch').value = e.target.value;
  renderAllCharts(e.target.value);
});

// ---- Employee search box (autocomplete) ----
const empSearchInput = document.getElementById('empSearch');
const searchResultsBox = document.getElementById('searchResults');

function showSearchResults(matches) {
  searchResultsBox.innerHTML = '';
  if (matches.length === 0) {
    searchResultsBox.classList.remove('open');
    return;
  }
  matches.forEach(name => {
    const item = document.createElement('div');
    item.textContent = name;
    item.addEventListener('click', () => {
      empSearchInput.value = name;
      document.getElementById('empSelect').value = name;
      searchResultsBox.classList.remove('open');
      renderAllCharts(name);
    });
    searchResultsBox.appendChild(item);
  });
  searchResultsBox.classList.add('open');
}

empSearchInput.addEventListener('input', () => {
  const q = empSearchInput.value.trim().toLowerCase();
  if (!q) {
    searchResultsBox.classList.remove('open');
    return;
  }
  const matches = employeesList.filter(name => name.toLowerCase().includes(q));
  showSearchResults(matches);
});

empSearchInput.addEventListener('focus', () => {
  if (empSearchInput.value.trim()) {
    const q = empSearchInput.value.trim().toLowerCase();
    const matches = employeesList.filter(name => name.toLowerCase().includes(q));
    showSearchResults(matches);
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) {
    searchResultsBox.classList.remove('open');
  }
});

// Initialize App
fetchData();