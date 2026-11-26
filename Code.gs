/** ThaiSIM MCI Tracking — Code.gs (Google Apps Script, V8) */
const SHEET_ID = '10YRiiAJrXIiCCYDQYmnv6cl01fPEyCIpUphBvIhNgIE';

const TABS = {
  Patients: ['ID', 'Color', 'Zone', 'TriagePoint', 'DeconStatus', 'Demo', 'CC', 'RR', 'HR', 'BP', 'SpO2', 'GCS', 'Interventions', 'Transport', 'Staff', 'Duty', 'Org', 'Updated'],
  Timeline: ['Time', 'PatientID', 'Color', 'Zone', 'TriagePoint', 'DeconStatus', 'RR', 'HR', 'BP', 'SpO2', 'GCS', 'Note', 'Staff', 'Duty', 'Org'],
  Stock: ['ID', 'Name', 'Category', 'Qty', 'Unit', 'MinAlert', 'Updated', 'Staff'],
  Staff: ['Time', 'Code', 'Duty', 'Org', 'Key', 'Name', 'Zone']
};
const P_KEYS = ['id', 'color', 'zone', 'triagePoint', 'deconStatus', 'demo', 'cc', 'rr', 'hr', 'bp', 'spo2', 'gcs', 'interventions', 'transport', 'staff', 'duty', 'org', 'updated'];
const T_KEYS = ['time', 'id', 'color', 'zone', 'triagePoint', 'deconStatus', 'rr', 'hr', 'bp', 'spo2', 'gcs', 'note', 'staff', 'duty', 'org'];
const DEFAULT_STOCK = [
  ['STK-01', 'Oxygen Tank + Mask', 'Airway', 20, 'ถัง', 5],
  ['STK-02', 'IV Set + 0.9% NSS', 'Circulation', 50, 'ชุด', 10],
  ['STK-03', 'Tourniquet / Gauze', 'Bleeding', 30, 'ชุด', 8],
  ['STK-04', 'Decon Wash Kit', 'Decontamination', 25, 'ชุด', 6],
  ['STK-05', 'C-Collar / Spine Board', 'Immobilization', 12, 'ชุด', 3],
  ['STK-06', 'Cold Pack / Dressing', 'General', 40, 'ชิ้น', 10]
];

/* ---------- Web app entry ---------- */
function doGet(e) {
  const t = HtmlService.createTemplateFromFile('index');
  t.webAppUrl = ScriptApp.getService().getUrl() || '';
  t.initId = String((e && e.parameter && e.parameter.id) || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  return t.evaluate()
    .setTitle('ThaiSIM MCI Tracking')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- Helpers ---------- */
const TZ = 'Asia/Bangkok';
const now_ = () => Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm:ss');
const str_ = v => v == null ? '' : v instanceof Date ? Utilities.formatDate(v, TZ, 'dd/MM/yyyy HH:mm:ss') : String(v);
const same_ = (a, b) => str_(a).trim().toUpperCase() === b;

function db_() {
  try { const a = SpreadsheetApp.getActiveSpreadsheet(); if (a) return a; } catch (e) {}
  return SpreadsheetApp.openById(SHEET_ID);
}

function sheet_(name) {
  const ss = db_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(TABS[name]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, TABS[name].length).setFontWeight('bold');
    if (name === 'Stock') {
      const ts = now_();
      sh.getRange(2, 1, DEFAULT_STOCK.length, 8).setValues(DEFAULT_STOCK.map(s => [...s, ts, 'System']));
    }
  }
  return sh;
}

function rows_(name) {
  const sh = sheet_(name), n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, TABS[name].length).getValues() : [];
}

const obj_ = (keys, row) => keys.reduce((o, k, i) => (o[k] = str_(row[i]), o), {});

// text=true stores everything as plain text, so values like "90/60" are never turned into dates
function put_(sh, rowNo, vals, text) {
  const r = sh.getRange(rowNo, 1, 1, vals.length);
  if (text) r.setNumberFormat('@');
  r.setValues([vals]);
}

function locked_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function who_(d) {
  const org = [d.org, d.opZone].filter(Boolean).join(' · ');
  return { org: org, label: [d.staff || 'Staff', d.duty, org].filter(Boolean).join(' · ') };
}

/* ---------- Read ---------- */
function getAllData() {
  const patients = rows_('Patients').filter(r => r[0]).map(r => obj_(P_KEYS, r));
  const stock = rows_('Stock').filter(r => r[0]).map(r => ({
    id: str_(r[0]), name: str_(r[1]), category: str_(r[2]), qty: Number(r[3]) || 0,
    unit: str_(r[4]), minAlert: Number(r[5]) || 0, updated: str_(r[6]), staff: str_(r[7])
  }));
  const seen = {}, staff = [];
  rows_('Staff').forEach(r => {
    const code = str_(r[1]).trim(), key = (str_(r[4]) || code).trim().toLowerCase();
    if (!key || seen[key]) return;
    seen[key] = true;
    staff.push({ code: code, name: str_(r[5]), duty: str_(r[2]), org: str_(r[3]), zone: str_(r[6]), time: str_(r[0]) });
  });
  return { ok: true, patients: patients, stock: stock, staff: staff, staffCount: staff.length };
}

