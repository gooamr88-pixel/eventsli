'use client';

import Link from 'next/link';
import { ToastProvider } from '../../../components/ui/Toast';
import { ConfirmProvider } from '../../../components/ui/Confirm';
import { Notice } from '../../../components/Feedback';
import VipRequest from '../../../organizer/vip/[id]/VipRequest';

/**
 * The organizer's request page, opened with a visitor's link (2026-11-28).
 * Public pages carry no toast or confirm providers of their own (the
 * dashboards do), so this one brings them.
 */
export default function VisitorRequest({ id, token }) {
  if (!token) {
    return (
      <Notice tone="warning" title="This link is missing its key.">
        <p>Open the request from the email we sent you, or <Link href="/vip">start a new request</Link>.</p>
      </Notice>
    );
  }
  return (
    <ToastProvider>
      <ConfirmProvider>
        <VipRequest id={id} token={token} />
      </ConfirmProvider>
    </ToastProvider>
  );
}
