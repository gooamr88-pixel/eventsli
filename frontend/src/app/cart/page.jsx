import CartClient from './CartClient';
import { ConfirmProvider } from '../components/ui/Confirm';

/**
 * The ticket cart (owner, 2026-11-17). Personal and live — what this buyer
 * holds, with each hold's deadline — so it is never indexed or cached; the
 * contents are read in the browser from `POST /public/cart`.
 */
export const metadata = {
  title: 'Your cart',
  robots: { index: false, follow: false },
};

export default function CartPage() {
  return (
    <main className="fx-section fx-gutter">
      <div className="fx-container fx-container--lg">
        {/* "Remove" asks first. The provider lives in the signed-in areas'
            layouts only; without one here, every confirm answers "no". */}
        <ConfirmProvider>
          <CartClient />
        </ConfirmProvider>
      </div>
    </main>
  );
}
