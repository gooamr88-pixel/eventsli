'use client';

import Link from 'next/link';
import { useAuth } from '../hooks/useAuth';
import NavIcon from '../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WAY INTO THE ADMIN CONSOLE, for the people who run Eventsli.
 *
 * Eventsli's own staff organize events on the platform, so the same account is
 * both. The only route across used to be one line at the bottom of the site
 * menu — a link you have to know is there, below the fold on a phone, in the
 * place people look for "sign out". Somebody with approvals waiting had to go
 * and find it.
 *
 * SHOWN ONLY TO ADMINS, AND THE SERVER STILL DECIDES. `user.isAdmin` comes from
 * `/auth/me`, which reads the role server-side; this is presentation. Every
 * admin route and every admin endpoint checks again — a card that should not
 * have rendered is a cosmetic bug, never an open door.
 *
 * A CARD RATHER THAN A BUTTON IN THE HEADER. The header is where an organizer
 * creates an event, and putting "Admin console" beside it is how somebody
 * clicks the wrong one in a hurry. This says whose it is and what it leads to,
 * and it is unmistakably a different room.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AdminEntry() {
  const { user } = useAuth();
  if (!user?.isAdmin) return null;

  return (
    <section className="es-adminentry" aria-labelledby="admin-entry-title">
      <span className="es-adminentry__mark" aria-hidden="true">
        <NavIcon name="shield" size={20} />
      </span>

      <div className="fx-min0 fx-stack fx-stack--sm gap-1">
        <p id="admin-entry-title" className="es-adminentry__title">
          {user.isSuperAdmin ? 'Super admin access' : 'Admin access'}
        </p>
        <p className="text-sm text-muted">
          You also run Eventsli. Review and publish events, set fees, handle cancellations,
          organizers and payouts from the admin dashboard.
        </p>
      </div>

      <div className="es-adminentry__actions">
        <Link href="/admin/overview" className="es-btn es-btn--primary">
          <NavIcon name="chart" size={18} />
          Admin dashboard
        </Link>
        {/* Approvals is what an admin opens this for most days, so it gets its
            own way in rather than one more click inside the console. */}
        <Link href="/admin" className="es-btn es-btn--secondary">
          Approvals
        </Link>
      </div>
    </section>
  );
}
