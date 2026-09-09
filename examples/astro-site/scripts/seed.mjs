#!/usr/bin/env node
// Seeds a fresh Kenresoft CMS deployment with everything this example site's pages assume:
// content types (page/blog-post/category), entries, media, a "contact" form, and a small
// Commerce catalog (categories/products/variants/images). Written for this rebuild's own
// live-verification pass against an ISOLATED wrangler dev instance (dedicated port/persist-to
// path, per this project's standing "never touch a developer's own dev D1" rule) — not meant to
// run against a real/shared deployment without reading it first.
//
// Usage: API_URL=http://localhost:8799 node scripts/seed.mjs

const API_URL = process.env.API_URL ?? 'http://localhost:8799';
let cookie = '';

function extractSetCookie(response) {
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const line of raw) {
    const pair = line.split(';')[0];
    const [name] = pair.split('=');
    // Replace any existing cookie with the same name, keep others.
    const existing = cookie.split('; ').filter((c) => c && !c.startsWith(`${name}=`));
    existing.push(pair);
    cookie = existing.join('; ');
  }
}

async function req(method, path, body, { multipart } = {}) {
  const headers = { cookie, origin: 'http://localhost:4321' };
  let payload = body;
  if (body && !multipart) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(`${API_URL}${path}`, { method, headers, body: payload });
  extractSetCookie(response);
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

// A tiny (1x1) real PNG, valid bytes — enough for image-metadata.ts's byte-sniffing to accept it
// as a genuine PNG upload, not a fake extension.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAScy0y8AAAAASUVORK5CYII=',
  'base64',
);

