import { patientLink } from './patient-link.js';
import { CHEMICALS, ERG_SOURCES } from './erg-data.js';

const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

export const filterChemicals = (items, query) => {
  const q = String(query || '').trim().toLowerCase();
  return !q
    ? items
    : items.filter((x) =>
        [x.un, x.nameEn, x.nameThai].some((v) =>
          String(v).toLowerCase().includes(q),
        ),
      );
};

function field(label, type, name, value, attrs = '') {
  return `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" ${attrs}></label>`;
}

function pageHead(title, sub, actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${sub}</p></div><div class="page-actions">${actions}</div></div>`;
}

function renderStock(root, state, api, notify, incidentClosed) {
  let stock = state.stock || [];
  let saving = false;
  root.innerHTML =
    pageHead(
      'คลังเวชภัณฑ์',
      'ติดตามจำนวนคงเหลือและแจ้งเตือนของใกล้หมด',
      '<button class="btn btn-danger stock-reset" type="button">รีเซ็ตข้อมูลสาธิต</button>',
    ) +
    `<section class="panel stock-controls"><div class="panel-head"><h2>รายการเวชภัณฑ์</h2><span class="badge stock-count"></span></div><div class="filters"><input class="stock-search" type="search" placeholder="ค้นหาชื่อหรือหมวดหมู่" aria-label="ค้นหาเวชภัณฑ์"></div><div class="table-wrap"><table><thead><tr><th>รายการ</th><th>หมวด</th><th>คงเหลือ</th><th>อัปเดต</th><th>การปรับจำนวน</th></tr></thead><tbody class="stock-rows"></tbody></table></div></section>` +
    `<section class="panel stock-add"><div class="panel-head"><h2>เพิ่มรายการใหม่</h2></div><form class="form-grid stock-form">${field('ชื่อรายการ', 'text', 'name', '', 'required maxlength="120"')} ${field('หมวดหมู่', 'text', 'category', 'General', 'required maxlength="80"')} ${field('จำนวน', 'number', 'qty', '0', 'min="0" step="1" required')} ${field('หน่วย', 'text', 'unit', 'ชิ้น', 'required maxlength="30"')} ${field('แจ้งเตือนเมื่อเหลือไม่เกิน', 'number', 'minAlert', '0', 'min="0" step="1" required')}<div class="page-actions"><button class="btn btn-primary" type="submit">เพิ่มเข้าคลัง</button></div></form></section>`;
  const rows = root.querySelector('.stock-rows');
  const drawRows = () => {
    const q = root.querySelector('.stock-search').value.trim().toLowerCase();
    root.querySelector('.stock-count').textContent = `${stock.length} รายการ`;
    rows.innerHTML =
      stock
        .filter((x) => `${x.name} ${x.category}`.toLowerCase().includes(q))
        .map((x) => {
          const low = Number(x.qty) <= Number(x.minAlert);
          const timestamp = x.updatedAt
            ? new Date(x.updatedAt).toLocaleString('th-TH', {
                dateStyle: 'short',
                timeStyle: 'short',
              })
            : '—';
          return `<tr><td><strong>${esc(x.name)}</strong><br><small>${esc(x.id)}</small></td><td>${esc(x.category)}</td><td><span class="badge ${low ? 'badge-low' : 'badge-ok'}">${esc(x.qty)} ${esc(x.unit)}${low ? ' · ใกล้หมด' : ''}</span></td><td>${esc(timestamp)}<br><small>${esc(x.staff || '-')}</small></td><td><div class="stock-stepper"><button class="btn btn-secondary stock-delta" data-id="${esc(x.id)}" data-delta="-5" type="button" aria-label="ลด ${esc(x.name)} 5">−5</button><button class="btn btn-secondary stock-delta" data-id="${esc(x.id)}" data-delta="-1" type="button" aria-label="ลด ${esc(x.name)} 1">−1</button><button class="btn btn-secondary stock-delta" data-id="${esc(x.id)}" data-delta="1" type="button" aria-label="เพิ่ม ${esc(x.name)} 1">+1</button><button class="btn btn-secondary stock-delta" data-id="${esc(x.id)}" data-delta="5" type="button" aria-label="เพิ่ม ${esc(x.name)} 5">+5</button></div></td></tr>`;
        })
        .join('') || '<tr><td colspan="5" class="empty">ไม่พบรายการ</td></tr>';
  };
  drawRows();
  root.querySelector('.stock-search').addEventListener('input', drawRows);
  const refreshStockRows = (next) => {
    stock = next;
    drawRows();
  };
  if (incidentClosed) {
    root.querySelector('.stock-reset').hidden = true;
    root.querySelector('.stock-add').hidden = true;
    root.querySelector('.stock-controls table').classList.add('stock-read-only');
    return refreshStockRows;
  }
  async function save(control, pathname, options, message, form) {
    if (saving) return;
    saving = true;
    control.disabled = true;
    try {
      const result = await api(pathname, options);
      state.stock = stock = result.stock;
      form?.reset();
      if (root.contains(rows)) drawRows();
      notify(message);
    } catch (e) {
      notify(e.message || 'บันทึกคลังไม่สำเร็จ', 'error');
    } finally {
      control.disabled = false;
      saving = false;
    }
  }
  rows.addEventListener('click', (event) => {
    const control = event.target.closest('.stock-delta');
    if (!control) return;
    save(
      control,
      `/api/stock/${encodeURIComponent(control.dataset.id)}`,
      { method: 'PATCH', body: { delta: Number(control.dataset.delta) } },
      'อัปเดตจำนวนแล้ว',
    );
  });
  const form = root.querySelector('.stock-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    save(
      form.querySelector('button'),
      '/api/stock',
      {
        method: 'POST',
        body: {
          ...data,
          qty: Number(data.qty),
          minAlert: Number(data.minAlert),
        },
      },
      'เพิ่มรายการแล้ว',
      form,
    );
  });
  root.querySelector('.stock-reset').addEventListener('click', (event) => {
    if (!window.confirm('รีเซ็ตคลังกลับเป็นข้อมูลฝึกซ้อมตั้งต้นหรือไม่?')) return;
    save(
      event.currentTarget,
      '/api/stock/reset',
      { method: 'POST', body: {} },
      'รีเซ็ตคลังแล้ว',
    );
  });
  return refreshStockRows;
}

function renderErg(root) {
  root.innerHTML =
    pageHead(
      'คู่มือสารเคมี',
      'ค้นเลข UN หรือชื่อสารเคมี และเปิดคู่มือ ERG4Thai ของกรมควบคุมมลพิษ',
    ) +
    `<section class="panel">
      <div class="page-actions" aria-label="ช่องทางเปิด ERG4Thai">
        <a class="btn btn-primary" href="${ERG_SOURCES.web}" target="_blank" rel="noopener">เปิดเว็บ ERG4Thai</a>
        <a class="btn btn-secondary" href="${ERG_SOURCES.ios}" target="_blank" rel="noopener">แอป iPhone / iPad</a>
        <a class="btn btn-secondary" href="${ERG_SOURCES.android}" target="_blank" rel="noopener">แอป Android</a>
      </div>
    </section>
    <section class="panel"><div class="filters"><input class="erg-search" type="search" placeholder="ค้นหา UN / ชื่อไทย / ชื่ออังกฤษ" aria-label="ค้นหาสารเคมี"></div><div class="erg-results"></div><div class="resource-links"><a href="${ERG_SOURCES.thai}" target="_blank" rel="noopener">คู่มือกรมควบคุมมลพิษ</a> · <a href="${ERG_SOURCES.phmsa}" target="_blank" rel="noopener">U.S. PHMSA ERG</a> · <a href="${ERG_SOURCES.erg2024}" target="_blank" rel="noopener">ERG2024 PDF</a></div></section>`;
  const search = root.querySelector('.erg-search');
  const results = root.querySelector('.erg-results');
  const draw = () => {
    const list = filterChemicals(CHEMICALS, search.value);
    results.innerHTML = list.length
      ? list
          .map(
            (x) =>
              `<article class="erg-result"><div><strong>UN ${esc(x.un)}</strong> · ${esc(x.nameThai)}<br><span>${esc(x.nameEn)}</span></div><span class="badge badge-guide">Guide ${esc(x.guide)}</span><a href="${esc(x.source)}" target="_blank" rel="noopener" aria-label="เปิดแหล่งข้อมูล ERG สำหรับ ${esc(x.nameEn)}">แหล่งข้อมูล</a></article>`,
          )
          .join('')
      : '<p class="empty">ไม่พบสารเคมีที่ตรงกัน</p>';
  };
  search.addEventListener('input', draw);
  draw();
}

export function qrImagePath(code, incidentId = 'legacy') {
  const target = patientLink(code, incidentId);
  return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(target)}`;
}

