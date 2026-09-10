(function () {
  const ROOT_ID = "nexoworks-instagram-root";
  const FLASH_STATUS_PARAM = "ig_status";
  const FLASH_MESSAGE_PARAM = "ig_message";
  const TEMPLATE_SLIDER = "slider";
  const TEMPLATE_GRID = "grid";
  const TEMPLATE_HASHTAG = "hashtag-show";
  const TEMPLATE_COLLAGE = "collage";
  const TEMPLATE_POST_SLIDER = "post-slider";
  const TEMPLATE_SINGLE_POST = "single-post";
  const TEMPLATE_PHOTO_WALL = "photo-wall";
  const TEMPLATE_SOCIAL_CARDS = "social-cards";
  const KNOWN_TEMPLATES = new Set([
    TEMPLATE_SLIDER,
    TEMPLATE_GRID,
    TEMPLATE_HASHTAG,
    TEMPLATE_COLLAGE,
    TEMPLATE_POST_SLIDER,
    TEMPLATE_SINGLE_POST,
    TEMPLATE_PHOTO_WALL,
    TEMPLATE_SOCIAL_CARDS,
  ]);

  function normalizeTemplate(value = "") {
    const template = String(value || "").trim().toLowerCase();

    return KNOWN_TEMPLATES.has(template) ? template : TEMPLATE_SLIDER;
  }

  function readFeedLimit(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }

    return Math.max(1, Math.min(Math.round(numericValue), 24));
  }

  function readRuntimeConfig() {
    const rawConfig =
      window.__NEXOWORKS_IG_CONFIG &&
      typeof window.__NEXOWORKS_IG_CONFIG === "object"
        ? window.__NEXOWORKS_IG_CONFIG
        : {};

    return {
      tenantId: String(rawConfig.tenantId || "").trim(),
      clientLabel: String(rawConfig.clientLabel || "este cliente").trim(),
      connectUrl: String(rawConfig.connectUrl || "").trim(),
      logoutUrl: String(rawConfig.logoutUrl || "/api/instagram/logout").trim(),
      feedUrl: String(rawConfig.feedUrl || "/api/instagram/feed").trim(),
      widgetTemplate: normalizeTemplate(rawConfig.widgetTemplate),
      feedLimit: readFeedLimit(rawConfig.feedLimit),
      widgetTitle:
        String(rawConfig.widgetTitle || "Follow us on Instagram").trim() ||
        "Follow us on Instagram",
      showConnectCta: Boolean(rawConfig.showConnectCta),
    };
  }

  const runtimeConfig = readRuntimeConfig();

  function withSearchParam(urlValue, key, value) {
    const url = new URL(urlValue, window.location.href);
    url.searchParams.set(key, value);
    return url.toString();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clipText(value, maxLength = 220) {
    const normalizedValue = String(value || "").trim();

    if (!normalizedValue) {
      return "";
    }

    if (normalizedValue.length <= maxLength) {
      return normalizedValue;
    }

    return normalizedValue.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "...";
  }

  function readFlashMessage() {
    const url = new URL(window.location.href);
    const status = url.searchParams.get(FLASH_STATUS_PARAM) || "";
    const message = url.searchParams.get(FLASH_MESSAGE_PARAM) || "";

    if (!status || !message) {
      return null;
    }

    url.searchParams.delete(FLASH_STATUS_PARAM);
    url.searchParams.delete(FLASH_MESSAGE_PARAM);
    window.history.replaceState({}, "", url);

    return {
      status,
      message,
    };
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);

    if (root) {
      return root;
    }

    const footer = document.getElementById("contacto");

    if (!footer || !footer.parentNode) {
      return null;
    }

    const section = document.createElement("section");
    section.className = "section";
    section.innerHTML =
      '<div class="w-layout-blockcontainer container w-container"><div class="separator"></div><div id="' +
      ROOT_ID +
      '"></div></div>';

    footer.parentNode.insertBefore(section, footer);

    return document.getElementById(ROOT_ID);
  }

  function isSliderTemplate(template = runtimeConfig.widgetTemplate) {
    return (
      template === TEMPLATE_SLIDER ||
      template === TEMPLATE_HASHTAG ||
      template === TEMPLATE_POST_SLIDER ||
      template === TEMPLATE_SOCIAL_CARDS
    );
  }

  function readMediaDescription(item = {}, maxLength = 220) {
    const fullCaption = String(item.caption || "").trim();
    const previewCaption = String(item.captionPreview || "").trim();

    if (fullCaption && fullCaption !== "Sin caption.") {
      return clipText(fullCaption, maxLength);
    }

    if (previewCaption && previewCaption !== "Sin caption.") {
      return clipText(previewCaption, maxLength);
    }

    return "Instagram post";
  }

  function readMediaLabel(item = {}) {
    return readMediaDescription(item, 88);
  }

  function readHashtags(caption = "") {
    const matches = String(caption || "").match(/#[\p{L}\p{N}_]+/gu) || [];

    return [...new Set(matches)].slice(0, 4);
  }

  function formatPostDate(timestamp = "") {
    const date = new Date(String(timestamp || "").trim());

    if (Number.isNaN(date.getTime())) {
      return "Recent post";
    }

    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function readProfileUsername(profile = {}) {
    const username = String(profile?.username || "").trim().replace(/^@+/, "");

    return username ? "@" + username : "@instagram";
  }

  function buildProfileMarkup(profile = {}) {
    const username = String(profile.username || "").trim().replace(/^@+/, "");
    const profileUrl = username ? "https://www.instagram.com/" + encodeURIComponent(username) + "/" : "";
    const picture = /^(?:https:\/\/|\/media\/)/i.test(profile.profilePictureUrl || "")
      ? '<img class="nexo-ig-profile-picture" src="' + escapeHtml(profile.profilePictureUrl) + '" alt="' + escapeHtml(readProfileUsername(profile) + " profile picture") + '" width="72" height="72"/>'
      : "";
    return '<div class="nexo-ig-profile">' + picture + '<div class="nexo-ig-profile-details">' +
      (profile.displayName ? '<p class="nexo-ig-profile-name">' + escapeHtml(profile.displayName) + '</p>' : "") +
      (profileUrl ? '<a class="nexo-ig-profile-link" href="' + escapeHtml(profileUrl) + '" target="_blank" rel="noreferrer">' + escapeHtml(readProfileUsername(profile)) + '</a>' : "") +
      (profile.biography ? '<p class="nexo-ig-profile-bio">' + escapeHtml(profile.biography) + '</p>' : "") +
      '</div></div>';
  }

  function buildFlashMarkup(flash) {
    if (!flash) {
      return "";
    }

    return (
      '<div class="nexo-ig-flash" data-tone="' +
      escapeHtml(flash.status) +
      '">' +
      escapeHtml(flash.message) +
      "</div>"
    );
  }

  function buildHeadingMarkup() {
    return (
      '<div class="nexo-ig-slider-heading">' +
      '<h3 class="nexo-ig-slider-title">' +
      escapeHtml(runtimeConfig.widgetTitle) +
      "</h3>" +
      "</div>"
    );
  }

  function buildInstagramIconMarkup() {
    return (
      '<span class="nexo-ig-slide-icon" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" focusable="false">' +
      '<path d="M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4A5.8 5.8 0 0 1 16.2 22H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm0 1.9A3.9 3.9 0 0 0 3.9 7.8v8.4a3.9 3.9 0 0 0 3.9 3.9h8.4a3.9 3.9 0 0 0 3.9-3.9V7.8a3.9 3.9 0 0 0-3.9-3.9Zm8.9 1.4a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 6.6A5.4 5.4 0 1 1 6.6 12 5.4 5.4 0 0 1 12 6.6Zm0 1.9A3.5 3.5 0 1 0 15.5 12 3.5 3.5 0 0 0 12 8.5Z"></path>' +
      "</svg>" +
      "</span>"
    );
  }

  function buildChevronIconMarkup(direction) {
    const points =
      direction === "left" ? "14.5 6.5 8.5 12 14.5 17.5" : "9.5 6.5 15.5 12 9.5 17.5";

    return (
      '<span class="nexo-ig-control-icon is-chevron" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" focusable="false">' +
      '<polyline points="' +
      points +
      '"></polyline>' +
      "</svg>" +
      "</span>"
    );
  }

  function buildCloseIconMarkup() {
    return (
      '<span class="nexo-ig-control-icon is-close" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" focusable="false">' +
      '<path d="M7 7 17 17"></path>' +
      '<path d="M17 7 7 17"></path>' +
      "</svg>" +
      "</span>"
    );
  }

  function buildShellMarkup(flash, blockMarkup) {
    return (
      '<div class="nexo-ig-shell" data-template="' +
      escapeHtml(runtimeConfig.widgetTemplate) +
      '"><div class="nexo-ig-panel">' +
      buildFlashMarkup(flash) +
      '<div class="nexo-ig-slider-block">' +
      buildHeadingMarkup() +
      blockMarkup +
      "</div></div></div>"
    );
  }

  function buildPlaceholderSlidesMarkup(count = 6, extraClassName = "") {
    return Array.from({ length: count }, function (_item, index) {
      return (
        '<div class="nexo-ig-placeholder-slide ' +
        escapeHtml(extraClassName) +
        '" aria-hidden="true">' +
        '<span class="nexo-ig-placeholder-sheen nexo-ig-placeholder-sheen-' +
        String((index % 6) + 1) +
        '"></span>' +
        "</div>"
      );
    }).join("");
  }

  function buildPlaceholderGridMarkup() {
    return '<div class="nexo-ig-grid">' + buildPlaceholderSlidesMarkup(6) + "</div>";
  }

  function readCollageShape(index = 0) {
    const shapes = ["hero", "square", "square", "tall", "wide", "square"];

    return shapes[index] || "square";
  }

  function buildPlaceholderCollageMarkup() {
    return (
      '<div class="nexo-ig-collage">' +
      Array.from({ length: 6 }, function (_item, index) {
        return (
          '<div class="nexo-ig-placeholder-slide nexo-ig-collage-card" data-shape="' +
          escapeHtml(readCollageShape(index)) +
          '" aria-hidden="true">' +
          '<span class="nexo-ig-placeholder-sheen nexo-ig-placeholder-sheen-' +
          String((index % 6) + 1) +
          '"></span>' +
          "</div>"
        );
      }).join("") +
      "</div>"
    );
  }

  function buildSliderFrameMarkup(contentMarkup, options = {}) {
    const frameClassName = String(options.frameClassName || "").trim();
    const scrollMultiplier =
      Number(options.scrollMultiplier) > 0 ? Number(options.scrollMultiplier) : 2;

    return (
      '<div class="nexo-ig-slider-frame ' +
      escapeHtml(frameClassName) +
      '" data-scroll-multiplier="' +
      escapeHtml(String(scrollMultiplier)) +
      '">' +
      '<button class="nexo-ig-slider-button is-prev" type="button" aria-label="Previous Instagram posts">' +
      buildChevronIconMarkup("left") +
      "</button>" +
      '<div class="nexo-ig-slider-viewport">' +
      '<div class="nexo-ig-slider-track">' +
      contentMarkup +
      "</div></div>" +
      '<button class="nexo-ig-slider-button is-next" type="button" aria-label="Next Instagram posts">' +
      buildChevronIconMarkup("right") +
      "</button>" +
      "</div>"
    );
  }

  function buildPlaceholderHashtagMarkup() {
    return buildSliderFrameMarkup(buildPlaceholderSlidesMarkup(3, "is-hashtag-card"), {
      frameClassName: "is-hashtag",
      scrollMultiplier: 1,
    });
  }

  function buildPlaceholderPostSliderMarkup() {
    return buildSliderFrameMarkup(buildPlaceholderSlidesMarkup(1, "is-post-card"), {
      frameClassName: "is-post-slider",
      scrollMultiplier: 1,
    });
  }

  function buildPlaceholderSinglePostMarkup() {
    return (
      '<div class="nexo-ig-single-post" aria-hidden="true">' +
      '<div class="nexo-ig-placeholder-slide is-single-post"></div>' +
      '<div class="nexo-ig-single-post-body is-placeholder">' +
      '<span class="nexo-ig-placeholder-copy-line is-wide"></span>' +
      '<span class="nexo-ig-placeholder-copy-line"></span>' +
      '<span class="nexo-ig-placeholder-copy-line is-short"></span>' +
      "</div></div>"
    );
  }

  function buildLightboxMarkup() {
    return (
      '<div class="nexo-ig-lightbox" hidden>' +
      '<div class="nexo-ig-lightbox-backdrop" data-close-lightbox="true"></div>' +
      '<div class="nexo-ig-lightbox-dialog" role="dialog" aria-modal="true" aria-label="Instagram post preview">' +
      '<button class="nexo-ig-lightbox-close" type="button" aria-label="Close popup">' +
      buildCloseIconMarkup() +
      "</button>" +
      '<button class="nexo-ig-lightbox-nav is-prev" type="button" aria-label="Previous post">' +
      buildChevronIconMarkup("left") +
      "</button>" +
      '<figure class="nexo-ig-lightbox-figure">' +
      '<img class="nexo-ig-lightbox-image" alt=""/>' +
      '<figcaption class="nexo-ig-lightbox-caption">' +
      '<p class="nexo-ig-lightbox-type"></p>' +
      '<p class="nexo-ig-lightbox-copy"></p>' +
      '<a class="nexo-ig-lightbox-link" href="#" target="_blank" rel="noreferrer">Open on Instagram</a>' +
      "</figcaption>" +
      "</figure>" +
      '<button class="nexo-ig-lightbox-nav is-next" type="button" aria-label="Next post">' +
      buildChevronIconMarkup("right") +
      "</button>" +
      "</div></div>"
    );
  }

  function buildMediaCard(item, index) {
    const label = readMediaLabel(item);

    return (
      '<a class="nexo-ig-slide" href="' +
      escapeHtml(item.permalink || "#") +
      '" data-index="' +
      escapeHtml(index) +
      '" target="_blank" rel="noreferrer" aria-label="' +
      escapeHtml(label) +
      '">' +
      '<img class="nexo-ig-slide-image" src="' +
      escapeHtml(item.previewUrl) +
      '" alt="' +
      escapeHtml(label) +
      '"/>' +
      '<span class="nexo-ig-slide-overlay" aria-hidden="true"></span>' +
      '<span class="nexo-ig-slide-top">' +
      '<span class="nexo-ig-slide-caption">' +
      escapeHtml(label) +
      "</span>" +
      buildInstagramIconMarkup() +
      "</span>" +
      "</a>"
    );
  }

  function buildGridMarkup(media) {
    return (
      '<div class="nexo-ig-grid">' +
      media
        .map(function (item, index) {
          return buildMediaCard(item, index);
        })
        .join("") +
      "</div>"
    );
  }

  function buildMediaTypeIcon(item) {
    const type = item.mediaType;
    if (!['carousel', 'reel', 'video'].includes(type)) return '';
    const shape = type === 'carousel'
      ? '<path d="M7 3h13v13H7zM3 7v13h13"/>'
      : '<rect x="3" y="5" width="12" height="14" rx="3"/><path d="m15 10 6-4v12l-6-4z"/>';
    return '<span class="nexo-ig-media-type" title="' + escapeHtml(item.mediaTypeLabel || type) + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' + shape + '</svg></span>';
  }

  function buildPhotoWallMarkup(media) {
    return '<div class="nexo-ig-photo-wall">' + media.map(function (item, index) {
      const label = readMediaLabel(item);
      return '<a class="nexo-ig-slide" href="' + escapeHtml(item.permalink) + '" data-index="' + index +
        '" target="_blank" rel="noreferrer" aria-label="' + escapeHtml(label) + '">' +
        '<img class="nexo-ig-slide-image" src="' + escapeHtml(item.previewUrl) + '" alt="' + escapeHtml(label) + '" loading="lazy" decoding="async"/>' +
        buildMediaTypeIcon(item) + '</a>';
    }).join('') + '</div>';
  }

  function buildSocialCardsMarkup(media) {
    return buildSliderFrameMarkup(media.map(function (item, index) {
      const label = readMediaLabel(item);
      const date = new Date(item.timestamp);
      const dateMarkup = Number.isFinite(date.getTime())
        ? '<time datetime="' + escapeHtml(date.toISOString()) + '">' + escapeHtml(new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)) + '</time>'
        : '<span>Publicación de Instagram</span>';
      return '<article class="nexo-ig-social-card">' +
        '<header class="nexo-ig-social-header">' + dateMarkup +
        '<a href="' + escapeHtml(item.permalink) + '" target="_blank" rel="noreferrer" aria-label="Ver publicación en Instagram">' + buildInstagramIconMarkup() + '</a></header>' +
        '<a class="nexo-ig-slide nexo-ig-social-image" href="' + escapeHtml(item.permalink) + '" data-index="' + index + '" target="_blank" rel="noreferrer" aria-label="' + escapeHtml(label) + '">' +
        '<img class="nexo-ig-slide-image" src="' + escapeHtml(item.previewUrl) + '" alt="' + escapeHtml(label) + '" loading="lazy" decoding="async"/>' + buildMediaTypeIcon(item) + '</a>' +
        '<div class="nexo-ig-social-body"><p class="nexo-ig-social-copy">' + escapeHtml(readMediaDescription(item, 2200)) + '</p>' +
        '<a class="nexo-ig-share" href="' + escapeHtml(item.permalink) + '" target="_blank" rel="noreferrer" data-share-index="' + index + '" aria-label="Compartir publicación ' + (index + 1) + '">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="m14 3 8 7-8 7v-5C8 12 4 15 2 21c0-10 5-15 12-15z"/></svg><span>Compartir</span></a></div></article>';
    }).join(''), { frameClassName: 'is-social-cards', scrollMultiplier: 1 }) +
      '<p class="nexo-ig-share-status" role="status" aria-live="polite"></p>';
  }

  function bindSharing(root, media) {
    const status = root.querySelector('.nexo-ig-share-status');
    root.querySelectorAll('[data-share-index]').forEach(function (link) {
      link.addEventListener('click', async function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const item = media[Number(link.dataset.shareIndex)];
        if (!item?.permalink) return;
        const data = { title: 'Publicación de Instagram', url: item.permalink };
        const canShare = typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data));
        if (!canShare && !navigator.clipboard?.writeText) return;
        event.preventDefault();
        try {
          if (canShare) await navigator.share(data);
          else { await navigator.clipboard.writeText(item.permalink); status.textContent = 'Enlace copiado. Ya podés compartirlo.'; }
        } catch (error) {
          if (error.name === 'AbortError') return;
          // Keep a normal link as a usable fallback when an iframe denies sharing or clipboard access.
          const fallback = link.cloneNode(true);
          fallback.querySelector('span').textContent = 'Abrir publicación';
          fallback.setAttribute('aria-label', 'Abrir publicación en Instagram');
          link.replaceWith(fallback);
          status.textContent = 'Abrí la publicación para compartir su enlace desde Instagram.';
        }
      });
    });
  }

  function buildHashtagCard(item, index, profile = {}) {
    const description = readMediaDescription(item, 280);
    const hashtags = readHashtags(item.caption);
    const tagsMarkup = hashtags.length
      ? '<span class="nexo-ig-hashtag-tags">' +
        hashtags
          .map(function (tag) {
            return '<span class="nexo-ig-hashtag-tag">' + escapeHtml(tag) + "</span>";
          })
          .join("") +
        "</span>"
      : "";

    return (
      '<a class="nexo-ig-slide nexo-ig-hashtag-card" href="' +
      escapeHtml(item.permalink || "#") +
      '" data-index="' +
      escapeHtml(index) +
      '" target="_blank" rel="noreferrer" aria-label="' +
      escapeHtml(description) +
      '">' +
      '<span class="nexo-ig-hashtag-media">' +
      '<img class="nexo-ig-slide-image" src="' +
      escapeHtml(item.previewUrl) +
      '" alt="' +
      escapeHtml(description) +
      '"/>' +
      '<span class="nexo-ig-slide-overlay" aria-hidden="true"></span>' +
      "</span>" +
      '<span class="nexo-ig-hashtag-body">' +
      '<span class="nexo-ig-hashtag-kicker">' +
      escapeHtml(readProfileUsername(profile)) +
      " / " +
      escapeHtml(item.mediaTypeLabel || "Post") +
      "</span>" +
      '<span class="nexo-ig-hashtag-copy">' +
      escapeHtml(description) +
      "</span>" +
      tagsMarkup +
      '<span class="nexo-ig-hashtag-footer">' +
      '<span class="nexo-ig-hashtag-date">' +
      escapeHtml(formatPostDate(item.timestamp)) +
      "</span>" +
      '<span class="nexo-ig-hashtag-action">Open in popup</span>' +
      "</span>" +
      "</span>" +
      "</a>"
    );
  }

  function buildHashtagMarkup(media, profile) {
    return buildSliderFrameMarkup(
      media
        .map(function (item, index) {
          return buildHashtagCard(item, index, profile);
        })
        .join(""),
      {
        frameClassName: "is-hashtag",
        scrollMultiplier: 1,
      },
    );
  }

  function buildCollageCard(item, index) {
    const label = readMediaLabel(item);

    return (
      '<a class="nexo-ig-slide nexo-ig-collage-card" data-shape="' +
      escapeHtml(readCollageShape(index)) +
      '" href="' +
      escapeHtml(item.permalink || "#") +
      '" data-index="' +
      escapeHtml(index) +
      '" target="_blank" rel="noreferrer" aria-label="' +
      escapeHtml(label) +
      '">' +
      '<img class="nexo-ig-slide-image" src="' +
      escapeHtml(item.previewUrl) +
      '" alt="' +
      escapeHtml(label) +
      '"/>' +
      '<span class="nexo-ig-slide-overlay" aria-hidden="true"></span>' +
      '<span class="nexo-ig-slide-top">' +
      '<span class="nexo-ig-slide-caption">' +
      escapeHtml(label) +
      "</span>" +
      buildInstagramIconMarkup() +
      "</span>" +
      "</a>"
    );
  }

  function buildCollageMarkup(media) {
    return (
      '<div class="nexo-ig-collage">' +
      media
        .map(function (item, index) {
          return buildCollageCard(item, index);
        })
        .join("") +
      "</div>"
    );
  }

  function buildPostSliderCard(item, index) {
    const description = readMediaDescription(item, 240);

    return (
      '<a class="nexo-ig-slide nexo-ig-post-card" href="' +
      escapeHtml(item.permalink || "#") +
      '" data-index="' +
      escapeHtml(index) +
      '" target="_blank" rel="noreferrer" aria-label="' +
      escapeHtml(description) +
      '">' +
      '<span class="nexo-ig-post-card-media">' +
      '<img class="nexo-ig-slide-image" src="' +
      escapeHtml(item.previewUrl) +
      '" alt="' +
      escapeHtml(description) +
      '"/>' +
      "</span>" +
      '<span class="nexo-ig-post-card-body">' +
      '<span class="nexo-ig-post-card-kicker">' +
      escapeHtml(item.mediaTypeLabel || "Post") +
      " / " +
      escapeHtml(formatPostDate(item.timestamp)) +
      "</span>" +
      '<span class="nexo-ig-post-card-copy">' +
      escapeHtml(description) +
      "</span>" +
      '<span class="nexo-ig-post-card-action">Open in popup</span>' +
      "</span>" +
      "</a>"
    );
  }

  function buildPostSliderMarkup(media) {
    return buildSliderFrameMarkup(
      media
        .map(function (item, index) {
          return buildPostSliderCard(item, index);
        })
        .join(""),
      {
        frameClassName: "is-post-slider",
        scrollMultiplier: 1,
      },
    );
  }

  function buildSinglePostMarkup(item, profile = {}) {
    const description = readMediaDescription(item, 420);
    const profileMarkup = String(profile?.profileLink || "").trim()
      ? '<a class="nexo-ig-single-post-profile-link" data-open-link="true" href="' +
        escapeHtml(profile.profileLink) +
        '" target="_blank" rel="noreferrer">' +
        escapeHtml(readProfileUsername(profile)) +
        "</a>"
      : '<span class="nexo-ig-single-post-profile-link">' +
        escapeHtml(readProfileUsername(profile)) +
        "</span>";

    return (
      '<div class="nexo-ig-single-post">' +
      '<a class="nexo-ig-slide nexo-ig-single-post-link" href="' +
      escapeHtml(item.permalink || "#") +
      '" data-index="0" target="_blank" rel="noreferrer" aria-label="' +
      escapeHtml(description) +
      '">' +
      '<span class="nexo-ig-single-post-media">' +
      '<img class="nexo-ig-slide-image" src="' +
      escapeHtml(item.previewUrl) +
      '" alt="' +
      escapeHtml(description) +
      '"/>' +
      "</span>" +
      "</a>" +
      '<div class="nexo-ig-single-post-body">' +
      '<div class="nexo-ig-single-post-meta">' +
      profileMarkup +
      '<span class="nexo-ig-single-post-date">' +
      escapeHtml(formatPostDate(item.timestamp)) +
      "</span>" +
      "</div>" +
      '<p class="nexo-ig-single-post-copy">' +
      escapeHtml(description) +
      "</p>" +
      '<div class="nexo-ig-single-post-actions">' +
      '<a class="nexo-ig-single-post-action" data-open-link="true" href="' +
      escapeHtml(item.permalink || "#") +
      '" target="_blank" rel="noreferrer">Open on Instagram</a>' +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function buildTemplatePlaceholderMarkup(template = runtimeConfig.widgetTemplate) {
    if (template === TEMPLATE_PHOTO_WALL) {
      return '<div class="nexo-ig-reference-layout"><div class="nexo-ig-photo-wall">' + buildPlaceholderSlidesMarkup(Math.min(runtimeConfig.feedLimit || 10, 10)) + '</div></div>';
    }
    if (template === TEMPLATE_SOCIAL_CARDS) {
      return buildSliderFrameMarkup(buildPlaceholderSlidesMarkup(4, 'is-social-card'), { frameClassName: 'is-social-cards', scrollMultiplier: 1 });
    }
    if (template === TEMPLATE_GRID) {
      return buildPlaceholderGridMarkup();
    }

    if (template === TEMPLATE_COLLAGE) {
      return buildPlaceholderCollageMarkup();
    }

    if (template === TEMPLATE_HASHTAG) {
      return buildPlaceholderHashtagMarkup();
    }

    if (template === TEMPLATE_POST_SLIDER) {
      return buildPlaceholderPostSliderMarkup();
    }

    if (template === TEMPLATE_SINGLE_POST) {
      return buildPlaceholderSinglePostMarkup();
    }

    return buildSliderFrameMarkup(buildPlaceholderSlidesMarkup(), {
      scrollMultiplier: 2,
    });
  }

  function buildTemplateFeedMarkup(payload = {}) {
    const media = Array.isArray(payload.media) ? payload.media : [];
    const profile = payload.profile || {};

    if (runtimeConfig.widgetTemplate === TEMPLATE_PHOTO_WALL) return buildPhotoWallMarkup(media);
    if (runtimeConfig.widgetTemplate === TEMPLATE_SOCIAL_CARDS) return buildSocialCardsMarkup(media);

    if (runtimeConfig.widgetTemplate === TEMPLATE_GRID) {
      return buildGridMarkup(media);
    }

    if (runtimeConfig.widgetTemplate === TEMPLATE_HASHTAG) {
      return buildHashtagMarkup(media, profile);
    }

    if (runtimeConfig.widgetTemplate === TEMPLATE_COLLAGE) {
      return buildCollageMarkup(media);
    }

    if (runtimeConfig.widgetTemplate === TEMPLATE_POST_SLIDER) {
      return buildPostSliderMarkup(media);
    }

    if (runtimeConfig.widgetTemplate === TEMPLATE_SINGLE_POST) {
      return buildSinglePostMarkup(media[0], profile);
    }

    return buildSliderFrameMarkup(
      media
        .map(function (item, index) {
          return buildMediaCard(item, index);
        })
        .join(""),
      {
        scrollMultiplier: 2,
      },
    );
  }

  function renderLoading(root, flash) {
    root.innerHTML = buildShellMarkup(
      flash,
      '<div class="nexo-ig-loading-copy">Loading Instagram gallery...</div>' +
        buildTemplatePlaceholderMarkup(),
    );
  }

  function renderDisconnected(root, flash, errorMessage) {
    const detailsMarkup = errorMessage
      ? '<p class="nexo-ig-note">' + escapeHtml(errorMessage) + "</p>"
      : "";
    const connectMarkup =
      runtimeConfig.showConnectCta && runtimeConfig.connectUrl
        ? '<div class="nexo-ig-actions">' +
          '<a href="' +
          escapeHtml(runtimeConfig.connectUrl) +
          '" class="button w-button nexo-ig-connect-button">Connect Instagram</a>' +
          "</div>"
        : "";
    const emptyCopy = runtimeConfig.showConnectCta
      ? "Connect the professional Instagram account to publish this widget."
      : "The Instagram feed is not available yet for this widget.";

    root.innerHTML = buildShellMarkup(
      flash,
      '<div class="nexo-ig-empty">' +
        '<p class="nexo-ig-empty-copy">' +
        escapeHtml(emptyCopy) +
        "</p>" +
        connectMarkup +
        detailsMarkup +
        "</div>" +
        buildTemplatePlaceholderMarkup(),
    );
  }

  function bindSlider(root) {
    const frame = root.querySelector(".nexo-ig-slider-frame");
    const viewport = root.querySelector(".nexo-ig-slider-viewport");
    const track = root.querySelector(".nexo-ig-slider-track");
    const firstSlide = root.querySelector(".nexo-ig-social-card, .nexo-ig-slide");
    const prevButton = root.querySelector(".nexo-ig-slider-button.is-prev");
    const nextButton = root.querySelector(".nexo-ig-slider-button.is-next");

    if (!frame || !viewport || !track || !firstSlide || !prevButton || !nextButton) {
      return;
    }

    function readStep() {
      const styles = window.getComputedStyle(track);
      const gap = Number.parseFloat(styles.gap || styles.columnGap || "0") || 0;
      const multiplier =
        Number.parseFloat(frame.dataset.scrollMultiplier || "2") || 2;

      return (firstSlide.getBoundingClientRect().width + gap) * multiplier;
    }

    function updateButtons() {
      const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
      prevButton.disabled = viewport.scrollLeft <= 4;
      nextButton.disabled = maxScrollLeft - viewport.scrollLeft <= 4;
    }

    prevButton.addEventListener("click", function () {
      viewport.scrollBy({
        left: readStep() * -1,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? "instant" : "smooth",
      });
    });

    nextButton.addEventListener("click", function () {
      viewport.scrollBy({
        left: readStep(),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? "instant" : "smooth",
      });
    });

    viewport.addEventListener("scroll", updateButtons, { passive: true });
    window.addEventListener("resize", updateButtons, { passive: true });

    window.requestAnimationFrame(updateButtons);
  }

  function bindLightbox(root, media) {
    const slides = Array.from(root.querySelectorAll(".nexo-ig-slide[data-index]"));
    const lightbox = root.querySelector(".nexo-ig-lightbox");

    if (!slides.length || !lightbox || !Array.isArray(media) || !media.length) {
      return;
    }

    const image = lightbox.querySelector(".nexo-ig-lightbox-image");
    const copy = lightbox.querySelector(".nexo-ig-lightbox-copy");
    const type = lightbox.querySelector(".nexo-ig-lightbox-type");
    const link = lightbox.querySelector(".nexo-ig-lightbox-link");
    const closeButton = lightbox.querySelector(".nexo-ig-lightbox-close");
    const prevButton = lightbox.querySelector(".nexo-ig-lightbox-nav.is-prev");
    const nextButton = lightbox.querySelector(".nexo-ig-lightbox-nav.is-next");
    let currentIndex = 0;
    let previousFocus = null;

    if (!image || !copy || !type || !link || !closeButton || !prevButton || !nextButton) {
      return;
    }

    function updateLightbox() {
      const item = media[currentIndex];

      if (!item) {
        return;
      }

      const description = readMediaDescription(item, 700);

      image.src = item.previewUrl || "";
      image.alt = description;
      copy.textContent = description;
      type.textContent = item.mediaTypeLabel || "Instagram post";
      link.href = item.permalink || "#";
      prevButton.disabled = media.length <= 1;
      nextButton.disabled = media.length <= 1;
    }

    function openLightbox(nextIndex) {
      previousFocus = document.activeElement;
      currentIndex = Math.max(0, Math.min(nextIndex, media.length - 1));
      updateLightbox();
      lightbox.hidden = false;
      document.body.classList.add("nexo-ig-lightbox-open");
      closeButton.focus();
    }

    function closeLightbox() {
      lightbox.hidden = true;
      document.body.classList.remove("nexo-ig-lightbox-open");
      if (previousFocus) previousFocus.focus();
    }

    function move(delta) {
      if (media.length <= 1) {
        return;
      }

      currentIndex = (currentIndex + delta + media.length) % media.length;
      updateLightbox();
    }

    slides.forEach(function (slide) {
      slide.addEventListener("click", function (event) {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        if (
          event.target instanceof Element &&
          event.target.closest("[data-open-link='true']")
        ) {
          return;
        }

        event.preventDefault();
        openLightbox(Number(slide.dataset.index || "0"));
      });

      slide.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        if (
          event.target instanceof Element &&
          event.target.closest("[data-open-link='true']")
        ) {
          return;
        }

        event.preventDefault();
        openLightbox(Number(slide.dataset.index || "0"));
      });
    });

    lightbox.addEventListener("click", function (event) {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-close-lightbox='true']")
      ) {
        closeLightbox();
      }
    });

    closeButton.addEventListener("click", closeLightbox);
    prevButton.addEventListener("click", function () {
      move(-1);
    });
    nextButton.addEventListener("click", function () {
      move(1);
    });

    document.addEventListener("keydown", function (event) {
      if (lightbox.hidden) {
        return;
      }

      if (event.key === "Tab") {
        const focusable = Array.from(lightbox.querySelectorAll('button:not(:disabled), a[href]'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }

      if (event.key === "Escape") {
        closeLightbox();
        return;
      }

      if (event.key === "ArrowLeft") {
        move(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        move(1);
      }
    });
  }

  function renderConnected(root, flash, payload) {
    const media = Array.isArray(payload.media) ? payload.media.slice(0, runtimeConfig.feedLimit || 24) : [];
    const referenceTemplate = [TEMPLATE_PHOTO_WALL, TEMPLATE_SOCIAL_CARDS].includes(runtimeConfig.widgetTemplate);
    const referenceProfile = runtimeConfig.widgetTemplate === TEMPLATE_PHOTO_WALL
      ? buildProfileMarkup(payload.profile)
      : "";

    if (!media.length) {
      root.innerHTML = buildShellMarkup(flash, buildProfileMarkup(payload.profile) +
        '<p class="nexo-ig-empty-copy">This account is connected. There are no Instagram posts to display yet.</p>');
      return;
    }

    root.innerHTML = buildShellMarkup(
      flash,
      (referenceTemplate ? '<div class="nexo-ig-reference-layout">' + referenceProfile : buildProfileMarkup(payload.profile)) + buildTemplateFeedMarkup({ ...payload, media }) + (referenceTemplate ? '</div>' : '') + buildLightboxMarkup(),
    );

    if (isSliderTemplate(runtimeConfig.widgetTemplate)) {
      bindSlider(root);
    }

    bindLightbox(root, media);
    if (runtimeConfig.widgetTemplate === TEMPLATE_SOCIAL_CARDS) bindSharing(root, media);
  }

  async function bootWidget() {
    const root = ensureRoot();

    if (!root) {
      return;
    }

    if (window.parent !== window && typeof ResizeObserver === 'function') {
      let lastHeight = 0;
      const reportSize = function () {
        const styles = window.getComputedStyle(document.body);
        const height = Math.max(120, Math.ceil(root.getBoundingClientRect().height + parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)));
        if (height === lastHeight) return;
        lastHeight = height;
        window.parent.postMessage({ type: 'nexo-instagram:resize', height }, '*');
      };
      new ResizeObserver(reportSize).observe(root);
      window.addEventListener('message', function (event) {
        if (event.source !== window.parent || event.data?.type !== 'nexo-instagram:measure') return;
        lastHeight = 0;
        reportSize();
      });
    }

    const flash = readFlashMessage();
    renderLoading(root, flash);

    try {
      const feedUrl =
        runtimeConfig.feedLimit > 0
          ? withSearchParam(runtimeConfig.feedUrl, "limit", String(runtimeConfig.feedLimit))
          : runtimeConfig.feedUrl;
      const response = await fetch(feedUrl, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok || !payload.connected) {
        renderDisconnected(root, flash, payload.error);
        return;
      }

      renderConnected(root, flash, payload);
    } catch (error) {
      renderDisconnected(
        root,
        flash,
        error && error.message ? error.message : "The connected profile could not be loaded.",
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootWidget, { once: true });
  } else {
    bootWidget();
  }
})();
