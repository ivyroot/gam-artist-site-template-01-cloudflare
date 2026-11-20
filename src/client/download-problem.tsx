import React from 'react';
import type { Kind } from '../shared/model';
export function DownloadProblem({
  kind,
  id,
  status,
  message,
  signIn,
  retry,
  ready,
}: {
  kind: Kind;
  id: string;
  status?: number;
  message?: string;
  signIn: () => void;
  retry: () => void;
  ready: boolean;
}) {
  const signedOut = status === 401,
    denied = status === 403;
  return (
    <div className="empty" role="alert">
      <h2>
        {signedOut
          ? 'Sign in to access your downloads.'
          : denied
            ? 'A display license is required.'
            : status === 404
              ? 'This artwork is unavailable.'
              : 'We couldn’t open your downloads.'}
      </h2>
      <p>
        {signedOut
          ? 'Sign in with the wallet you used to purchase your display license.'
          : denied
            ? `This wallet doesn’t have a current display license for this ${kind === 'collection' ? 'collection' : 'artwork'}. If you’ve already purchased, sign in with the wallet you used. A recent purchase may still be confirming.`
            : message || 'We couldn’t verify download access right now. Please try again.'}
      </p>
      {(signedOut || denied) && (
        <>
          <p>
            Don’t have a display license yet? Return to the{' '}
            {kind === 'collection' ? 'collection' : 'artwork'} to purchase one.
          </p>
          <p>
            <a className="button primary" href={`/${kind}/${id}`}>
              Back to {kind === 'collection' ? 'collection' : 'artwork'} · Buy a display license
            </a>
          </p>
          <button className="secondary" disabled={!ready} onClick={signIn}>
            {signedOut
              ? 'Already purchased? Sign in with your wallet ↗'
              : 'Already purchased? Sign in with another wallet ↗'}
          </button>
        </>
      )}
      {!signedOut && <button onClick={retry}>Check access again</button>}
      <p>
        {!signedOut && !denied && (
          <>
            <a href={`/${kind}/${id}`}>View artwork and license options</a>
            {' · '}
          </>
        )}
        <a href="/library">Your library</a>
        {' · '}
        <a href="/">Browse works</a>
      </p>
    </div>
  );
}