export function updateNextPatientCard(
  root,
  { nextPatientId, incidentId, incidentName, incidentClosed } = {},
) {
  const card = root?.querySelector?.('[data-next-patient-card]');
  if (!card) return;
  const id = nextPatientId || '';
  const closed = Boolean(incidentClosed);
  const available = Boolean(id) && !closed;
  const link = card.querySelector('.next-patient-link');
  const image = card.querySelector('.next-patient-qr');
  const idLabel = card.querySelector('.next-patient-id');
  const incidentLabel = card.querySelector('.next-patient-incident');
  const empty = card.querySelector('.next-patient-empty');
  const content = card.querySelector('.next-patient-content');
  incidentLabel.textContent = incidentName || 'ยังไม่ได้เลือกเหตุการณ์';
  empty.textContent = closed
    ? 'เหตุการณ์นี้ปิดรับผู้ป่วยแล้ว'
    : 'กำลังโหลดรหัสผู้ป่วย…';
  empty.hidden = available;
  content.hidden = !available;
  if (!available) return;
  const href = patientLink(id, incidentId || 'legacy');
  link.href = href;
  link.setAttribute('aria-label', `เปิดแฟ้ม ${id}`);
  link.title = `เปิดแฟ้ม ${id}`;
  const imagePath = qrImagePath(id, incidentId || 'legacy');
  if (image.getAttribute('src') !== imagePath) {
    const nextImage = document.createElement('img');
    nextImage.className = image.className;
    nextImage.width = nextImage.height = 150;
    nextImage.alt = `QR สำหรับรหัส ${id}`;
    nextImage.src = imagePath;
    image.replaceWith(nextImage);
  }
  idLabel.textContent = id;
}

