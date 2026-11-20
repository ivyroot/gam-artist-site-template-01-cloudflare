import React from 'react';
export interface WebsiteRegistrationStatus {
  registered: boolean;
  registeredAt: string | null;
  url: string | null;
}
export function WebsiteRegistration({
  website,
  syncComplete,
  busy,
  origin,
  websiteId,
  register,
}: {
  website?: WebsiteRegistrationStatus;
  syncComplete: boolean;
  busy: boolean;
  origin: string;
  websiteId: string;
  register: () => void;
}) {
  const registered = Boolean(website?.registered);
  const conflict = Boolean(website?.url && website.url !== origin);
  const canRegister = Boolean(website && syncComplete && !registered && !conflict);
  return (
    <section className="setup-card" aria-labelledby="website-registration-heading">
      <p className="eyebrow">
        {registered
          ? 'WEBSITE REGISTERED'
          : !website || !syncComplete
            ? 'CHECKING REGISTRATION'
            : 'REQUIRED BEFORE PUBLISHING'}
      </p>
      <h2 id="website-registration-heading">Website registration</h2>
      <p role="status">
        {registered ? (
          <>
            {website?.registeredAt ? (
              <>
                Registered since{' '}
                <time dateTime={website.registeredAt}>
                  {new Date(website.registeredAt).toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric',
                  })}
                </time>
                .
              </>
            ) : (
              'Website registration confirmed.'
            )}{' '}
            {syncComplete
              ? 'You can publish works and collections.'
              : 'Checking the latest chain history before publishing.'}
          </>
        ) : !website || !syncComplete ? (
          'Checking confirmed website registration. Publishing stays locked until chain sync finishes.'
        ) : conflict ? (
          'This website ID is registered to a different address. Correct the website configuration before publishing.'
        ) : (
          'Register this website on-chain before publishing your first work or collection.'
        )}
      </p>
      <p>
        Website address: <strong>{origin}</strong> · Website ID {websiteId}
      </p>
      {canRegister && (
        <button className="primary" disabled={busy} onClick={register}>
          Register this website in wallet ↗
        </button>
      )}
      {!registered && (
        <p className="fine">
          Register once for this website. Website registration is separate from your artist name. A
          listing’s website ID becomes fixed when published.
        </p>
      )}
    </section>
  );
}
