const $ = selector => document.querySelector(selector);
let widgets = [];
let selectedId = null;
let previousSignature = '';
let loading = false;
let externalRefresh = false;
let cloudProvider = false;
let providerConfigured = true;

async function api(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Nexo-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status === 401) { location.assign('/'); throw new Error('Tu sesión venció.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la solicitud.');
  return data;
}
function notice(message) { $('#notice').textContent = message; $('#notice').hidden = !message; }
function element(tag, className, content) {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function date(value) { return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
function status(widget) {
  if (widget.refreshing) return ['loading', 'Actualizando'];
  if (widget.refreshQueued) return ['loading', 'En cola'];
  if (widget.error) {
    if (widget.available) return ['error', 'Revisar actualización'];
    const labels = {
      POSTS_UNAVAILABLE: 'No se pudo leer el feed',
      LOGIN_REQUIRED: 'Acceso restringido',
      PRIVATE_PROFILE: 'Cuenta privada',
      PROFILE_NOT_FOUND: 'Perfil no encontrado',
      RATE_LIMITED: 'Límite de Instagram',
      COOLDOWN: 'Consulta en pausa',
      TIMEOUT: 'Tiempo de espera agotado',
      BROWSER_UNAVAILABLE: 'Revisar navegador',
      NETWORK_ERROR: 'Error de conexión',
      APIFY_NOT_CONFIGURED: 'Conectar Apify',
      APIFY_AUTH: 'Revisar acceso a Apify',
      APIFY_CREDITS: 'Revisar saldo de Apify',
      APIFY_TIMEOUT: 'Tiempo de espera de Apify',
      APIFY_RUN_FAILED: 'Falló la extracción de Apify',
    };
    return ['error', labels[widget.error.code] || 'Error de lectura'];
  }
  if (widget.available && widget.snapshot?.profile.mediaCount === 0 && widget.snapshot.media.length === 0) return ['ready', 'Sin publicaciones'];
  if (widget.available) return [widget.stale ? 'loading' : 'ready', widget.stale ? 'Guardado' : 'Listo'];
  if (widget.snapshot) return ['error', 'Feed vencido'];
  return ['loading', 'Pendiente'];
}
function renderList() {
  $('#widgets').replaceChildren();
  $('#widget-count').textContent = widgets.length;
  $('#empty').hidden = widgets.length > 0;
  for (const widget of widgets) {
    const row = element('article', `widget-row${selectedId === widget.id ? ' selected' : ''}`);
    const select = element('button', 'widget-select');
    select.type = 'button';
    select.setAttribute('aria-label', `Ver widget ${widget.label}`);
    select.setAttribute('aria-pressed', String(selectedId === widget.id));
    const avatar = element('span', 'avatar', widget.username.slice(0, 2).toUpperCase());
    const description = element('span', 'widget-description');
    description.append(element('strong', '', widget.label), element('span', 'subtle', `@${widget.username}`));
    select.append(avatar, description);
    select.addEventListener('click', () => { selectedId = widget.id; renderList(); renderDetail(true); });
    const [tone, label] = status(widget);
    const state = element('span', `status ${tone}`, label);
    if (widget.error) state.title = widget.error.message;
    const actions = element('div', 'row-actions');
    const refresh = element('button', 'text-button', widget.refreshing ? 'Consultando…' : widget.refreshQueued ? 'En cola' : 'Actualizar');
    refresh.disabled = !providerConfigured || widget.refreshing || widget.refreshQueued;
    refresh.setAttribute('aria-label', `Actualizar @${widget.username}`);
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      try { const result = await api(`/api/admin/widgets/${widget.id}/refresh`, 'POST', {}); notice(result.executor === 'external' ? 'Solicitud guardada. Se procesará en la próxima ejecución del servicio de extracción.' : 'Consulta en curso. El resultado aparecerá acá.'); await reload(); }
      catch (error) { notice(error.message); refresh.disabled = false; }
    });
    const remove = element('button', 'text-button remove', 'Eliminar');
    remove.setAttribute('aria-label', `Eliminar widget de @${widget.username}`);
    remove.addEventListener('click', async () => {
      if (!window.confirm(`¿Eliminar el widget de @${widget.username}? Su iframe dejará de funcionar.`)) return;
      try { await api(`/api/admin/widgets/${widget.id}`, 'DELETE'); if (selectedId === widget.id) selectedId = null; await reload(); notice('Widget eliminado.'); }
      catch (error) { notice(error.message); }
    });
    actions.append(refresh, remove);
    row.append(select, state, actions);
    $('#widgets').append(row);
  }
}
function renderDetail(force = false) {
  const widget = widgets.find(item => item.id === selectedId);
  $('#detail').hidden = !widget;
  if (!widget) return;
  $('#detail-title').textContent = widget.label;
  const referenceTemplate = ['photo-wall', 'social-cards'].includes(widget.template);
  const parameters = referenceTemplate ? '?' + new URLSearchParams({ template: widget.template, limit: String(widget.limit), title: widget.title }) : '';
  const embedUrl = `${location.origin}/embed/${widget.id}${parameters}`;
  $('#open-widget').href = embedUrl;
  const messages = [];
  if (widget.refreshing) messages.push('Buscando publicaciones públicas. La consulta puede tardar cerca de un minuto.');
  if (widget.refreshQueued && !widget.refreshing) messages.push('Solicitud guardada. Esperando la próxima ejecución del servicio de extracción.');
  if (widget.error) messages.push(widget.error.message);
  if (widget.snapshot) messages.push(`${widget.snapshot.media.length} publicaciones guardadas · Última actualización: ${date(widget.fetchedAt)}.`);
  if (widget.imageWarning) messages.push(widget.imageWarning);
  if (widget.autoRefresh === false) messages.push('Actualización automática desactivada. Podés actualizarlo manualmente.');
  $('#detail-status').textContent = messages.join(' ');
  $('#detail-status').classList.toggle('error', !!widget.error);
  const signature = [widget.id, widget.fetchedAt, widget.template, widget.limit, widget.title, !!widget.snapshot].join('|');
  if (force || signature !== previousSignature) {
    $('#edit-title').value = widget.title;
    $('#edit-template').value = widget.template;
    $('#edit-limit').value = widget.limit;
    const previewUrl = new URL(embedUrl);
    previewUrl.searchParams.set('v', widget.fetchedAt || widget.createdAt);
    $('#preview').src = previewUrl.href;
    previousSignature = signature;
  }
  $('#preview').hidden = !widget.available;
  $('#copy').disabled = !widget.available;
  const safeTitle = widget.label.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const safeUrl = embedUrl.replaceAll('&', '&amp;');
  $('#snippet').value = `<iframe${referenceTemplate ? ' data-nexo-instagram' : ''} src="${safeUrl}" title="Instagram de ${safeTitle}" width="100%" height="${widget.template === 'photo-wall' ? 1150 : 700}" style="border:0" loading="lazy" referrerpolicy="no-referrer" allow="web-share; clipboard-write"></iframe>` +
    (referenceTemplate ? `\n<script src="${location.origin}/assets/resize.js" async></script>` : '');
}
async function reload() {
  if (loading) return;
  loading = true;
  try {
    const data = await api('/api/admin/widgets');
    const changed = JSON.stringify(data.widgets) !== JSON.stringify(widgets) || providerConfigured !== (data.extraction?.configured !== false);
    const completed = data.widgets.find(widget => !widget.refreshing && !widget.refreshQueued && widgets.some(previous => previous.id === widget.id && (previous.refreshing || previous.refreshQueued)));
    widgets = data.widgets;
    externalRefresh = data.refreshMode === 'external';
    cloudProvider = data.refreshMode === 'cloud-apify';
    providerConfigured = data.extraction?.configured !== false;
    $('#provider-status').hidden = providerConfigured;
    $('#provider-status').textContent = providerConfigured ? '' : 'Falta conectar Apify. Agregá APIFY_TOKEN en las variables del servicio y volvé a desplegar. Las imágenes guardadas siguen disponibles hasta que venza su copia.';
    $('#create-button').disabled = !providerConfigured;
    if (completed) notice(completed.error ? `Consulta finalizada: ${completed.error.message}` : `Feed de @${completed.username} actualizado.`);
    if (!selectedId || !widgets.some(widget => widget.id === selectedId)) selectedId = widgets[0]?.id || null;
    $('#logout').hidden = data.localMode;
    $('#refresh-mode').textContent = cloudProvider ? (providerConfigured ? 'Extracción con Apify*' : 'Apify pendiente de conexión') : externalRefresh ? 'Extracción mediante servicio externo*' : data.refreshMode === 'daily-and-on-demand' ? 'Actualización diaria y al consultar*' : 'Actualización automática cada hora*';
    $('.footnote').textContent = cloudProvider ? `* Las actualizaciones usan Apify y consumen saldo de ese servicio. Los feeds vencen su intervalo a las ${data.refreshIntervalMinutes / 60} horas; el programador procesa los vencidos. La última copia se conserva hasta 24 horas si falla la extracción.` : externalRefresh ? '* Las solicitudes esperan al servicio externo configurado. Se conserva el último feed durante un máximo de 24 horas si falla una actualización.' : '* Frecuencia configurable en el servidor. Se conserva el último feed obtenido durante un máximo de 24 horas si falla una actualización.';
    if (changed || $('#widgets .loading')) renderList();
    renderDetail();
  } catch (error) { notice(error.message); }
  finally { loading = false; }
}
$('#create-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  $('#create-button').disabled = true;
  $('#form-error').hidden = true;
  try {
    const { widget } = await api('/api/admin/widgets', 'POST', Object.fromEntries(new FormData(form)));
    selectedId = widget.id;
    form.reset();
    notice(`Widget de @${widget.username} creado. ${externalRefresh ? 'Esperando la próxima ejecución del servicio de extracción.' : 'Buscando sus publicaciones…'}`);
    await reload();
  } catch (error) { $('#form-error').textContent = error.message; $('#form-error').hidden = false; }
  finally { $('#create-button').disabled = false; }
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  button.disabled = true;
  try { await api(`/api/admin/widgets/${selectedId}`, 'PATCH', Object.fromEntries(new FormData(form))); await reload(); notice('Diseño guardado. La vista previa y el código están listos.'); }
  catch (error) { notice(error.message); }
  finally { button.disabled = false; }
});
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#snippet').value); notice('Iframe copiado.'); }
  catch { $('#snippet').focus(); $('#snippet').select(); notice('Seleccionamos el código. Copialo con Ctrl+C o Cmd+C.'); }
});
$('#logout').addEventListener('click', async () => { try { await api('/api/logout', 'POST', {}); location.assign('/'); } catch (error) { notice(error.message); } });
await reload();
setInterval(() => { if (!document.hidden) void reload(); }, 3500);
