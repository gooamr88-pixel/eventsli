/**
 * The app's own pop-ups (src/ui/Dialog.tsx): one at a time, in order; a
 * confirmation answers only through its buttons or by being dismissed; a
 * sheet's choice runs after the sheet has closed.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { dialog, DialogHost, useDialogStore } from '../src/ui/Dialog';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

async function host() {
  await render(<SafeAreaProvider initialMetrics={METRICS}><DialogHost /></SafeAreaProvider>);
}

afterEach(() => useDialogStore.setState({ current: null, queue: [] }));

test('a second message waits for the first to be closed', async () => {
  await host();
  await act(async () => {
    dialog.alert('First', 'One');
    dialog.alert('Second', 'Two');
  });
  expect(screen.getByText('First')).toBeTruthy();
  expect(screen.queryByText('Second')).toBeNull();
  await fireEvent.press(within(screen.getByTestId('dialog')).getByText('OK'));
  expect(screen.queryByText('First')).toBeNull();
  expect(screen.getByText('Second')).toBeTruthy();
  await fireEvent.press(within(screen.getByTestId('dialog')).getByText('OK'));
  expect(screen.queryByTestId('dialog')).toBeNull();
});

test('a confirmation says yes only through its confirming button', async () => {
  await host();
  let answer: boolean | undefined;
  await act(async () => { dialog.confirm({ title: 'Sign out?', confirm: 'Sign out', destructive: true }).then((v) => { answer = v; }); });
  await fireEvent.press(within(screen.getByTestId('dialog')).getByText('Sign out'));
  await act(async () => undefined);
  expect(answer).toBe(true);
});

test('tapping outside a confirmation is a no', async () => {
  await host();
  let answer: boolean | undefined;
  await act(async () => { dialog.confirm({ title: 'Leave?', confirm: 'Leave' }).then((v) => { answer = v; }); });
  // The backdrop is hidden from screen readers by the modal card (they use
  // Cancel or the escape gesture); a finger can still tap it.
  await fireEvent.press(screen.getByLabelText('Close', { includeHiddenElements: true }));
  await act(async () => undefined);
  expect(answer).toBe(false);
  expect(screen.queryByTestId('dialog')).toBeNull();
});

test('a sheet runs the chosen option once it has closed, and ignores a disabled one', async () => {
  await host();
  const chosen: string[] = [];
  await act(async () => {
    dialog.actions({
      title: 'Event',
      options: [
        { icon: 'info', label: 'Details', onPress: () => chosen.push(useDialogStore.getState().current ? 'open' : 'closed') },
        { icon: 'ban', label: 'Off', disabled: true, onPress: () => chosen.push('off') },
      ],
    });
  });
  await fireEvent.press(within(screen.getByTestId('sheet')).getByText('Off'));
  expect(chosen).toEqual([]);
  await fireEvent.press(within(screen.getByTestId('sheet')).getByText('Details'));
  expect(chosen).toEqual(['closed']);
  expect(screen.queryByTestId('sheet')).toBeNull();
});
