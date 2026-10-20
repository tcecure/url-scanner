-- Retire customer-published website verification.
--
-- The requester is no longer asked to publish a DNS TXT record or a file, so the
-- per-request secret and the probe job have nothing left to serve. Rows already
-- authorized by those methods keep their recorded method and evidence — the enum
-- values stay so history remains readable, and only new paths are closed off.

ALTER TABLE requests DROP COLUMN IF EXISTS verification_secret;

-- Authorization now comes either from the confirmed contact address on the
-- domain being reviewed, or from a reviewer who confirmed it with the business.
ALTER TYPE authorization_method ADD VALUE IF NOT EXISTS 'contact_confirmation';

-- Nothing queues these any more; a worker on the new image would not know what
-- to do with one left behind.
DELETE FROM jobs WHERE kind = 'authorization_probe' AND status IN ('queued', 'running');
