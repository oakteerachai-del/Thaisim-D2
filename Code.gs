var SHEET_ID = '10YRiiAJrXIiCCYDQYmnv6cl01fPEyCIpUphBvIhNgIE';
var SHEET_NAMES = {
  PATIENTS: 'Patients',
  TIMELINE: 'Timeline',
  STOCK: 'Stock',
  STAFF: 'Staff'
};

var DEFAULT_STOCK = [
  ['STK-01', 'Oxygen Tank + Mask', 'Airway', 20, 'ถัง', 5, '-', 'System'],
  ['STK-02', 'IV Set + 0.9% NSS', 'Circulation', 50, 'ชุด', 10, '-', 'System'],
  ['STK-03', 'Tourniquet / Gauze', 'Bleeding', 30, 'ชุด', 8, '-', 'System'],
  ['STK-04', 'Decon Wash Kit', 'Decontamination', 25, 'ชุด', 6, '-', 'System'],
  ['STK-05', 'C-Collar / Spine Board', 'Immobilization', 12, 'ชุด', 3, '-', 'System'],
  ['STK-06', 'Cold Pack / Dressing', 'General', 40, 'ชิ้น', 10, '-', 'System']
];

function getSpreadsheet_() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}
  return SpreadsheetApp.openById(SHEET_ID);
}

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('index');
  var url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (err) {}
  template.webAppUrl = url;
  template.initId = (e && e.parameter && e.parameter.id) ? String(e.parameter.id).trim().toUpperCase() : '';
  
  return template.evaluate()
    .setTitle('ThaiSIM MCI Tracking')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function nowThai() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'dd/MM/yyyy HH:mm:ss');
}

function getOrCreateSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 && headers && headers.length) {
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f1f5f9');
    sh.setFrozenRows(1);
  }
  return sh;
}

function ensureSheetsStructure_() {
  var ss = getSpreadsheet_();
  var pSh = getOrCreateSheet_(ss, SHEET_NAMES.PATIENTS, [
    'ID', 'Color', 'Zone', 'TriagePoint', 'DeconStatus',
    'Demo', 'CC', 'RR', 'HR', 'BP', 'SpO2', 'GCS',
    'Interventions', 'Transport', 'Staff', 'Duty', 'Org', 'Updated'
  ]);
  var tSh = getOrCreateSheet_(ss, SHEET_NAMES.TIMELINE, [
    'Time', 'PatientID', 'Color', 'Zone', 'TriagePoint', 'DeconStatus',
    'RR', 'HR', 'BP', 'SpO2', 'GCS', 'Note', 'Staff', 'Duty', 'Org'
  ]);
  var sSh = getOrCreateSheet_(ss, SHEET_NAMES.STOCK, [
    'ID', 'Name', 'Category', 'Qty', 'Unit', 'MinAlert', 'Updated', 'Staff'
  ]);
  if (sSh.getLastRow() <= 1) {
    var ts = nowThai();
    for (var i = 0; i < DEFAULT_STOCK.length; i++) {
      var item = DEFAULT_STOCK[i];
      sSh.appendRow([item[0], item[1], item[2], item[3], item[4], item[5], ts, item[6]]);
    }
  }
  var stSh = getOrCreateSheet_(ss, SHEET_NAMES.STAFF, [
    'Time', 'Name', 'Duty', 'Org', 'Key'
  ]);
  return { ss: ss, pSh: pSh, tSh: tSh, sSh: sSh, stSh: stSh };
}

function getAllData() {
  var sheets = ensureSheetsStructure_();
  var pSh = sheets.pSh, sSh = sheets.sSh, stSh = sheets.stSh;
  
  var patients = [];
  if (pSh.getLastRow() > 1) {
    var rows = pSh.getRange(2, 1, pSh.getLastRow() - 1, 18).getValues();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r[0]) continue;
      patients.push({
        id: String(r[0]), color: String(r[1] || ''), zone: String(r[2] || ''),
        triagePoint: String(r[3] || ''), deconStatus: String(r[4] || ''), demo: String(r[5] || ''),
        cc: String(r[6] || ''), rr: String(r[7] || ''), hr: String(r[8] || ''), bp: String(r[9] || ''),
        spo2: String(r[10] || ''), gcs: String(r[11] || ''), interventions: String(r[12] || ''),
        transport: String(r[13] || ''), staff: String(r[14] || ''), duty: String(r[15] || ''),
        org: String(r[16] || ''), updated: String(r[17] || '')
      });
    }
  }

  var stock = [];
  if (sSh.getLastRow() > 1) {
    var sRows = sSh.getRange(2, 1, sSh.getLastRow() - 1, 8).getValues();
    for (var j = 0; j < sRows.length; j++) {
      var sr = sRows[j];
      if (!sr[0]) continue;
      stock.push({
        id: String(sr[0]), name: String(sr[1] || ''), category: String(sr[2] || ''),
        qty: Number(sr[3] || 0), unit: String(sr[4] || ''), minAlert: Number(sr[5] || 0),
        updated: String(sr[6] || ''), staff: String(sr[7] || '')
      });
    }
  }

  var staffList = [];
  var seenKeys = {};
  if (stSh.getLastRow() > 1) {
    var stRows = stSh.getRange(2, 1, stSh.getLastRow() - 1, 5).getValues();
    for (var k = 0; k < stRows.length; k++) {
      var str = stRows[k];
      var code = String(str[1] || '').trim();
      var key = String(str[4] || code).trim().toLowerCase();
      if (!code && !key) continue;
      if (seenKeys[key]) continue;
      seenKeys[key] = true;
      staffList.push({
        time: String(str[0] || ''), name: code, code: code,
        duty: String(str[2] || ''), org: String(str[3] || ''), key: String(str[4] || code)
      });
    }
  }

  return { ok: true, patients: patients, stock: stock, staffCount: staffList.length, staffList: staffList };
}

