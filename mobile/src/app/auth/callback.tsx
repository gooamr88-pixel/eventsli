import { Redirect } from 'expo-router';

/**
 * eventsli-checkin://auth/callback — where "Sign in with Eventsli" returns.
 * The browser session hands the URL straight to the waiting sign-in call; if
 * the system also routes it here (Android can), there is nothing to show.
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