function getPatientData(pid) {
  const id = str_(pid).trim().toUpperCase();
  const row = rows_('Patients').find(r => same_(r[0], id));
  const logs = rows_('Timeline').filter(r => same_(r[1], id)).reverse().map(r => obj_(T_KEYS, r));
  return { ok: true, patient: row ? obj_(P_KEYS, row) : null, logs: logs };
}

/* ---------- Write ---------- */
function savePatient(d) {
  const id = str_(d.id).trim().toUpperCase();
  if (!id) return { ok: false, error: 'กรุณากรอกรหัสผู้ป่วย' };
  return locked_(() => {
    const pSh = sheet_('Patients'), tSh = sheet_('Timeline'), ts = now_(), w = who_(d);
    const g = k => str_(d[k]).trim();
    const row = [id, g('color'), g('zone'), g('triagePoint'), g('deconStatus'), g('demo'), g('cc'),
      g('rr'), g('hr'), g('bp'), g('spo2'), g('gcs'), g('interventions'), g('transport'),
      w.label, g('duty'), w.org, ts];
    const at = rows_('Patients').findIndex(r => same_(r[0], id));
    put_(pSh, at > -1 ? at + 2 : pSh.getLastRow() + 1, row, true);
    put_(tSh, tSh.getLastRow() + 1, [ts, id, g('color'), g('zone'), g('triagePoint'), g('deconStatus'),
      g('rr'), g('hr'), g('bp'), g('spo2'), g('gcs'), g('note'), w.label, g('duty'), w.org], true);
    return { ok: true, id: id, all: getAllData() };
  });
}

const normCode_ = s => str_(s).replace(/\s+/g, '').toLowerCase();

// One-time registration: code, real first name, hospital, duty, work zone
function createStaff(info) {
  info = info || {};
  const code = str_(info.code).replace(/\s+/g, ''), key = normCode_(code);
  const name = str_(info.name).trim(), org = str_(info.org).trim(), duty = str_(info.duty).trim(), zone = str_(info.zone).trim();
  if (!key || !name || !org || !duty || !zone) return { ok: false, error: 'กรอกข้อมูลให้ครบทุกช่อง' };
  return locked_(() => {
    const sh = sheet_('Staff');
    if (rows_('Staff').some(r => normCode_(r[1]) === key || normCode_(r[4]) === key)) {
      return { ok: false, error: 'รหัสบุคลากรนี้ลงทะเบียนแล้ว — กลับไปเข้าสู่ระบบได้เลย' };
    }
    sh.getRange(1, 1, 1, TABS.Staff.length).setValues([TABS.Staff]);
    put_(sh, sh.getLastRow() + 1, [now_(), code, duty, org, key, name, zone], true);
    return { ok: true, staff: { code: code, name: name, org: org, duty: duty, zone: zone } };
  });
}

// Login lookup by personnel code
function findStaff(code) {
  const k = normCode_(code);
  if (!k) return { ok: true, staff: null };
  const r = rows_('Staff').find(x => normCode_(x[1]) === k || normCode_(x[4]) === k);
  if (!r) return { ok: true, staff: null };
  const legacy = str_(r[3]).split(' · '); // rows from the old version stored "org · zone" together
  return { ok: true, staff: { code: str_(r[1]), name: str_(r[5]) || str_(r[1]), duty: str_(r[2]), org: legacy[0] || '-', zone: str_(r[6]) || legacy[1] || '' } };
}

function updateStock(req) {
  return locked_(() => {
    const sh = sheet_('Stock'), id = str_(req.id).trim();
    const at = rows_('Stock').findIndex(r => str_(r[0]).trim() === id);
    if (at < 0) return { ok: false };
    const qty = Math.max(0, (Number(sh.getRange(at + 2, 4).getValue()) || 0) + (Number(req.delta) || 0));
    const ts = now_();
    sh.getRange(at + 2, 4).setValue(qty);
    sh.getRange(at + 2, 7, 1, 2).setValues([[ts, who_(req).label]]);
    return { ok: true, qty: qty, updated: ts };
  });
}

function addStockItem(item) {
  const name = str_(item.name).trim();
  if (!name) return { ok: false, error: 'กรุณากรอกชื่อรายการ' };
  return locked_(() => {
    const sh = sheet_('Stock');
    const max = rows_('Stock').reduce((m, r) => Math.max(m, parseInt(str_(r[0]).replace(/\D/g, ''), 10) || 0), 0);
    put_(sh, sh.getLastRow() + 1, ['STK-' + String(max + 1).padStart(2, '0'), name, item.category || 'General',
      Number(item.qty) || 0, item.unit || 'ชิ้น', Number(item.minAlert) || 0, now_(), who_(item).label], false);
    return { ok: true, all: getAllData() };
  });
}

/* ---------- Reset ---------- */
function clearSheet_(name) {
  const sh = sheet_(name), n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, TABS[name].length).clearContent();
}

function clearPatientsData() {
  return locked_(() => {
    ['Patients', 'Timeline'].forEach(clearSheet_);
    return { ok: true, all: getAllData() };
  });
}

function resetStockData() {
  return locked_(() => {
    clearSheet_('Stock');
    const ts = now_();
    sheet_('Stock').getRange(2, 1, DEFAULT_STOCK.length, 8).setValues(DEFAULT_STOCK.map(s => [...s, ts, 'System']));
    return { ok: true, all: getAllData() };
  });
}
