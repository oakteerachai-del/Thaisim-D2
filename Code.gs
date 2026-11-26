var SHEET_ID = '10YRiiAJrXIiCCYDQYmnv6cl01fPEyCIpUphBvIhNgIE';
var DEMO_USERNAME = 'DemoThaiSIM001';

var DEFAULT_STOCK = [
  { id: 'STK-01', name: 'Oxygen Tank + Mask', category: 'Airway', qty: 20, unit: 'ถัง', minAlert: 5 },
  { id: 'STK-02', name: 'IV Set + 0.9% NSS', category: 'Circulation', qty: 50, unit: 'ชุด', minAlert: 10 },
  { id: 'STK-03', name: 'Tourniquet / Gauze', category: 'Bleeding', qty: 30, unit: 'ชุด', minAlert: 8 },
  { id: 'STK-04', name: 'Decon Wash Kit', category: 'Decontamination', qty: 25, unit: 'ชุด', minAlert: 6 },
  { id: 'STK-05', name: 'C-Collar / Spine Board', category: 'Immobilization', qty: 12, unit: 'ชุด', minAlert: 3 },
  { id: 'STK-06', name: 'Cold Pack / Dressing', category: 'General', qty: 40, unit: 'ชิ้น', minAlert: 10 }
];

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ใช้เฉพาะเมื่อต้องแตะ Google Sheets จริง ๆ เท่านั้น ไม่เรียกตอนลงทะเบียน/ล็อกอิน
function touchSheetIfConfigured_() {
  if (!SHEET_ID) return;
  try {
    SpreadsheetApp.openById(SHEET_ID);
  } catch (e) {}
}

function getDb_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty('THAISIM_DB_V2');
  var db;
  if (raw) {
    db = JSON.parse(raw);
  } else {
    var defaultIncId = 'inc-default';
    var nowIso = new Date().toISOString();
    db = {
      staff: [
        {
          id: 'st-demo',
          username: DEMO_USERNAME,
          name: 'สาธิต',
          org: 'ThaiSIM',
          duty: 'Paramedic',
          opZone: 'Treatment',
          callSign: 'SIM-01',
          personnelCode: '001',
          version: 1,
          lastSeen: Date.now()
        }
      ],
      incidents: [
        {
          id: defaultIncId,
          name: 'ฝึกซ้อมอุบัติภัยหมู่ (MCI Drill)',
          createdAt: nowIso,
          openedAt: nowIso,
          closedAt: null,
          status: 'open'
        }
      ],
      patientsByIncident: {},
      historyByIncident: {},
      stockByIncident: {},
      movementsByIncident: {}
    };
    db.patientsByIncident[defaultIncId] = [];
    db.historyByIncident[defaultIncId] = [];
    db.stockByIncident[defaultIncId] = DEFAULT_STOCK.map(function(x) {
      return Object.assign({}, x, { updatedAt: nowIso, staff: 'System' });
    });
    db.movementsByIncident[defaultIncId] = [];
    props.setProperty('THAISIM_DB_V2', JSON.stringify(db));
  }
  return { props: props, db: db };
}

function saveDb_(props, db) {
  props.setProperty('THAISIM_DB_V2', JSON.stringify(db));
}

function ensureIncidentBuckets_(db, incId) {
  if (!db.patientsByIncident[incId]) db.patientsByIncident[incId] = [];
  if (!db.historyByIncident[incId]) db.historyByIncident[incId] = [];
  if (!db.stockByIncident[incId]) {
    var nowIso = new Date().toISOString();
    db.stockByIncident[incId] = DEFAULT_STOCK.map(function(x) {
      return Object.assign({}, x, { updatedAt: nowIso, staff: 'System' });
    });
  }
  if (!db.movementsByIncident[incId]) db.movementsByIncident[incId] = [];
}

function findStaffByToken_(db, token) {
  if (!token) return null;
  var t = String(token).trim().toLowerCase();
  for (var i = 0; i < db.staff.length; i++) {
    var s = db.staff[i];
    if (String(s.id).toLowerCase() === t || String(s.username).toLowerCase() === t) {
      return s;
    }
  }
  return null;
}

