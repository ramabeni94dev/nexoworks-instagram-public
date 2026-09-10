export function selectRefreshCandidates(widgets, { username, now = Date.now(), ttl = 6 * 3600000 } = {}) {
  return widgets.filter(widget => {
    if (username) return widget.username === username;
    if (widget.autoRefresh === false && !widget.refreshRequestedAt) return false;
    if (widget.refreshLease?.expiresAt > now) return false;
    if (widget.lastAttemptAt && now - Date.parse(widget.lastAttemptAt) < 60000) return false;
    return !!widget.refreshRequestedAt || !widget.lastAttemptAt || now - Date.parse(widget.lastAttemptAt) >= ttl;
  }).sort((a, b) => {
    const queued = Number(!!b.refreshRequestedAt) - Number(!!a.refreshRequestedAt);
    return queued || Date.parse(a.refreshRequestedAt || a.lastAttemptAt || a.createdAt) - Date.parse(b.refreshRequestedAt || b.lastAttemptAt || b.createdAt);
  });
}
