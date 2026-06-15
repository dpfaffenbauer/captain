import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** OIDC ID token — the credential Kubernetes itself validates. */
  idToken?: string;
  /** Unix epoch milliseconds. */
  expiresAt: number;
}

const GOOGLE_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
};

/**
 * Built-in Google OAuth client used as the default for GKE sign-in, so users
 * don't have to register and paste their own client ID — the GKE flow becomes a
 * single tap. Must be a Google OAuth client of type **iOS** (no client secret;
 * the redirect URI is the reversed client ID — see googleRedirectUri). A
 * desktop/web client will NOT work, since iOS only supports the custom-scheme
 * redirect that iOS clients provide.
 *
 * While empty, the UI falls back to asking the user for their own client ID.
 * Set this to Captain's registered iOS client ID to enable one-tap sign-in.
 */
export const DEFAULT_GKE_CLIENT_ID: string =
  '484570136896-chbg23os8doul86cieiom5ob80d3q8oq.apps.googleusercontent.com';

/** Scope of the AKS AAD server application (fixed ID for all AKS clusters). */
export const AKS_SERVER_APP_ID = '6dae42f8-4368-4678-94ff-3960e28e3630';

function azureDiscovery(tenantId: string): AuthSession.DiscoveryDocument {
  const base = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
  return { authorizationEndpoint: `${base}/authorize`, tokenEndpoint: `${base}/token` };
}

function toTokens(response: AuthSession.TokenResponse, previousRefreshToken?: string): OAuthTokens {
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken ?? previousRefreshToken,
    idToken: response.idToken,
    expiresAt: (response.issuedAt + (response.expiresIn ?? 300)) * 1000,
  };
}

/**
 * Redirect URI for a Google iOS OAuth client: the reversed client ID scheme.
 * Example: 123-abc.apps.googleusercontent.com → com.googleusercontent.apps.123-abc:/oauth2redirect
 */
export function googleRedirectUri(clientId: string): string {
  const reversed = clientId.replace(/\.apps\.googleusercontent\.com$/, '');
  return `com.googleusercontent.apps.${reversed}:/oauth2redirect`;
}

export function azureRedirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'captain', path: 'oauth' });
}

async function signIn(
  clientId: string,
  scopes: string[],
  redirectUri: string,
  discovery: AuthSession.DiscoveryDocument,
  extraParams?: Record<string, string>,
  clientSecret?: string
): Promise<OAuthTokens> {
  const request = new AuthSession.AuthRequest({
    clientId,
    scopes,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams,
  });
  const result = await request.promptAsync(discovery);
  if (result.type !== 'success' || !result.params.code) {
    throw new Error(
      result.type === 'error'
        ? result.error?.message ?? 'Sign-in failed'
        : 'Sign-in canceled'
    );
  }
  const tokenResponse = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      clientSecret,
      code: result.params.code,
      redirectUri,
      extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined,
    },
    discovery
  );
  return toTokens(tokenResponse);
}

export async function googleSignIn(clientId: string): Promise<OAuthTokens> {
  return signIn(
    clientId,
    ['openid', 'https://www.googleapis.com/auth/cloud-platform'],
    googleRedirectUri(clientId),
    GOOGLE_DISCOVERY,
    // Ask Google for a refresh token so the session survives token expiry.
    { access_type: 'offline', prompt: 'consent' }
  );
}

export async function googleRefresh(clientId: string, refreshToken: string): Promise<OAuthTokens> {
  const response = await AuthSession.refreshAsync({ clientId, refreshToken }, GOOGLE_DISCOVERY);
  return toTokens(response, refreshToken);
}

export async function azureSignIn(tenantId: string, clientId: string): Promise<OAuthTokens> {
  return signIn(
    clientId,
    ['openid', 'offline_access', `${AKS_SERVER_APP_ID}/user.read`],
    azureRedirectUri(),
    azureDiscovery(tenantId)
  );
}

export function oidcRedirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'captain', path: 'oauth' });
}

function oidcScopes(extraScopes?: string): string[] {
  const scopes = ['openid', 'profile', 'email', 'offline_access'];
  for (const scope of (extraScopes ?? '').split(/\s+/)) {
    if (scope && !scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

/**
 * Generic OIDC sign-in (Keycloak, Dex, Authentik, …): endpoints come from the
 * issuer's discovery document, the flow is Authorization Code + PKCE.
 */
export async function oidcSignIn(
  issuer: string,
  clientId: string,
  options: { clientSecret?: string; extraScopes?: string } = {}
): Promise<OAuthTokens> {
  const discovery = await AuthSession.fetchDiscoveryAsync(issuer.replace(/\/+$/, ''));
  return signIn(
    clientId,
    oidcScopes(options.extraScopes),
    oidcRedirectUri(),
    discovery,
    undefined,
    options.clientSecret
  );
}

export async function oidcRefresh(
  issuer: string,
  clientId: string,
  refreshToken: string,
  options: { clientSecret?: string; extraScopes?: string } = {}
): Promise<OAuthTokens> {
  const discovery = await AuthSession.fetchDiscoveryAsync(issuer.replace(/\/+$/, ''));
  const response = await AuthSession.refreshAsync(
    {
      clientId,
      clientSecret: options.clientSecret,
      refreshToken,
      scopes: oidcScopes(options.extraScopes),
    },
    discovery
  );
  return toTokens(response, refreshToken);
}

export async function azureRefresh(
  tenantId: string,
  clientId: string,
  refreshToken: string
): Promise<OAuthTokens> {
  const response = await AuthSession.refreshAsync(
    { clientId, refreshToken, scopes: ['openid', 'offline_access', `${AKS_SERVER_APP_ID}/user.read`] },
    azureDiscovery(tenantId)
  );
  return toTokens(response, refreshToken);
}