async function uploadMedia(altText, colorTag) {
  const form = new FormData();
  form.set('file', new Blob([PNG_1PX], { type: 'image/png' }), `${colorTag}.png`);
  form.set('altText', altText);
  const response = await fetch(`${API_URL}/api/v1/admin/media`, { method: 'POST', headers: { cookie, origin: 'http://localhost:4321' }, body: form });
  extractSetCookie(response);
  const json = await response.json();
  if (!response.ok) throw new Error(`media upload -> ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

async function main() {
  console.log(`Seeding ${API_URL} ...`);

  // 1. Staff account — the FIRST signup on a deployment becomes Owner (docs/ARCHITECTURE.md §10).
  const email = 'owner@example.com';
  const password = 'correct-horse-battery-staple';
  try {
    await req('POST', '/api/v1/auth/sign-up/email', { email, password, name: 'Site Owner' });
    console.log('Created staff owner account.');
  } catch (err) {
    console.log('Staff signup failed (already exists?) — trying sign-in instead:', err.message);
    await req('POST', '/api/v1/auth/sign-in/email', { email, password });
  }

  // 2. Content types.
  const page = await req('POST', '/api/v1/admin/content-types', { name: 'Page', slug: 'page' });
  const category = await req('POST', '/api/v1/admin/content-types', { name: 'Category', slug: 'category' });
  const blogPost = await req('POST', '/api/v1/admin/content-types', { name: 'Blog Post', slug: 'blog-post' });
  console.log('Created content types: page, category, blog-post');

  for (const field of [
    { name: 'title', label: 'Title', fieldType: 'text', required: true },
    { name: 'body', label: 'Body', fieldType: 'rich_text' },
    { name: 'metaTitle', label: 'Meta title', fieldType: 'text' },
    { name: 'metaDescription', label: 'Meta description', fieldType: 'textarea' },
  ]) {
    await req('POST', `/api/v1/admin/content-types/${page.id}/fields`, field);
  }
  for (const field of [
    { name: 'title', label: 'Title', fieldType: 'text', required: true },
    { name: 'description', label: 'Description', fieldType: 'textarea' },
  ]) {
    await req('POST', `/api/v1/admin/content-types/${category.id}/fields`, field);
  }
  for (const field of [
    { name: 'title', label: 'Title', fieldType: 'text', required: true },
    { name: 'excerpt', label: 'Excerpt', fieldType: 'textarea' },
    { name: 'body', label: 'Body', fieldType: 'rich_text' },
    { name: 'featuredImage', label: 'Featured image', fieldType: 'media' },
    { name: 'category', label: 'Category', fieldType: 'reference', config: { targetContentTypeId: category.id } },
    { name: 'metaTitle', label: 'Meta title', fieldType: 'text' },
    { name: 'metaDescription', label: 'Meta description', fieldType: 'textarea' },
  ]) {
    await req('POST', `/api/v1/admin/content-types/${blogPost.id}/fields`, field);
  }
  console.log('Created field definitions.');

  // 3. Media.
  const heroImage = await uploadMedia('A laptop on a desk with code on the screen', 'engineering');
  const productImage1 = await uploadMedia('A studio photo of a ceramic mug', 'mug-1');
  const productImage2 = await uploadMedia('A studio photo of a ceramic mug, angled view', 'mug-2');
  const toteImage = await uploadMedia('A canvas tote bag', 'tote');
  console.log('Uploaded media.');

  // 4. Pages.
  await req('POST', '/api/v1/admin/entries?contentTypeId=' + page.id, {
    slug: 'about',
    status: 'published',
    data: {
      title: 'About Kenresoft CMS',
      body:
        '<p>Kenresoft CMS is a reusable, Cloudflare-native, API-first content and commerce platform. This reference storefront demonstrates the whole thing end to end: content, media, forms, and a full Commerce checkout with Paystack.</p><p>Everything you see here — this page included — is a real published entry fetched from the public API, not hardcoded HTML.</p>',
      metaTitle: 'About — Kenresoft CMS reference storefront',
      metaDescription: 'Kenresoft CMS is a reusable, Cloudflare-native, API-first content and commerce platform.',
    },
  });
  await req('POST', '/api/v1/admin/entries?contentTypeId=' + page.id, {
    slug: 'contact',
    status: 'published',
    data: {
      title: 'Get in touch',
      body: '<p>Have a question about Kenresoft CMS? Send us a message below — it goes straight into the admin Forms inbox.</p>',
    },
  });
  console.log('Created page entries: about, contact.');

  // 5. Categories (blog taxonomy).
  const engineeringCategory = await req('POST', '/api/v1/admin/entries?contentTypeId=' + category.id, {
    slug: 'engineering',
    status: 'published',
    data: { title: 'Engineering', description: 'Posts about how Kenresoft CMS is built.' },
  });
  const productCategory = await req('POST', '/api/v1/admin/entries?contentTypeId=' + category.id, {
    slug: 'product',
    status: 'published',
    data: { title: 'Product', description: 'Posts about product direction and releases.' },
  });
  console.log('Created blog category entries.');

  // 6. Blog posts.
  await req('POST', '/api/v1/admin/entries?contentTypeId=' + blogPost.id, {
    slug: 'building-an-api-first-cms',
    status: 'published',
    data: {
      title: 'Building an API-first CMS on Cloudflare',
      excerpt: 'Why Kenresoft CMS is built on Workers, D1, and R2 — and what that buys you.',
      body: '<p>Every piece of published content is available through one clean, unauthenticated REST API. No SDK required, no vendor lock-in — just HTTP.</p><h2>Why Cloudflare</h2><p>Workers, D1, and R2 mean there is no separate database or file storage to provision, monitor, or pay for on top of the platform you already deploy to.</p>',
      featuredImage: heroImage.id,
      category: engineeringCategory.id,
      metaTitle: 'Building an API-first CMS on Cloudflare',
      metaDescription: 'Why Kenresoft CMS is built on Workers, D1, and R2.',
    },
  });
  await req('POST', '/api/v1/admin/entries?contentTypeId=' + blogPost.id, {
    slug: 'commerce-plugin-launch',
    status: 'published',
    data: {
      title: 'Announcing the Commerce plugin',
      excerpt: 'Catalog, cart, checkout, and Paystack payments — all built on the same plugin platform.',
      body: '<p>The Commerce plugin adds a full storefront domain to Kenresoft CMS: products, variants, cart, checkout, and real Paystack payment confirmation.</p>',
      category: productCategory.id,
      metaTitle: 'Announcing the Commerce plugin',
      metaDescription: 'Catalog, cart, checkout, and Paystack payments for Kenresoft CMS.',
    },
  });
  await req('POST', '/api/v1/admin/entries?contentTypeId=' + blogPost.id, {
    slug: 'a-draft-post-you-should-never-see',
    status: 'draft',
    data: { title: 'This should 404 on the public site', excerpt: 'If you can see this at /blog, something is wrong.', body: '<p>Draft.</p>' },
  });
  console.log('Created blog-post entries (including one draft, to verify draft/published isolation).');

  // 7. Contact form.
  const contactForm = await req('POST', '/api/v1/admin/forms', { name: 'Contact', slug: 'contact' });
  for (const field of [
    { name: 'name', label: 'Name', fieldType: 'text', required: true },
    { name: 'email', label: 'Email', fieldType: 'email', required: true },
    { name: 'message', label: 'Message', fieldType: 'textarea', required: true },
  ]) {
    await req('POST', `/api/v1/admin/forms/${contactForm.id}/fields`, field);
  }
  console.log('Created "contact" form.');

  // 8. Commerce catalog.
  const apparelCategory = await req('POST', '/api/plugins/commerce/v1/categories', { name: 'Apparel', slug: 'apparel' });
  const accessoriesCategory = await req('POST', '/api/plugins/commerce/v1/categories', { name: 'Accessories', slug: 'accessories' });
  console.log('Created commerce categories.');

  const mug = await req('POST', '/api/plugins/commerce/v1/products', {
    name: 'Kenresoft Ceramic Mug',
    slug: 'ceramic-mug',
    shortDescription: 'A sturdy 12oz ceramic mug with the Kenresoft mark.',
    description: 'A sturdy 12oz ceramic mug with the Kenresoft mark, dishwasher and microwave safe.',
    status: 'published',
    basePrice: 350000,
    currency: 'NGN',
    categoryId: accessoriesCategory.id,
  });
  await req('POST', `/api/plugins/commerce/v1/products/${mug.id}/images`, { mediaId: productImage1.id, sortOrder: 0, altText: 'Ceramic mug, front view' });
  await req('POST', `/api/plugins/commerce/v1/products/${mug.id}/images`, { mediaId: productImage2.id, sortOrder: 1, altText: 'Ceramic mug, angled view' });
  await req('POST', `/api/plugins/commerce/v1/products/${mug.id}/variants`, { name: 'White', sku: 'MUG-WHT', stockQty: 25, attributes: { color: 'white' } });
  await req('POST', `/api/plugins/commerce/v1/products/${mug.id}/variants`, { name: 'Black', sku: 'MUG-BLK', stockQty: 3, attributes: { color: 'black' } });
  await req('POST', `/api/plugins/commerce/v1/products/${mug.id}/variants`, { name: 'Limited gold (sold out)', sku: 'MUG-GLD', stockQty: 0, attributes: { color: 'gold' } });

  const tote = await req('POST', '/api/plugins/commerce/v1/products', {
    name: 'Kenresoft Canvas Tote',
    slug: 'canvas-tote',
    shortDescription: 'A durable canvas tote bag.',
    status: 'published',
    basePrice: 550000,
    currency: 'NGN',
    categoryId: apparelCategory.id,
  });
  await req('POST', `/api/plugins/commerce/v1/products/${tote.id}/images`, { mediaId: toteImage.id, sortOrder: 0, altText: 'Canvas tote bag' });
  // Deliberately no variants — exercises the "no variants, always in stock" storefront path.

  await req('POST', '/api/plugins/commerce/v1/products', {
    name: 'Sticker Pack (draft — should not appear on the storefront)',
    slug: 'sticker-pack',
    shortDescription: 'Still being prepared.',
    status: 'draft',
    basePrice: 100000,
    currency: 'NGN',
  });
  console.log('Created commerce products (ceramic mug with 3 variants incl. one sold-out, canvas tote with no variants, one draft product).');

  console.log('\nSeed complete.');
  console.log(`Staff login: ${email} / ${password}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
