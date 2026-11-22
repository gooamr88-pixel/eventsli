import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VenueCard from '../src/app/e/[slug]/VenueCard';

/** "Getting there" (owner, 2026-11-22: "very amazing and professional"). */
describe('VenueCard', () => {
  const props = { venue: 'Mike Aqrawi', address: '11054 fury LN', city: 'Toronto', country: 'CA' };

  test('the venue, its address and its place, with directions and three map apps', () => {
    render(<VenueCard {...props} />);
    expect(screen.getByRole('heading', { name: 'Getting there' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Mike Aqrawi' })).toBeInTheDocument();
    expect(screen.getByText('11054 fury LN')).toBeInTheDocument();
    expect(screen.getByText('Toronto, Canada')).toBeInTheDocument();
    const q = encodeURIComponent('Mike Aqrawi, 11054 fury LN, Toronto');
    expect(screen.getByRole('link', { name: /Get directions/ })).toHaveAttribute('href', `https://www.google.com/maps/dir/?api=1&destination=${q}`);
    expect(screen.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', expect.stringContaining(q));
    expect(screen.getByRole('link', { name: /Apple Maps/ })).toHaveAttribute('href', `https://maps.apple.com/?q=${q}`);
    expect(screen.getByRole('link', { name: /Waze/ })).toHaveAttribute('href', `https://waze.com/ul?q=${q}&navigate=yes`);
  });

  test('no pin: no live map is offered and nothing third-party loads', () => {
    const { container } = render(<VenueCard {...props} />);
    expect(screen.queryByRole('button', { name: /Show live map/ })).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

  test('with a pin: the live map loads only when asked; Waze and Apple use the pin', async () => {
    const user = userEvent.setup();
    const { container } = render(<VenueCard {...props} location={{ lat: 43.65, lng: -79.38 }} />);
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.getByRole('link', { name: /Waze/ })).toHaveAttribute('href', 'https://waze.com/ul?ll=43.65,-79.38&navigate=yes');
    expect(screen.getByRole('link', { name: /Apple Maps/ }).getAttribute('href')).toContain('&ll=43.65,-79.38');
    await user.click(screen.getByRole('button', { name: /Show live map/ }));
    expect(container.querySelector('iframe')).toHaveAttribute('src', expect.stringContaining('openstreetmap.org/export/embed.html'));
    expect(screen.getByRole('link', { name: /OpenStreetMap contributors/ })).toBeInTheDocument();
  });

  test('Copy address puts the whole address on the clipboard and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<VenueCard {...props} />);
    await user.click(screen.getByRole('button', { name: /Copy address/ }));
    expect(writeText).toHaveBeenCalledWith('Mike Aqrawi, 11054 fury LN, Toronto, Canada');
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeInTheDocument();
  });

  test('nothing to say: renders nothing', () => {
    const { container } = render(<VenueCard />);
    expect(container).toBeEmptyDOMElement();
  });
});
