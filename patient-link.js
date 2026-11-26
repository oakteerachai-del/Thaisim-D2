export function patientLink(code, incidentId = 'legacy') {
  const base = `${location.origin}${location.pathname}`;
  return `${base}?incident=${encodeURIComponent(incidentId)}&id=${encodeURIComponent(code)}`;
}
