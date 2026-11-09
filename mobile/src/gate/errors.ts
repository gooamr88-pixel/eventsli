/**
 * The door's token is no longer accepted (a 401): the device was switched off,
 * the person left the door team, the session ended. Whoever catches it leaves
 * the door (gate/useDoor.ts); held scans stay on the phone.
 */
export class DoorAuthError extends Error {}
