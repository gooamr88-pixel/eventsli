-- ═══════════════════════════════════════════════════════════════════════════
-- terms_versions.version was UNIQUE across the whole table.
--
-- That is wrong: organizer terms and buyer terms are two independent documents
-- with independent histories. A global unique means publishing "organizer v1"
-- makes "buyer v1" impossible — the two would have to interleave their version
-- numbers forever (organizer 1, buyer 2, organizer 3), which is unreadable and
-- makes "which version of the buyer terms did they accept?" a question you
-- cannot answer by looking.
--
-- Caught by the seed insert failing, which is the cheapest possible place to
-- catch it. The constraint becomes unique per (audience, version).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE terms_versions DROP CONSTRAINT IF EXISTS terms_versions_version_key;

ALTER TABLE terms_versions
  ADD CONSTRAINT terms_versions_audience_version_key UNIQUE (audience, version);
