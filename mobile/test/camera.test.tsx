/**
 * The camera at the door (src/gate/CodeCamera.tsx). A preview that cannot
 * start — another app holding the camera, a hardware fault — used to leave a
 * black frame with nothing to read or press (audit 2026-11-20). It now says
 * what happened, what else the door can do, and lets the person try again.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { CodeCamera } from '../src/gate/CodeCamera';

const mounts: { onMountError?: (e: { message: string }) => void; onBarcodeScanned?: (r: { data: string }) => void }[] = [];

jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
    CameraView: (props: never) => {
      mounts.push(props);
      return <View testID="camera" />;
    },
  };
});

beforeEach(() => { mounts.length = 0; });

test('a camera that will not start says so, offers the other way in, and can be tried again', async () => {
  const onCode = jest.fn();
  await render(<CodeCamera onCode={onCode} onCameraFailedHint="find the guest by name below" />);
  expect(screen.getByTestId('camera')).toBeTruthy();

  await act(async () => { mounts.at(-1)!.onMountError!({ message: 'Camera is in use' }); });
  expect(screen.queryByTestId('camera')).toBeNull();
  expect(screen.getByText('The camera did not start')).toBeTruthy();
  expect(screen.getByText(/find the guest by name below/)).toBeTruthy();

  const before = mounts.length;
  await fireEvent.press(screen.getByText('Try again'));
  expect(screen.getByTestId('camera')).toBeTruthy();
  expect(mounts.length).toBeGreaterThan(before);

  // And it reads codes again.
  await act(async () => { mounts.at(-1)!.onBarcodeScanned!({ data: 'a.b.c' }); });
  expect(onCode).toHaveBeenCalledWith('a.b.c');
});
