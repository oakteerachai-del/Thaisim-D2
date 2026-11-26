export function observeUpdates({ refresh, status }) {
  let timer;
  let active = true;
  let busy = false;
  const pending = new Map();

  function queue(change) {
    if (!active) return;
    pending.set([change.resource, change.incidentId].join(':'), change);
    clearTimeout(timer);
    timer = setTimeout(flush, 150);
  }

  async function flush() {
    if (!active || busy || document.hidden || !pending.size) return;
    const changes = [...pending.values()];
    pending.clear();
    busy = true;
    try {
      await refresh(changes);
    } finally {
      busy = false;
      if (active && pending.size) timer = setTimeout(flush, 150);
    }
  }

  const fullRefresh = () => queue({ resource: 'all', incidentId: null });
  const onVisible = () => {
    if (!document.hidden) {
      status('periodic');
      fullRefresh();
    }
  };

  status('periodic');
  const interval = setInterval(fullRefresh, 15000);
  document.addEventListener('visibilitychange', onVisible);

  return {
    close() {
      active = false;
      clearInterval(interval);
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