async function printCurrentCard(root, button, notify) {
  const image = root.querySelector('.next-patient-qr');
  const content = root.querySelector('.next-patient-content');
  if (button.disabled || root.hidden || content.hidden) return;
  button.disabled = true;
  let sheet;
  try {
    await image.decode();
    if (root.hidden || !root.contains(button)) return;
    if (content.hidden || !content.contains(image)) {
      notify('QR เปลี่ยนแล้ว กรุณากดพิมพ์ใบที่แสดงอีกครั้ง', 'error');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || 150;
    canvas.height = image.naturalHeight || 150;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const code = document.createElement('strong');
    code.textContent = root.querySelector('.next-patient-id').textContent;
    const caption = document.createElement('figcaption');
    caption.textContent = root.querySelector('.next-patient-incident').textContent;
    sheet = document.createElement('figure');
    sheet.className = 'printed-patient-qr';
    sheet.append(canvas, code, caption);
    document.querySelector('.printed-patient-qr')?.remove();
    document.body.append(sheet);
    window.addEventListener('afterprint', () => sheet.remove(), { once: true });
    window.print();
  } catch {
    sheet?.remove();
    if (root.contains(button) && !root.hidden)
      notify('พิมพ์ QR ไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองอีกครั้ง', 'error');
  } finally {
    button.disabled = false;
  }
}

function renderCards(root, cardState, notify) {
  root.innerHTML =
    pageHead('QR ผู้ป่วย', 'แตะหรือสแกน QR เพื่อเปิดแฟ้มของผู้ป่วยในเหตุการณ์นี้') +
    `<section class="panel next-patient-card" data-next-patient-card aria-labelledby="next-patient-title">
      <div class="panel-head"><div><h2 id="next-patient-title">QR ผู้ป่วยคนถัดไป</h2><p class="next-patient-incident"></p></div></div>
      <div class="next-patient-content"><a class="next-patient-link"><img class="next-patient-qr" alt="" width="150" height="150"><strong class="next-patient-id" aria-live="polite"></strong></a><div class="next-patient-purpose"><p>เมื่อบันทึกข้อมูลสำเร็จ QR ของผู้ป่วยคนถัดไปจะขึ้นตรงนี้อัตโนมัติ</p><p>สแกน QR ใบเดิมอีกครั้งเพื่อดูประวัติผู้ป่วยคนนั้น</p><button type="button" class="btn btn-secondary print-current-qr">พิมพ์ QR ใบนี้</button></div></div>
      <p class="next-patient-empty" hidden></p>
    </section>`;
  updateNextPatientCard(root, cardState);
  const print = root.querySelector('.print-current-qr');
  print.addEventListener('click', () => printCurrentCard(root, print, notify));
}

export function renderExtras(
  page,
  { root, state, api, notify, incidentId, incidentName, incidentClosed },
) {
  if (!root) throw new Error('Extras root is required');
  if (page === 'stock')
    return renderStock(root, state, api, notify, incidentClosed);
  else if (page === 'erg') renderErg(root);
  else if (page === 'cards')
    renderCards(
      root,
      {
        incidentId,
        incidentName,
        nextPatientId: state?.nextPatientId,
        incidentClosed,
      },
      notify,
    );
  else root.innerHTML = '<p class="empty">ไม่พบหน้าที่เลือก</p>';
  return root;
}
