var API = '/api';
var token = localStorage.getItem('token');
var user = JSON.parse(localStorage.getItem('user') || 'null');
var adminLoginMode = false;
var allRoutes = [];
var driverBusId = null;
var studentTimer = null;

// ---------- helper to call backend ----------
async function api(url, method, body) {
  var options = {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' }
  };
  if (token) options.headers['Authorization'] = 'Bearer ' + token;
  if (body) options.body = JSON.stringify(body);

  var res = await fetch(API + url, options);
  var data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Something went wrong');
  return data;
}

function hideAll() {
  document.getElementById('authSection').style.display = 'none';
  document.getElementById('adminSection').style.display = 'none';
  document.getElementById('studentSection').style.display = 'none';
  document.getElementById('driverSection').style.display = 'none';
}

// ---------- login / register ----------
function showRegister(flag) {
  document.getElementById('loginBox').style.display = flag ? 'none' : 'block';
  document.getElementById('registerBox').style.display = flag ? 'block' : 'none';
  document.getElementById('authMsg').innerText = '';
}

function setAdminMode(flag) {
  adminLoginMode = flag;
  showRegister(false);
  document.getElementById('loginTitle').innerText = flag ? 'Admin Login' : 'Login';
  document.getElementById('loginButton').innerText = flag ? 'Admin Login' : 'Login';
  document.getElementById('adminHint').style.display = flag ? 'block' : 'none';
  document.getElementById('adminLoginLink').style.display = flag ? 'none' : 'block';
  document.getElementById('regularLoginLink').style.display = flag ? 'block' : 'none';
  document.getElementById('registerLink').style.display = flag ? 'none' : 'block';
}

async function register() {
  var body = {
    name: document.getElementById('regName').value,
    email: document.getElementById('regEmail').value,
    password: document.getElementById('regPassword').value,
    contact: document.getElementById('regContact').value,
    address: document.getElementById('regAddress').value,
    role: document.getElementById('regRole').value
  };
  try {
    var data = await api('/auth/register', 'POST', body);
    alert(data.message);
    showRegister(false);
  } catch (e) {
    document.getElementById('authMsg').innerText = e.message;
  }
}

async function login() {
  var body = {
    email: document.getElementById('loginEmail').value,
    password: document.getElementById('loginPassword').value
  };
  try {
    var data = await api('/auth/login', 'POST', body);
    if (adminLoginMode && data.user.role !== 'admin') {
      document.getElementById('authMsg').innerText = 'This account does not have administrator access.';
      return;
    }
    token = data.token;
    user = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    openDashboard();
  } catch (e) {
    document.getElementById('authMsg').innerText = e.message;
  }
}

function logout() {
  localStorage.clear();
  token = null;
  user = null;
  clearInterval(studentTimer);
  location.reload();
}

function openDashboard() {
  hideAll();
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('whoami').innerText = user.name + ' (' + user.role + ')';

  if (user.role === 'admin') {
    document.getElementById('adminSection').style.display = 'block';
    loadAdmin();
  } else if (user.role === 'student') {
    document.getElementById('studentSection').style.display = 'block';
    loadStudent();
  } else {
    document.getElementById('driverSection').style.display = 'block';
    loadDriver();
  }
}

// ---------- ADMIN ----------
async function loadAdmin() {
  await loadSummary();
  await loadDropdowns();
  await loadBuses();
  await loadRoutes();
}

async function loadSummary() {
  var s = await api('/admin/summary');
  document.getElementById('sBuses').innerText = s.totalBuses;
  document.getElementById('sRoutes').innerText = s.activeRoutes;
  document.getElementById('sStudents').innerText = s.studentsAllocated;
  document.getElementById('sEnRoute').innerText = s.busesEnRoute;
}

async function loadDropdowns() {
  var drivers = await api('/admin/users/driver');
  var students = await api('/admin/users/student');
  var buses = await api('/buses');
  allRoutes = await api('/routes');

  var d = '<option value="">-- select driver --</option>';
  drivers.forEach(function (x) { d += '<option value="' + x._id + '">' + x.name + '</option>'; });
  document.getElementById('busDriver').innerHTML = d;

  var b = '<option value="">-- select bus --</option>';
  buses.forEach(function (x) { b += '<option value="' + x._id + '">' + x.busNumber + '</option>'; });
  document.getElementById('routeBus').innerHTML = b;

  var s = '<option value="">-- select student --</option>';
  students.forEach(function (x) { s += '<option value="' + x._id + '">' + x.name + '</option>'; });
  document.getElementById('allocStudent').innerHTML = s;

  var r = '<option value="">-- select route --</option>';
  allRoutes.forEach(function (x) { r += '<option value="' + x._id + '">' + x.routeName + '</option>'; });
  document.getElementById('allocRoute').innerHTML = r;

  fillStops();
}

// fills stop dropdown when route is picked
function fillStops() {
  var routeId = document.getElementById('allocRoute').value;
  var html = '<option value="">Auto (match student address)</option>';
  allRoutes.forEach(function (r) {
    if (r._id === routeId) {
      r.stops.forEach(function (s) { html += '<option value="' + s + '">' + s + '</option>'; });
    }
  });
  document.getElementById('allocStop').innerHTML = html;
}

async function addBus() {
  try {
    await api('/buses', 'POST', {
      busNumber: document.getElementById('busNumber').value,
      capacity: document.getElementById('busCapacity').value,
      driverId: document.getElementById('busDriver').value
    });
    document.getElementById('adminMsg').innerText = 'Bus added';
    document.getElementById('busNumber').value = '';
    document.getElementById('busCapacity').value = '';
    loadAdmin();
  } catch (e) {
    document.getElementById('adminMsg').innerText = e.message;
  }
}

