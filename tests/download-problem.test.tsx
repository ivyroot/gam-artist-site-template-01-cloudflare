import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { DownloadProblem } from '../src/client/download-problem';
import { api, ApiError } from '../src/client/api';
const base = { kind: 'listing' as const, id: '42', ready: true, signIn: () => {}, retry: () => {} };
it('gives signed-out visitors a sign-in page and keeps the artwork context', () => {
  const html = renderToStaticMarkup(<DownloadProblem {...base} status={401} />);
  expect(html).toContain('Sign in to access your downloads.');
  expect(html).toContain('Sign in with your wallet');
  expect(html).toContain('class="button primary" href="/listing/42"');
  expect(html).toContain('Back to artwork · Buy a display license');
});
it('explains missing collection access and offers another wallet, license options, and retry', () => {
  const html = renderToStaticMarkup(<DownloadProblem {...base} kind="collection" status={403} />);
  expect(html).toContain('A display license is required.');
  expect(html).toContain('collection');
  expect(html).toContain('Sign in with another wallet');
  expect(html).toContain('Check access again');
  expect(html).toContain('class="button primary" href="/collection/42"');
  expect(html).toContain('Back to collection · Buy a display license');
});
it('offers recovery for unavailable files and chain-service errors', () => {
  for (const status of [404, 503]) {
    const html = renderToStaticMarkup(
      <DownloadProblem {...base} status={status} message="Please retry later." />,
    );
    expect(html).toContain('Please retry later.');
    expect(html).toContain('Check access again');
    expect(html).not.toContain('A display license is required.');
  }
});
it('preserves the API status so the page distinguishes permission errors from outages', async () => {
  const mock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ error: 'No license' }, { status: 403 }));
  try {
    await expect(api('/api/download/42')).rejects.toMatchObject({
      message: 'No license',
      status: 403,
    });
    expect(new ApiError('No license', 403)).toBeInstanceOf(Error);
  } finally {
    mock.mockRestore();
  }
});
