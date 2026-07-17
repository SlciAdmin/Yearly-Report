// Register Chart.js Datalabels Plugin
Chart.register(ChartDataLabels);

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQXWXkUBJ8iyLK2vd9qnUJcCaiBO0-d3KmzEzgnnEypiHgxWhUQwbXYnEwUSb6xdXHyQ48x1dAcdTkk/pub?gid=131190311&single=true&output=csv";

let globalData = {};
let globalDates = [];
let chart = null;

// Theme Management
const themeToggle = document.getElementById('themeToggle');
const html = document.documentElement;

const savedTheme = localStorage.getItem('theme');
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

if (savedTheme) {
  html.setAttribute('data-theme', savedTheme);
} else if (systemPrefersDark) {
  html.setAttribute('data-theme', 'dark');
} else {
  html.setAttribute('data-theme', 'light');
}

themeToggle.addEventListener('click', () => {
  const currentTheme = html.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  
  // Re-render chart to apply new colors smoothly
  const emp = document.getElementById('empSelect').value;
  const task = document.getElementById('taskSelect').value;
  if (emp && task && globalData[emp]) {
    renderChart(emp, task);
  }
});

function getChartColors() {
  const isDark = html.getAttribute('data-theme') === 'dark';
  return {
    actual: isDark ? '#3b82f6' : '#2563eb',
    output: isDark ? '#f97316' : '#ea580c',
    datalabel: isDark ? '#ffffff' : '#1e293b',
    grid: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#94a3b8' : '#64748b',
    tooltipBg: isDark ? '#1e293b' : '#ffffff',
    tooltipText: isDark ? '#f8fafc' : '#1e293b',
    tooltipBorder: isDark ? '#475569' : '#cbd5e1'
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
      if (char === '\r' && text[i+1] === '\n') i++;
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
    const csvText = await response.text();
    const rows = parseCSV(csvText);
    
    if (rows.length < 3) throw new Error("Invalid CSV format");
    
    const row0 = rows[0];
    const datePairs = [];
    
    for (let i = 0; i < row0.length; i++) {
      const cell = row0[i] ? row0[i].trim() : '';
      if (cell.match(/January|February|March|April|May|June|July|August|September|October|November|December/)) {
        if (i + 4 < row0.length) {
          const nextCell = row0[i+4] ? row0[i+4].trim() : '';
          if (nextCell.match(/January|February|March|April|May|June|July|August|September|October|November|December/)) {
            datePairs.push({
              label: cell,
              actualCol: i + 2,
              outputCol: i + 6
            });
            i += 3;
          }
        }
      }
    }
    
    globalDates = datePairs.map(p => p.label);
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
      
      datePairs.forEach(pair => {
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
  const employees = Object.keys(globalData).sort();
  employees.forEach(emp => {
    const opt = document.createElement('option');
    opt.value = emp;
    opt.textContent = emp;
    empSelect.appendChild(opt);
  });
  
  if (employees.length > 0) {
    empSelect.value = employees[0];
    populateTasks(employees[0]);
  }
}

function populateTasks(emp) {
  const taskSelect = document.getElementById('taskSelect');
  taskSelect.innerHTML = '';
  const tasks = Object.keys(globalData[emp] || {}).sort();
  tasks.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    taskSelect.appendChild(opt);
  });
  
  if (tasks.length > 0) {
    renderChart(emp, tasks[0]);
  }
}

function renderStats(records) {
  const actualVals = records.map(r => r.actual).filter(v => v !== null);
  const outputVals = records.map(r => r.output).filter(v => v !== null);
  
  const sum = arr => arr.reduce((a,b) => a+b, 0);
  const avg = arr => arr.length ? (sum(arr)/arr.length) : 0;
  
  document.getElementById('statsRow').innerHTML = `
    <div class="stat"><div class="k"><span class="legend-dot" style="background:var(--actual)"></span>Actual Avg</div><div class="v">${avg(actualVals).toFixed(1)}</div></div>
    <div class="stat"><div class="k"><span class="legend-dot" style="background:var(--output)"></span>Output Avg</div><div class="v">${avg(outputVals).toFixed(1)}</div></div>
    <div class="stat"><div class="k">Total Entries</div><div class="v">${records.length}</div></div>
    <div class="stat"><div class="k">Actual Min / Max</div><div class="v" style="font-size:15px">${actualVals.length ? Math.min(...actualVals) : '-'} / ${actualVals.length ? Math.max(...actualVals) : '-'}</div></div>
  `;
}

function renderChart(emp, task) {
  const taskData = (globalData[emp] && globalData[emp][task]) ? globalData[emp][task] : {};
  const activeDates = globalDates.filter(d => taskData[d]);
  const records = activeDates.map(d => ({
    date: d,
    actual: taskData[d].actual,
    output: taskData[d].output
  }));
  
  const chartContainer = document.getElementById('chartContainer');
  
  if (records.length === 0) {
    chartContainer.innerHTML = '<div class="empty">Is task ke liye koi data nahi mila.</div>';
    renderStats([]);
    return;
  }
  
  chartContainer.innerHTML = '<canvas id="chart"></canvas>';
  const canvas = document.getElementById('chart');
  
  const minWidth = Math.max(800, records.length * 60);
  canvas.parentElement.style.width = minWidth + 'px';
  
  const ctx = canvas.getContext('2d');
  if (chart) chart.destroy();
  
  const colors = getChartColors();
  
  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: records.map(r => r.date),
      datasets: [
        {
          label: 'Actual',
          data: records.map(r => r.actual),
          backgroundColor: colors.actual,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 28,
        },
        {
          label: 'Output',
          data: records.map(r => r.output),
          backgroundColor: colors.output,
          borderRadius: 6,
          borderSkipped: false,
          maxBarThickness: 28,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: 'easeOutQuart'
      },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { 
          labels: { 
            color: colors.text,
            font: { size: 13, weight: '600' },
            usePointStyle: true,
            pointStyle: 'rectRounded'
          } 
        },
        datalabels: {
          color: colors.datalabel,
          font: { weight: 'bold', size: 11 },
          formatter: (value) => value !== null && value !== undefined ? value : '',
          anchor: 'end',
          align: 'top',
          offset: 4
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
  
  renderStats(records);
}

// Event Listeners
document.getElementById('empSelect').addEventListener('change', (e) => {
  populateTasks(e.target.value);
});

document.getElementById('taskSelect').addEventListener('change', (e) => {
  const emp = document.getElementById('empSelect').value;
  renderChart(emp, e.target.value);
});

// Initialize App
fetchData();