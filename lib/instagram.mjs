import { load } from 'cheerio';

export class ScrapeError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function normalizeUsername(input) {
  let value = String(input ?? '').trim();
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { /* handled below */ }
    if (!url || url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname) || url.port || url.username || url.password) {
      throw new ScrapeError('INVALID_USERNAME', 'Ingresá un @usuario o la URL de un perfil de Instagram.', 400);
    }
    value = url.pathname.replace(/^\/|\/$/g, '');
  }
  value = value.replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(value) || value.includes('..') || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct', 'about'].includes(value)) {
    throw new ScrapeError('INVALID_USERNAME', 'El usuario de Instagram no es válido. Usá letras, números, puntos o guiones bajos (máximo 30).', 400);
  }
  return value;
}

export function safeUrl(value, { media = false } = {}) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    if (media && !['cdninstagram.com', 'fbcdn.net', 'instagram.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
    return url.href;
  } catch { return ''; }
}

const text = (value, max = 2200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const count = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

export function parseInstagramResponse(body) {
  // Instagram also sends JSON as text/javascript, with an optional anti-XSSI prefix.
  // Treat it strictly as data; never evaluate the response as JavaScript.
  const source = String(body).replace(/^\s*for\s*\(\s*;\s*;\s*\)\s*;\s*/, '').trim();
  try { return [JSON.parse(source)]; } catch { /* GraphQL can stream one object per line. */ }
  const documents = [];
  for (const line of source.split(/\r?\n/)) {
    try { documents.push(JSON.parse(line)); } catch { /* not a JSON record */ }
  }
  return documents;
}

function walk(value, visit, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 45) return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit, depth + 1);
}

function normalizePost(node) {
  const shortcode = text(node.shortcode || node.code, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(shortcode)) return null;
  const carousel = node.carousel_media || node.edge_sidecar_to_children?.edges?.map(edge => edge.node) || [];
  const image = item => safeUrl(item?.display_url || item?.thumbnail_src || item?.image_versions2?.candidates?.[0]?.url, { media: true });
  const previewUrl = image(node) || image(carousel[0]);
  if (!previewUrl) return null;
  const caption = text(typeof node.caption === 'string' ? node.caption : node.caption?.text || node.edge_media_to_caption?.edges?.[0]?.node?.text);
  const type = node.product_type === 'clips' ? 'reel' : carousel.length || node.__typename === 'GraphSidecar' || node.media_type === 8 ? 'carousel' : node.is_video || node.media_type === 2 ? 'video' : 'image';
  const seconds = Number(node.taken_at || node.taken_at_timestamp);
  const date = seconds > 0 ? new Date(seconds * 1000) : null;
  return {
    id: text(String(node.id || node.pk || shortcode), 100),
    shortcode,
    mediaType: type,
    mediaTypeLabel: { image: 'Post', reel: 'Reel', carousel: 'Carousel', video: 'Video' }[type],
    previewUrl,
    permalink: `https://www.instagram.com/${type === 'reel' ? 'reel' : 'p'}/${shortcode}/`,
    caption,
    captionPreview: caption.split('\n')[0].slice(0, 100),
    timestamp: date && Number.isFinite(date.getTime()) ? date.toISOString() : '',
    childCount: carousel.length,
  };
}

