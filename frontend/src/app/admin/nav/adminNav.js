/**
 * The admin console's destination map (BRD §19–§20).
 *
 * `/admin` keeps rendering the approval queue, as it always has, so existing
 * links to it still land where they did. The overview is its own route.
 */
export function adminNavGroups() {
  return [
    {
      id: 'home',
      label: null,
      items: [
        { key: 'overview', label: 'Overview', icon: 'chart', href: '/admin/overview' },
      ],
    },
    {
      id: 'review',
      label: 'Events',
      items: [
        { key: 'approvals', label: 'Approvals', icon: 'check', href: '/admin', exact: true },
        { key: 'events', label: 'All events', icon: 'calendar', href: '/admin/events' },
        { key: 'cancellations', label: 'Cancellation requests', icon: 'ban', href: '/admin/cancellations' },
      ],
    },
    {
      id: 'people',
      label: 'People',
      items: [
        { key: 'organizers', label: 'Organizers', icon: 'briefcase', href: '/admin/organizers' },
        { key: 'users', label: 'Accounts', icon: 'users', href: '/admin/users' },
      ],
    },
    {
      id: 'money',
      label: 'Money',
      items: [
        { key: 'invoices', label: 'Commission invoices', icon: 'receipt', href: '/admin/invoices' },
      ],
    },
    {
      // Global SMS (admin/sms): the overview links every other SMS section.
      id: 'messaging',
      label: 'Messaging',
      items: [
        { key: 'sms', label: 'SMS overview', icon: 'chat', href: '/admin/sms', exact: true },
        { key: 'sms-countries', label: 'SMS countries', icon: 'globe', href: '/admin/sms/countries' },
        { key: 'sms-campaigns', label: 'SMS campaigns', icon: 'send', href: '/admin/sms/campaigns' },
        { key: 'sms-log', label: 'SMS delivery log', icon: 'list', href: '/admin/sms/messages' },
      ],
    },
    {
      id: 'storefront',
      label: 'Storefront',
      items: [
        { key: 'content', label: 'Homepage content', icon: 'layers', href: '/admin/content' },
      ],
    },
    {
      id: 'governance',
      label: 'Governance',
      items: [
        { key: 'settings', label: 'Settings', icon: 'settings', href: '/admin/settings' },
        { key: 'audit', label: 'Audit log', icon: 'list', href: '/admin/audit' },
      ],
    },
  ];
}

export const ADMIN_TABS = ['overview', 'approvals', 'events', 'users'];