function getPatientData(pid) {
  var sheets = ensureSheetsStructure_();
  var pSh = sheets.pSh, tSh = sheets.tSh;
  var target = String(pid || '').trim().toUpperCase();
  var patient = null;

  if (pSh.getLastRow() > 1) {
    var rows = pSh.getRange(2, 1, pSh.getLastRow() - 1, 18).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim().toUpperCase() === target) {
        var r = rows[i];
        patient = {
          id: String(r[0]), color: String(r[1] || ''), zone: String(r[2] || ''),
          triagePoint: String(r[3] || ''), deconStatus: String(r[4] || ''), demo: String(r[5] || ''),
          cc: String(r[6] || ''), rr: String(r[7] || ''), hr: String(r[8] || ''), bp: String(r[9] || ''),
          spo2: String(r[10] || ''), gcs: String(r[11] || ''), interventions: String(r[12] || ''),
          transport: String(r[13] || ''), staff: String(r[14] || ''), duty: String(r[15] || ''),
          org: String(r[16] || ''), updated: String(r[17] || '')
        };
        break;
      }
    }
  }

  var logs = [];
  if (tSh.getLastRow() > 1) {
    var tRows = tSh.getRange(2, 1, tSh.getLastRow() - 1, 15).getValues();
    for (var j = tRows.length - 1; j >= 0; j--) {
      if (String(tRows[j][1]).trim().toUpperCase() === target) {
        var tr = tRows[j];
        logs.push({
          time: String(tr[0] || ''), color: String(tr[2] || ''), zone: String(tr[3] || ''),
          triagePoint: String(tr[4] || ''), deconStatus: String(tr[5] || ''), rr: String(tr[6] || ''),
          hr: String(tr[7] || ''), bp: String(tr[8] || ''), spo2: String(tr[9] || ''),
          gcs: String(tr[10] || ''), note: String(tr[11] || ''), staff: String(tr[12] || ''),
          duty: String(tr[13] || ''), org: String(tr[14] || '')
        });
      }
    }
  }

  return { ok: true, patient: patient, logs: logs };
}

function savePatient(d) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheets = ensureSheetsStructure_();
    var pSh = sheets.pSh, tSh = sheets.tSh;
    var pid = String(d.id || '').trim().toUpperCase();
    if (!pid) return { ok: false, error: 'Missing Patient ID' };
    var ts = nowThai();
    
    var orgArr = [];
    if (d.org) orgArr.push(d.org);
    if (d.opZone || d.zone) orgArr.push(d.opZone || d.zone);
    var orgWithZone = orgArr.join(' · ');
    
    var staffArr = [];
    if (d.staff) staffArr.push(d.staff);
    if (d.duty) staffArr.push(d.duty);
    if (orgWithZone) staffArr.push(orgWithZone);
    var staffLabel = staffArr.join(' · ');

    var rowData = [
      pid, d.color || '', d.zone || '', d.triagePoint || '', d.deconStatus || '',
      d.demo || '', d.cc || '', d.rr || '', d.hr || '', d.bp || '',
      d.spo2 || '', d.gcs || '', d.interventions || '', d.transport || '',
      staffLabel, d.duty || '', orgWithZone, ts
    ];

    var foundRow = -1;
    if (pSh.getLastRow() > 1) {
      var ids = pSh.getRange(2, 1, pSh.getLastRow() - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim().toUpperCase() === pid) {
          foundRow = i + 2;
          break;
        }
      }
    }

    if (foundRow > -1) {
      pSh.getRange(foundRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      pSh.appendRow(rowData);
    }

    tSh.appendRow([
      ts, pid, d.color || '', d.zone || '', d.triagePoint || '', d.deconStatus || '',
      d.rr || '', d.hr || '', d.bp || '', d.spo2 || '', d.gcs || '',
      d.note || '', staffLabel, d.duty || '', orgWithZone
    ]);

    return { ok: true, data: getPatientData(pid), all: getAllData() };
  } finally {
    lock.releaseLock();
  }
}

