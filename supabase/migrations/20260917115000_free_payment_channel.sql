-- ═══════════════════════════════════════════════════════════════════════════
-- A free ticket is not a cash sale.
--
-- `payment_channel` had two values: 'stripe' for a card payment and 'manual'
-- for money the organizer took themselves. Free tickets are about to exist, and
-- neither fits — a claimed free ticket involves no card and no money changing
-- hands at the door.
--
-- Filing them as 'manual' would have worked numerically (every amount is zero,
-- so every ledger guard skips them) and been wrong everywhere a person looks:
-- `/manual-sales` filters on that channel, so an organizer's record of cash
-- taken would fill up with tickets nobody paid for, and the commission page
-- would list debts of nothing.
--
--
-- WHY THIS IS ITS OWN MIGRATION, alone, doing one thing.
--
-- `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction that adds
-- it. The new value has to be committed before any statement may reference it,
-- so a value and its first use are always two migrations — the same constraint
-- the event category enum ran into in 20260905090000, noted there.
--
-- Everything that USES 'free' is in the migration after this one.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE payment_channel ADD VALUE IF NOT EXISTS 'free';

COMMENT ON TYPE payment_channel IS
  'stripe = card payment taken by the platform. '
  'manual = money the organizer collected themselves (BRD §03). '
  'free = no money at all: a ticket claimed on an event whose total was zero.';
