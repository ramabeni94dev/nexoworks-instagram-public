export const post = {
  id: '123', shortcode: 'TEST_01', display_url: 'https://scontent.cdninstagram.com/example.jpg',
  owner: { username: 'test.brand' }, taken_at_timestamp: 1700000000,
  edge_media_to_caption: { edges: [{ node: { text: 'Texto de prueba\n#diseño' } }] },
};
export const user = {
  id: '456', username: 'test.brand', full_name: 'Marca de prueba', biography: 'Datos sintéticos para tests.',
  is_private: false, profile_pic_url: 'https://scontent.cdninstagram.com/avatar.jpg',
  edge_followed_by: { count: 123 }, edge_follow: { count: 12 },
  edge_owner_to_timeline_media: { count: 1, edges: [{ node: post }] },
};
export const html = value => `<!doctype html><html><head><meta property="og:url" content="https://www.instagram.com/test.brand/"><meta property="og:title" content="Marca de prueba (@test.brand) • Instagram"><script type="application/json">${JSON.stringify(value)}</script></head><body><main></main></body></html>`;
