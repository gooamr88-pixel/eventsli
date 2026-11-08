import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as WebBrowser from 'expo-web-browser';

import { API_URL } from '../api/client';
import { exchangeCode, REDIRECT_URI } from '../api/endpoints';
import type { AccountSession } from '../api/types';
import { base64ToBase64Url, bytesToBase64Url } from '../lib/base64';

/**
 * "Sign in with Eventsli": authorization code + PKCE (S256) through the system
 * browser, so every way of signing in to the website — password, Google,
 * whatever comes next — works here without the app holding its own client IDs.
 * The server half is backend/services/appAuthService.js and the /app-auth page.
 */

/** "Sara's iPhone" where the platform allows it — so the web account page can name this session. */
export function deviceLabel(): string | null {
  return Device.deviceName || Device.modelName || null;
}

export async function makePkce() {
  const verifier = bytesToBase64Url(Crypto.getRandomBytes(32)); // 43 characters
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: base64ToBase64Url(digest), state: bytesToBase64Url(Crypto.getRandomBytes(16)) };
}

/**
 * The website. In production it is the API's own origin (nginx serves both);
 * against a local stack the site and API are on different ports, so it can be
 * set with EXPO_PUBLIC_SITE_URL.
 */
export function siteUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_SITE_URL;
  return (explicit || API_URL.replace(/\/api\/v1$/, '')).replace(/\/+$/, '');
}

export class SignInCancelled extends Error {}

export async function signInWithEventsli(): Promise<AccountSession> {
  const { verifier, challenge, state } = await makePkce();
  const url = `${siteUrl()}/app-auth?${new URLSearchParams({
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: REDIRECT_URI,
    state,
  }).toString()}`;

  const result = await WebBrowser.openAuthSessionAsync(url, REDIRECT_URI);
  if (result.type !== 'success') throw new SignInCancelled('Sign-in was cancelled.');

  const back = new URL(result.url);
  if (back.searchParams.get('state') !== state) {
    // Not the answer to the request this app made. Never exchanged.
    throw new Error('That sign-in did not come from this app. Try again.');
  }
  if (back.searchParams.get('error')) throw new SignInCancelled('Sign-in was cancelled.');
  const code = back.searchParams.get('code');
  if (!code) throw new Error('The website did not return a sign-in code. Try again.');

  return exchangeCode(code, verifier, deviceLabel());
}