export function parseInstagramPage(html, username, payloads = []) {
  username = normalizeUsername(username);
  const $ = load(html);
  const meta = key => $(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content') || '';
  const documents = [...payloads];
  $('script[type="application/json"], script[type="application/ld+json"]').each((_, element) => {
    try { documents.push(JSON.parse($(element).text())); } catch { /* non-JSON scripts are ignored */ }
  });
  // Older public pages use an assignment instead of a JSON script element.
  for (const match of html.matchAll(/window\._sharedData\s*=\s*(\{[^]*?\});\s*<\/script>/g)) {
    try { documents.push(JSON.parse(match[1])); } catch { /* format changed */ }
  }
  let user = null;
  const posts = new Map();
  const add = node => {
    const owner = node?.owner?.username || node?.user?.username;
    if (owner && owner.toLowerCase() !== username) return;
    const post = normalizePost(node || {});
    if (post) posts.set(post.shortcode, post);
  };
  for (const doc of documents) walk(doc, node => {
    if (node.username?.toLowerCase?.() === username && ('is_private' in node || 'full_name' in node || 'biography' in node)) {
      user = { ...user, ...node };
      for (const edge of node.edge_owner_to_timeline_media?.edges || []) add(edge.node);
    }
    // Only accept a post with explicit ownership, or a named profile feed.
    if ((node.owner?.username || node.user?.username)?.toLowerCase() === username) add(node);
    const connection = node.xdt_api__v1__feed__user_timeline_graphql_connection;
    for (const edge of connection?.edges || []) add(edge.node);
  });
  const visibleText = $('main, [role="main"]').text() || $('body').clone().find('script, style').remove().end().text();
  const isPrivate = user?.is_private === true || /this account is private|esta cuenta es privada/i.test(visibleText);
  if (isPrivate) throw new ScrapeError('PRIVATE_PROFILE', 'La cuenta es privada. El widget necesita un perfil público.', 422);
  const canonical = meta('og:url');
  let validCanonical = false;
  try { validCanonical = normalizeUsername(canonical) === username; } catch { /* missing profile metadata */ }
  if (!user && !validCanonical) {
    if (/page isn.t available|page not found|página no está disponible/i.test(visibleText)) throw new ScrapeError('PROFILE_NOT_FOUND', 'No se encontró ese perfil de Instagram.', 404);
    if ($('input[name="username"], input[name="password"]').length || /log in|iniciar sesi[oó]n/i.test(visibleText)) throw new ScrapeError('LOGIN_REQUIRED', 'Instagram pide iniciar sesión para mostrar este perfil. No se pudo obtener el feed público.', 422);
    throw new ScrapeError('PROFILE_UNAVAILABLE', 'Instagram no entregó un perfil público reconocible. Probá más tarde.', 502);
  }
  // Public rendered grids can expose images even when the JSON shape changes.
  $('main a[href], [role="main"] a[href]').each((_, element) => {
    const href = $(element).attr('href');
    let url;
    try { url = new URL(href, 'https://www.instagram.com'); } catch { return; }
    if (url.hostname !== 'www.instagram.com' && url.hostname !== 'instagram.com') return;
    const match = url.pathname.match(/^\/(?:([a-z0-9_.]+)\/)?(p|reel)\/([\w-]+)\/?$/i);
    if (!match || (match[1] && match[1].toLowerCase() !== username) || posts.has(match[3])) return;
    const img = $(element).find('img').first();
    const post = normalizePost({ code: match[3], display_url: img.attr('src'), caption: img.attr('alt'), product_type: match[2] === 'reel' ? 'clips' : '' });
    if (post) posts.set(post.shortcode, { ...post, caption: '', captionPreview: '' });
  });
  const description = meta('description');
  const numericMeta = meta('og:description').match(/^([\d,]+) Followers, ([\d,]+) Following, ([\d,]+) Posts/i);
  const metaCounts = numericMeta ? numericMeta.slice(1).map(value => Number(value.replaceAll(',', ''))) : [];
  const titleName = meta('og:title').split(`(@${username})`)[0].trim();
  const media = [...posts.values()].slice(0, 24).map((post, index) => ({ ...post, index: index + 1 }));
  return {
    profile: {
      igUserId: text(String(user?.id || user?.pk || ''), 100),
      username,
      displayName: text(user?.full_name || titleName || username, 160),
      biography: text(user?.biography ?? description.match(/on Instagram:\s*"([^]*)"$/)?.[1] ?? '', 500),
      website: safeUrl(user?.external_url),
      profilePictureUrl: safeUrl(user?.profile_pic_url_hd || user?.profile_pic_url || meta('og:image'), { media: true }),
      profileLink: `https://www.instagram.com/${username}/`,
      followersCount: count(user?.edge_followed_by?.count ?? user?.follower_count ?? metaCounts[0]),
      followsCount: count(user?.edge_follow?.count ?? user?.following_count ?? metaCounts[1]),
      mediaCount: count(user?.edge_owner_to_timeline_media?.count ?? user?.media_count ?? metaCounts[2]),
    },
    media,
    summary: {
      totalMedia: media.length,
      imageCount: media.filter(post => post.mediaType === 'image').length,
      reelCount: media.filter(post => post.mediaType === 'reel').length,
      carouselCount: media.filter(post => post.mediaType === 'carousel').length,
      videoCount: media.filter(post => post.mediaType === 'video').length,
      lastPublishedAt: media.map(post => post.timestamp).sort().at(-1) || '',
    },
  };
}
