import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { WebsiteRegistration } from '../src/client/website-registration';
const base = {
  origin: 'https://studio.example',
  websiteId: '0',
  syncComplete: true,
  busy: false,
  register: vi.fn(),
};
it('shows a recorded registration date even while newer history is syncing', () => {
  for (const syncComplete of [true, false]) {
    const html = renderToStaticMarkup(
      <WebsiteRegistration
        {...base}
        syncComplete={syncComplete}
        website={{ registered: true, registeredAt: '2026-11-19T04:23:07.000Z', url: base.origin }}
      />,
    );
    expect(html).toContain('Registered since');
    expect(html).toContain('dateTime="2026-11-19T04:23:07.000Z"');
    expect(html).not.toContain('Register this website in wallet');
  }
});
it('shows the registration action only when history confirms it is needed', () => {
  const missing = { registered: false, registeredAt: null, url: null };
  expect(renderToStaticMarkup(<WebsiteRegistration {...base} />)).not.toContain('<button');
  expect(
    renderToStaticMarkup(<WebsiteRegistration {...base} syncComplete={false} website={missing} />),
  ).not.toContain('<button');
  expect(
    renderToStaticMarkup(
      <WebsiteRegistration {...base} website={{ ...missing, url: 'https://elsewhere.example' }} />,
    ),
  ).not.toContain('<button');
  expect(renderToStaticMarkup(<WebsiteRegistration {...base} website={missing} />)).toContain(
    'Register this website in wallet',
  );
});