function registerStaff(info) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheets = ensureSheetsStructure_();
    var stSh = sheets.stSh;
    var code = String((info && (info.code || info.staffCode || info.name)) || '').trim();
    var duty = String((info && (info.duty || info.role)) || '').trim();
    var org = String((info && (info.org || info.team)) || '').trim();
    var opZone = String((info && (info.opZone || info.zone)) || '').trim();
    
    var orgLabelArr = [];
    if (org) orgLabelArr.push(org);
    if (opZone) orgLabelArr.push(opZone);
    var orgLabel = orgLabelArr.join(' · ');
    
    var key = String((info && info.key) || code).trim().toLowerCase();
    var ts = nowThai();
    if (!key) return { ok: false, all: getAllData() };

    var matchedRow = -1;
    if (stSh.getLastRow() > 1) {
      var rows = stSh.getRange(2, 1, stSh.getLastRow() - 1, 5).getValues();
      for (var i = 0; i < rows.length; i++) {
        var existingCode = String(rows[i][1] || '').trim().toLowerCase();
        var existingKey = String(rows[i][4] || '').trim().toLowerCase();
        if (existingKey === key || existingCode === key) {
          matchedRow = i + 2;
          break;
        }
      }
    }

    if (matchedRow > -1) {
      stSh.getRange(matchedRow, 1, 1, 5).setValues([[ts, code, duty, orgLabel, key]]);
    } else {
      stSh.appendRow([ts, code, duty, orgLabel, key]);
    }

    return { ok: true, all: getAllData() };
  } finally {
    lock.releaseLock();
  }
}

function updateStock(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheets = ensureSheetsStructure_();
    var sSh = sheets.sSh;
    var id = String((req && req.id) || '').trim();
    var delta = Number((req && req.delta) || 0);
    var ts = nowThai();
    
    var orgLabelArr = [];
    if (req && req.org) orgLabelArr.push(req.org);
    if (req && req.opZone) orgLabelArr.push(req.opZone);
    var orgLabel = orgLabelArr.join(' · ');
    
    var staffLabelArr = [];
    if (req && req.staff) staffLabelArr.push(req.staff);
    else staffLabelArr.push('Staff');
    if (req && req.duty) staffLabelArr.push(req.duty);
    if (orgLabel) staffLabelArr.push(orgLabel);
    var staffLabel = staffLabelArr.join(' · ');

    if (sSh.getLastRow() > 1) {
      var rows = sSh.getRange(2, 1, sSh.getLastRow() - 1, 8).getValues();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i][0]).trim() === id) {
          var nextQty = Math.max(0, Number(rows[i][3] || 0) + delta);
          sSh.getRange(i + 2, 4).setValue(nextQty);
          sSh.getRange(i + 2, 7).setValue(ts);
          sSh.getRange(i + 2, 8).setValue(staffLabel);
          return { ok: true, qty: nextQty, updated: ts };
        }
      }
    }
    return { ok: false };
  } finally {
    lock.releaseLock();
  }
}

function addStockItem(item) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheets = ensureSheetsStructure_();
    var sSh = sheets.sSh;
    var nextNum = Math.max(1, sSh.getLastRow());
    var newId = 'STK-' + String(nextNum).padStart(2, '0');
    var ts = nowThai();
    
    var orgLabelArr = [];
    if (item.org) orgLabelArr.push(item.org);
    if (item.opZone) orgLabelArr.push(item.opZone);
    var orgLabel = orgLabelArr.join(' · ');
    
    var staffLabelArr = [];
    if (item.staff) staffLabelArr.push(item.staff);
    else staffLabelArr.push('Staff');
    if (item.duty) staffLabelArr.push(item.duty);
    if (orgLabel) staffLabelArr.push(orgLabel);
    var staffLabel = staffLabelArr.join(' · ');

    sSh.appendRow([
      newId, item.name, item.category || 'General',
      Number(item.qty || 0), item.unit || 'ชิ้น', Number(item.minAlert || 5),
      ts, staffLabel
    ]);
    return { ok: true, all: getAllData() };
  } finally {
    lock.releaseLock();
  }
}

function clearPatientsData() {
  var sheets = ensureSheetsStructure_();
  var pSh = sheets.pSh, tSh = sheets.tSh, stSh = sheets.stSh;
  if (pSh.getLastRow() > 1) pSh.deleteRows(2, pSh.getLastRow() - 1);
  if (tSh.getLastRow() > 1) tSh.deleteRows(2, tSh.getLastRow() - 1);
  if (stSh.getLastRow() > 1) stSh.deleteRows(2, stSh.getLastRow() - 1);
  return { ok: true, all: getAllData() };
}

function resetStockData() {
  var sheets = ensureSheetsStructure_();
  var sSh = sheets.sSh;
  if (sSh.getLastRow() > 1) sSh.deleteRows(2, sSh.getLastRow() - 1);
  var ts = nowThai();
  for (var i = 0; i < DEFAULT_STOCK.length; i++) {
    var item = DEFAULT_STOCK[i];
    sSh.appendRow([item[0], item[1], item[2], item[3], item[4], item[5], ts, item[6]]);
  }
  return { ok: true, all: getAllData() };
}