function computeTriageReview_(patients, historyList) {
  var byPatient = {};
  (historyList || []).forEach(function(h) {
    if (!h.patientId || !h.color) return;
    if (!byPatient[h.patientId]) byPatient[h.patientId] = [];
    byPatient[h.patientId].push(h);
  });
  var rank = { red: 4, yellow: 3, green: 2, black: 1 };
  var matchedCases = 0, higherDirection = 0, lowerDirection = 0, unchanged = 0, blackCases = 0, primaryCases = 0, withoutSecondary = 0;
  var changes = [];

  Object.keys(byPatient).forEach(function(pid) {
    var logs = byPatient[pid];
    var prim = null, sec = null;
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].triagePoint === 'primary' && !prim) prim = logs[i];
      if (logs[i].triagePoint === 'secondary') sec = logs[i];
    }
    if (prim) primaryCases++;
    if (prim && !sec) withoutSecondary++;
    if (prim && sec) {
      matchedCases++;
      if (prim.color === 'black' || sec.color === 'black') blackCases++;
      var r1 = rank[prim.color] || 0;
      var r2 = rank[sec.color] || 0;
      if (r2 > r1) higherDirection++;
      else if (r2 < r1) lowerDirection++;
      else unchanged++;
      if (prim.color !== sec.color) {
        changes.push({ id: pid, primary: prim.color, secondary: sec.color });
      }
    }
  });

  var coveragePercent = primaryCases ? Math.round((matchedCases / primaryCases) * 100) : null;
  return {
    matchedCases: matchedCases,
    coveragePercent: coveragePercent,
    higherDirection: higherDirection,
    lowerDirection: lowerDirection,
    unchanged: unchanged,
    blackCases: blackCases,
    primaryCases: primaryCases,
    withoutSecondary: withoutSecondary,
    changes: changes
  };
}