async function addRoute() {
  var stops = document.getElementById('routeStops').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var timings = document.getElementById('routeTimings').value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  try {
    await api('/routes', 'POST', {
      routeName: document.getElementById('routeName').value,
      stops: stops,
      timings: timings,
      busId: document.getElementById('routeBus').value
    });
    document.getElementById('adminMsg').innerText = 'Route added';
    document.getElementById('routeName').value = '';
    document.getElementById('routeStops').value = '';
    document.getElementById('routeTimings').value = '';
    loadAdmin();
  } catch (e) {
    document.getElementById('adminMsg').innerText = e.message;
  }
}

async function assignStudent() {
  try {
    var data = await api('/routes/assign', 'POST', {
      studentId: document.getElementById('allocStudent').value,
      routeId: document.getElementById('allocRoute').value,
      assignedStop: document.getElementById('allocStop').value
    });
    document.getElementById('adminMsg').innerText = data.message;
    loadSummary();
  } catch (e) {
    document.getElementById('adminMsg').innerText = e.message;
  }
}

async function loadBuses() {
  var buses = await api('/buses');
  var html = '';
  buses.forEach(function (b) {
    html += '<tr><td>' + b.busNumber + '</td><td>' + b.capacity + '</td><td>' +
      (b.driverId ? b.driverId.name : '-') + '</td><td>' + b.tripStatus + '</td><td>' +
      (b.currentStop || '-') + '</td></tr>';
  });
  document.getElementById('busTable').innerHTML = html;
}

async function loadRoutes() {
  var routes = await api('/routes');
  var html = '';
  routes.forEach(function (r) {
    html += '<tr><td>' + r.routeName + '</td><td>' + r.stops.join(' → ') + '</td><td>' +
      (r.busId ? r.busId.busNumber : '-') + '</td><td>' + (r.driverId ? r.driverId.name : '-') + '</td><td>' +
      '<select onchange="changeStatus(\'' + r._id + '\', this.value)">' +
      makeOption('Running', r.status) + makeOption('Delayed', r.status) + makeOption('Maintenance', r.status) +
      '</select></td></tr>';
  });
  document.getElementById('routeTable').innerHTML = html;
}

function makeOption(value, current) {
  return '<option value="' + value + '"' + (value === current ? ' selected' : '') + '>' + value + '</option>';
}

async function changeStatus(id, status) {
  await api('/routes/' + id + '/status', 'PUT', { status: status });
  loadSummary();
}

// ---------- STUDENT ----------
async function loadStudent() {
  var card = document.getElementById('myRouteCard');
  try {
    var r = await api('/routes/student/' + user.id);
    var stopsHtml = '';
    r.stops.forEach(function (s) {
      stopsHtml += '<span class="' + (s === r.assignedStop ? 'mine' : '') + '">' + s + '</span>';
    });
    card.innerHTML =
      '<p><b>Route:</b> ' + r.routeName + ' (' + r.routeStatus + ')</p>' +
      '<p><b>Bus Number:</b> ' + r.busNumber + '</p>' +
      '<p><b>Driver:</b> ' + r.driverName + ' - ' + r.driverContact + '</p>' +
      '<p><b>Your Stop:</b> ' + r.assignedStop + '</p>' +
      '<p><b>Timings:</b> ' + (r.timings.length ? r.timings.join(', ') : '-') + '</p>' +
      '<div class="stop-list"><p><b>Stops:</b></p>' + stopsHtml + '</div>';

    window.myBusId = r.busId;
    loadStudentStatus();
    clearInterval(studentTimer);
    studentTimer = setInterval(loadStudentStatus, 5000); // refresh every 5 sec
  } catch (e) {
    card.innerText = e.message;
  }
}

async function loadStudentStatus() {
  if (!window.myBusId) return;
  try {
    var s = await api('/buses/' + window.myBusId + '/status');
    document.getElementById('liveBox').innerText = s.message;
    document.getElementById('etaBox').innerText =
      'Trip status: ' + s.tripStatus + (s.eta !== null ? ' | ETA: ' + s.eta + ' min' : '');
  } catch (e) {
    document.getElementById('liveBox').innerText = e.message;
  }
}

// ---------- DRIVER ----------
async function loadDriver() {
  var card = document.getElementById('driverRouteCard');
  try {
    var r = await api('/routes/driver/me');
    driverBusId = r.busId._id;
    card.innerHTML =
      '<p><b>Route:</b> ' + r.routeName + '</p>' +
      '<p><b>Bus:</b> ' + r.busId.busNumber + '</p>' +
      '<p><b>Stops:</b> ' + r.stops.join(' → ') + '</p>' +
      '<p><b>Current Stop:</b> ' + (r.busId.currentStop || '-') + '</p>' +
      '<p><b>Trip Status:</b> ' + r.busId.tripStatus + '</p>';
  } catch (e) {
    card.innerText = e.message;
  }
}

async function tripAction(action) {
  try {
    var data = await api('/buses/' + driverBusId + '/location', 'PUT', { action: action });
    document.getElementById('driverMsg').style.color = 'green';
    document.getElementById('driverMsg').innerText = data.message;
    loadDriver();
  } catch (e) {
    document.getElementById('driverMsg').style.color = '#c0392b';
    document.getElementById('driverMsg').innerText = e.message;
  }
}

// ---------- on page load ----------
if (token && user) {
  openDashboard();
}