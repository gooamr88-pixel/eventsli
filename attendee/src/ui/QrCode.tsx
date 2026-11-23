import QRCode from 'qrcode';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from './theme';

/**
 * The ticket's QR, drawn on the phone from the signed token the API issued
 * (ticketService.shape → `qr`).
 *
 * Drawn HERE rather than fetched as an image: a basement venue with no signal
 * is exactly where the code has to appear, and a token already on the phone
 * needs nothing from the network to become a picture. The same library, level
 * (M) and ink as the emailed code (backend ticketController.qrImage); the
 * quiet zone is the standard's four modules rather than the email's one,
 * because a phone screen in a dark room has glare at its edges.
 */
export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const path = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const d: string[] = [];
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        if (qr.modules.get(x, y)) d.push(`M${x + 4} ${y + 4}h1v1h-1z`);
      }
    }
    return { d: d.join(''), box: n + 8 };
  }, [value]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${path.box} ${path.box}`} accessibilityLabel="Ticket QR code">
      <Rect x={0} y={0} width={path.box} height={path.box} fill={colors.white} />
      <Path d={path.d} fill={colors.night} />
    </Svg>
  );
}