function doGet(e) {
  var ctx = getDb_();
  var db = ctx.db;
  var p = (e && e.parameter) || {};
  var route = p.route || '';
  var token = p.token || '';
  var incId = p.incidentId || (db.incidents[0] ? db.incidents[0].id : 'legacy');
  var staff = findStaffByToken_(db, token);

  if (route === '/api/session') {
    return jsonOut_({ demoUsername: DEMO_USERNAME, staff: staff || null });
  }
  if (route === '/api/incidents') {
    var list = (db.incidents || []).map(function(inc) {
      var pts = (db.patientsByIncident[inc.id] || []).filter(function(x) { return !x.deletedAt; });
      return Object.assign({}, inc, { patientCount: pts.length });
    });
    return jsonOut_({ incidents: list });
  }
  if (route === '/api/overview') {
    ensureIncidentBuckets_(db, incId);
    var incident = null;
    for (var i = 0; i < db.incidents.length; i++) {
      if (db.incidents[i].id === incId) incident = db.incidents[i];
    }
    var activePatients = (db.patientsByIncident[incId] || []).filter(function(x) { return !x.deletedAt; });
    var maxNum = 0;
    activePatients.forEach(function(pt) {
      var m = String(pt.id).match(/(\d+)$/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    var nextPatientId = 'MCI-' + String(maxNum + 1).padStart(3, '0');
    var nowMs = Date.now();
    var onlineCount = (db.staff || []).filter(function(s) { return s.lastSeen && (nowMs - s.lastSeen < 120000); }).length;

    if (p.view === 'intake') {
      return jsonOut_({ incident: incident, nextPatientId: nextPatientId });
    }
    return jsonOut_({
      incident: incident,
      patients: activePatients,
      stock: db.stockByIncident[incId] || [],
      staffCount: db.staff.length,
      onlineStaffCount: Math.max(1, onlineCount),
      nextPatientId: nextPatientId,
      triageReview: computeTriageReview_(activePatients, db.historyByIncident[incId] || [])
    });
  }
  if (route.indexOf('/api/patients/') === 0) {
    ensureIncidentBuckets_(db, incId);
    var pid = decodeURIComponent(route.replace('/api/patients/', '')).toUpperCase();
    var found = null;
    (db.patientsByIncident[incId] || []).forEach(function(pt) {
      if (String(pt.id).toUpperCase() === pid) found = pt;
    });
    var hist = (db.historyByIncident[incId] || []).filter(function(h) {
      return String(h.patientId).toUpperCase() === pid;
    }).slice().reverse();
    var movs = (db.movementsByIncident[incId] || []).filter(function(m) {
      return String(m.patientId).toUpperCase() === pid;
    });
    return jsonOut_({ patient: found, history: hist, stockMovements: movs });
  }
  if (route === '/api/manage') {
    ensureIncidentBuckets_(db, incId);
    var incidentObj = null;
    db.incidents.forEach(function(x) { if (x.id === incId) incidentObj = x; });
    return jsonOut_({
      canManage: Boolean(staff && staff.username === DEMO_USERNAME),
      canDeleteIncidents: Boolean(staff && staff.username === DEMO_USERNAME),
      incident: incidentObj,
      patients: (db.patientsByIncident[incId] || []).filter(function(x) { return !x.deletedAt; }),
      accounts: db.staff,
      incidents: db.incidents.map(function(x) {
        return Object.assign({}, x, {
          patientCount: (db.patientsByIncident[x.id] || []).filter(function(pt) { return !pt.deletedAt; }).length
        });
      })
    });
  }
  return jsonOut_({ ok: true });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var ctx = getDb_();
    var db = ctx.db;
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var route = body.route || '';
    var method = (body.method || 'POST').toUpperCase();
    var payload = body.body || {};
    var token = body.token || '';
    var incId = body.incidentId || (db.incidents[0] ? db.incidents[0].id : 'legacy');
    var staff = findStaffByToken_(db, token);

    if (route === '/api/session') {
      if (method === 'DELETE') {
        return jsonOut_({ ok: true });
      }
      var uname = String(payload.username || '').trim();
      var matched = null;
      for (var i = 0; i < db.staff.length; i++) {
        if (String(db.staff[i].username).toLowerCase() === uname.toLowerCase()) {
          matched = db.staff[i];
          matched.lastSeen = Date.now();
          break;
        }
      }
      if (!matched) {
        return jsonOut_({ error: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' });
      }
      saveDb_(ctx.props, db);
      return jsonOut_({ staff: matched, token: matched.username });
    }

    if (route === '/api/register') {
      var name = String(payload.name || '').trim();
      var org = String(payload.org || '').trim();
      var duty = String(payload.duty || '').trim();
      var opZone = String(payload.opZone || '').trim();
      var pCode = String(payload.personnelCode || '000').trim() || '000';
      var seq = String(db.staff.length + 1).padStart(3, '0');
      var username = name + org.replace(/\s+/g, '') + pCode + seq;
      var newStaff = {
        id: 'st-' + Date.now() + '-' + seq,
        username: username,
        name: name,
        org: org,
        duty: duty,
        opZone: opZone,
        callSign: String(payload.callSign || '').trim(),
        personnelCode: pCode,
        version: 1,
        lastSeen: Date.now()
      };
      db.staff.push(newStaff);
      saveDb_(ctx.props, db);
      return jsonOut_({ staff: newStaff, username: username, token: username });
    }

    if (route === '/api/presence') {
      if (staff) {
        staff.lastSeen = Date.now();
        saveDb_(ctx.props, db);
      }
      var nowMs = Date.now();
      var onlineCount = (db.staff || []).filter(function(s) { return s.lastSeen && (nowMs - s.lastSeen < 120000); }).length;
      return jsonOut_({ onlineStaffCount: Math.max(1, onlineCount) });
    }

    if (route === '/api/incidents') {
      var nowIsoInc = new Date().toISOString();
      var newId = 'inc-' + Date.now();
      var newInc = {
        id: newId,
        name: String(payload.name || '').trim(),
        createdAt: nowIsoInc,
        openedAt: nowIsoInc,
        closedAt: null,
        status: 'open'
      };
      db.incidents.unshift(newInc);
      ensureIncidentBuckets_(db, newId);
      saveDb_(ctx.props, db);
      return jsonOut_({ incident: newInc });
    }

    if (route.indexOf('/api/incidents/') === 0 && method === 'PATCH') {
      var targetIncId = decodeURIComponent(route.replace('/api/incidents/', ''));
      var updatedInc = null;
      db.incidents.forEach(function(inc) {
        if (inc.id === targetIncId) {
          inc.closedAt = payload.closed ? new Date().toISOString() : null;
          inc.status = payload.closed ? 'closed' : 'open';
          updatedInc = inc;
        }
      });
      saveDb_(ctx.props, db);
      return jsonOut_({ incident: updatedInc });
    }

    ensureIncidentBuckets_(db, incId);
    var patients = db.patientsByIncident[incId];
    var history = db.historyByIncident[incId];
    var stock = db.stockByIncident[incId];
    var movements = db.movementsByIncident[incId];

    if (route === '/api/patients' || route.indexOf('/api/patients/') === 0) {
      var isPatch = (method === 'PATCH' || route.indexOf('/api/patients/') === 0);
      var pid = isPatch
        ? decodeURIComponent(route.replace('/api/patients/', '')).toUpperCase()
        : String(payload.id || '').trim().toUpperCase();

      if (!pid) {
        var maxNum = 0;
        patients.forEach(function(pt) {
          var m = String(pt.id).match(/(\d+)$/);
          if (m && parseInt(m[1], 10) > maxNum) maxNum = parseInt(m[1], 10);
        });
        pid = 'MCI-' + String(maxNum + 1).padStart(3, '0');
      }

      var existingIdx = -1;
      for (var j = 0; j < patients.length; j++) {
        if (String(patients[j].id).toUpperCase() === pid) {
          existingIdx = j;
          break;
        }
      }

      if (!isPatch && existingIdx > -1 && !patients[existingIdx].deletedAt) {
        return jsonOut_({ error: 'Duplicate patient id' });
      }

      if (isPatch && existingIdx > -1 && payload.version !== undefined && patients[existingIdx].version !== payload.version) {
        return jsonOut_({ error: 'Data stale / version conflict' });
      }

      (payload.stockUsage || []).forEach(function(u) {
        var qtyUsed = Number(u.quantity || 0);
        if (qtyUsed <= 0) return;
        for (var sIdx = 0; sIdx < stock.length; sIdx++) {
          if (stock[sIdx].id === u.stockId) {
            stock[sIdx].qty = Math.max(0, Number(stock[sIdx].qty || 0) - qtyUsed);
            stock[sIdx].updatedAt = new Date().toISOString();
            stock[sIdx].staff = staff ? staff.name : 'Staff';
            movements.push({
              patientId: pid,
              stockId: u.stockId,
              quantity: qtyUsed,
              createdAt: new Date().toISOString()
            });
          }
        }
      });

      var nowIso = new Date().toISOString();
      var prevVer = existingIdx > -1 ? (patients[existingIdx].version || 1) : 0;
      var record = {
        id: pid,
        sex: payload.sex || '',
        age: payload.age !== undefined ? payload.age : null,
        demo: payload.demo || '',
        color: payload.color || 'green',
        zone: payload.zone || 'triage',
        triagePoint: payload.triagePoint || '',
        deconStatus: payload.deconStatus || 'none',
        transport: payload.transport || '',
        cc: payload.cc || '',
        rr: payload.rr || '',
        hr: payload.hr || '',
        bp: payload.bp || '',
        spo2: payload.spo2 || '',
        gcs: payload.gcs || '',
        interventions: payload.interventions || [],
        updatedAt: nowIso,
        staff: staff ? staff.name : 'Staff',
        version: prevVer + 1,
        deletedAt: null
      };

      if (existingIdx > -1) patients[existingIdx] = record;
      else patients.push(record);

      history.push({
        patientId: pid,
        updatedAt: nowIso,
        staff: staff ? staff.name : 'Staff',
        note: payload.note || (isPatch ? 'อัปเดตแฟ้มผู้ป่วย' : 'ขึ้นทะเบียนผู้ป่วยใหม่'),
        sex: record.sex,
        age: record.age,
        color: record.color,
        zone: record.zone,
        triagePoint: record.triagePoint,
        rr: record.rr,
        hr: record.hr,
        bp: record.bp,
        spo2: record.spo2,
        gcs: record.gcs
      });

      saveDb_(ctx.props, db);

      var maxAfter = 0;
      patients.filter(function(pt) { return !pt.deletedAt; }).forEach(function(pt) {
        var m = String(pt.id).match(/(\d+)$/);
        if (m && parseInt(m[1], 10) > maxAfter) maxAfter = parseInt(m[1], 10);
      });

      return jsonOut_({
        patient: record,
        history: history.filter(function(h) { return h.patientId === pid; }).slice().reverse(),
        nextPatientId: 'MCI-' + String(maxAfter + 1).padStart(3, '0')
      });
    }

    if (route === '/api/stock/reset') {
      var nowReset = new Date().toISOString();
      db.stockByIncident[incId] = DEFAULT_STOCK.map(function(x) {
        return Object.assign({}, x, { updatedAt: nowReset, staff: staff ? staff.name : 'System' });
      });
      saveDb_(ctx.props, db);
      return jsonOut_({ stock: db.stockByIncident[incId] });
    }

    if (route === '/api/stock' && method === 'POST') {
      var nextStkNum = stock.length + 1;
      var newStk = {
        id: 'STK-' + String(nextStkNum).padStart(2, '0'),
        name: String(payload.name || '').trim(),
        category: String(payload.category || 'General').trim(),
        qty: Number(payload.qty || 0),
        unit: String(payload.unit || 'ชิ้น').trim(),
        minAlert: Number(payload.minAlert || 0),
        updatedAt: new Date().toISOString(),
        staff: staff ? staff.name : 'Staff'
      };
      stock.push(newStk);
      saveDb_(ctx.props, db);
      return jsonOut_({ stock: stock });
    }

    if (route.indexOf('/api/stock/') === 0 && method === 'PATCH') {
      var stkId = decodeURIComponent(route.replace('/api/stock/', ''));
      stock.forEach(function(item) {
        if (item.id === stkId) {
          item.qty = Math.max(0, Number(item.qty || 0) + Number(payload.delta || 0));
          item.updatedAt = new Date().toISOString();
          item.staff = staff ? staff.name : 'Staff';
        }
      });
      saveDb_(ctx.props, db);
      return jsonOut_({ stock: stock });
    }

    if (route === '/api/manage/staff' && method === 'POST') {
      var seqM = String(db.staff.length + 1).padStart(3, '0');
      var uM = String(payload.name || '').trim() + String(payload.org || '').replace(/\s+/g, '') + (payload.personnelCode || '000') + seqM;
      var stNew = {
        id: 'st-' + Date.now(),
        username: uM,
        name: payload.name,
        org: payload.org,
        duty: payload.duty,
        opZone: payload.opZone,
        callSign: payload.callSign || '',
        personnelCode: payload.personnelCode || '000',
        version: 1,
        lastSeen: Date.now()
      };
      db.staff.push(stNew);
      saveDb_(ctx.props, db);
      return jsonOut_({ staff: stNew });
    }

    if (route.indexOf('/api/manage/staff/') === 0) {
      var stTargetId = decodeURIComponent(route.replace('/api/manage/staff/', ''));
      if (method === 'PATCH') {
        db.staff.forEach(function(s) {
          if (s.id === stTargetId) {
            Object.assign(s, payload, { version: (s.version || 1) + 1 });
          }
        });
      } else if (method === 'DELETE') {
        db.staff = db.staff.filter(function(s) { return s.id !== stTargetId; });
      }
      saveDb_(ctx.props, db);
      return jsonOut_({ ok: true });
    }

    if (route.indexOf('/api/manage/patients/') === 0 && method === 'DELETE') {
      var delPid = decodeURIComponent(route.replace('/api/manage/patients/', '')).toUpperCase();
      patients.forEach(function(pt) {
        if (String(pt.id).toUpperCase() === delPid) {
          pt.deletedAt = new Date().toISOString();
          pt.version = (pt.version || 1) + 1;
        }
      });
      saveDb_(ctx.props, db);
      return jsonOut_({ ok: true });
    }

    if (route.indexOf('/api/manage/incidents/') === 0 && method === 'DELETE') {
      var delIncId = decodeURIComponent(route.replace('/api/manage/incidents/', ''));
      db.incidents = db.incidents.filter(function(x) { return x.id !== delIncId; });
      delete db.patientsByIncident[delIncId];
      delete db.historyByIncident[delIncId];
      delete db.stockByIncident[delIncId];
      delete db.movementsByIncident[delIncId];
      saveDb_(ctx.props, db);
      return jsonOut_({ ok: true });
    }

    return jsonOut_({ error: 'Not found' });
  } catch (err) {
    return jsonOut_({ error: err.message });
  } finally {
    lock.releaseLock();
  }
}
