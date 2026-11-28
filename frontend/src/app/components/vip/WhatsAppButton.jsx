import SocialIcon from '../vendors/booking/SocialIcon';

/**
 * "Continue on WhatsApp" (2026-11-28): click-to-chat with the request's
 * reference typed in, opening the app on a phone and WhatsApp Web on a
 * computer. In WhatsApp's own green, with dark ink on it (white on #25D366
 * is 2:1; this is over 9:1).
 */
export default function WhatsAppButton({ href, children = 'Continue on WhatsApp', size = 'md', block = false, onClick }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      className={`es-wabtn es-wabtn--${size}${block ? ' es-wabtn--block' : ''}`}
    >
      <SocialIcon name="whatsapp" size={size === 'lg' ? 24 : 20} />
      <span>{children}</span>
    </a>
  );
}
