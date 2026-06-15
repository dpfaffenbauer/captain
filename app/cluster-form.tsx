import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  azureRedirectUri,
  azureSignIn,
  DEFAULT_GKE_CLIENT_ID,
  googleSignIn,
  OAuthTokens,
  oidcRedirectUri,
  oidcSignIn,
} from '../src/auth/oauth';
import { invalidateToken } from '../src/auth/tokens';
import { getServerVersion } from '../src/kube/client';
import { useClusters } from '../src/state/ClustersContext';
import { AuthType, ClusterConfig } from '../src/types';
import { ProviderTile, SignInButton } from '../src/ui/brand';
import { Button, ErrorBox, Field } from '../src/ui/components';
import { colors, spacing } from '../src/ui/theme';
import { newId } from '../src/util/format';

const AUTH_TYPES: Array<{ type: AuthType; label: string; subtitle: string }> = [
  { type: 'gke', label: 'Google GKE', subtitle: 'Sign in with Google' },
  { type: 'aks', label: 'Azure AKS', subtitle: 'Sign in with Microsoft' },
  { type: 'eks', label: 'AWS EKS', subtitle: 'IAM credentials' },
  { type: 'oidc', label: 'OIDC / SSO', subtitle: 'Keycloak · Dex · Authentik' },
  { type: 'token', label: 'Token', subtitle: 'Bearer · ServiceAccount' },
  { type: 'clientCert', label: 'Certificate', subtitle: 'mTLS · PKCS#12' },
];

export default function ClusterFormScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { getById, addOrUpdate } = useClusters();
  const existing = id ? getById(id) : undefined;

  const [name, setName] = useState(existing?.name ?? '');
  const [server, setServer] = useState(existing?.server ?? '');
  const [caData, setCaData] = useState(existing?.caData ?? '');
  const [insecure, setInsecure] = useState(existing?.insecureSkipTlsVerify ?? false);
  const [clientCertData, setClientCertData] = useState(existing?.clientCertData ?? '');
  const [clientKeyData, setClientKeyData] = useState(existing?.clientKeyData ?? '');
  const [clientP12, setClientP12] = useState(existing?.clientP12 ?? '');
  const [clientP12Password, setClientP12Password] = useState(existing?.clientP12Password ?? '');

  const [authType, setAuthType] = useState<AuthType>(existing?.auth.type ?? 'token');
  const [token, setToken] = useState(existing?.auth.type === 'token' ? existing.auth.token : '');
  const eksAuth = existing?.auth.type === 'eks' ? existing.auth : undefined;
  const [eksRegion, setEksRegion] = useState(eksAuth?.region ?? '');
  const [eksClusterName, setEksClusterName] = useState(eksAuth?.clusterName ?? '');
  const [eksAccessKeyId, setEksAccessKeyId] = useState(eksAuth?.accessKeyId ?? '');
  const [eksSecretAccessKey, setEksSecretAccessKey] = useState(eksAuth?.secretAccessKey ?? '');
  const [eksSessionToken, setEksSessionToken] = useState(eksAuth?.sessionToken ?? '');
  const gkeAuth = existing?.auth.type === 'gke' ? existing.auth : undefined;
  const [gkeClientId, setGkeClientId] = useState(gkeAuth?.clientId || DEFAULT_GKE_CLIENT_ID);
  const aksAuth = existing?.auth.type === 'aks' ? existing.auth : undefined;
  const [aksTenantId, setAksTenantId] = useState(aksAuth?.tenantId ?? '');
  const [aksClientId, setAksClientId] = useState(aksAuth?.clientId ?? '');
  const oidcAuth = existing?.auth.type === 'oidc' ? existing.auth : undefined;
  const [oidcIssuer, setOidcIssuer] = useState(oidcAuth?.issuer ?? '');
  const [oidcClientId, setOidcClientId] = useState(oidcAuth?.clientId ?? '');
  const [oidcClientSecret, setOidcClientSecret] = useState(oidcAuth?.clientSecret ?? '');
  const [oidcExtraScopes, setOidcExtraScopes] = useState(oidcAuth?.extraScopes ?? '');
  const [oauthTokens, setOauthTokens] = useState<OAuthTokens | undefined>(
    gkeAuth?.accessToken || aksAuth?.accessToken || oidcAuth?.accessToken
      ? {
          accessToken: (gkeAuth?.accessToken ?? aksAuth?.accessToken ?? oidcAuth?.accessToken)!,
          refreshToken: gkeAuth?.refreshToken ?? aksAuth?.refreshToken ?? oidcAuth?.refreshToken,
          idToken: oidcAuth?.idToken,
          expiresAt: gkeAuth?.expiresAt ?? aksAuth?.expiresAt ?? oidcAuth?.expiresAt ?? 0,
        }
      : undefined
  );

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const buildCluster = (): ClusterConfig => {
    const base = {
      id: existing?.id ?? newId(),
      name: name.trim() || server.trim(),
      server: server.trim(),
      caData: caData.trim() || undefined,
      insecureSkipTlsVerify: insecure || undefined,
      clientCertData: clientCertData.trim() || undefined,
      clientKeyData: clientKeyData.trim() || undefined,
      clientP12: clientP12.trim() || undefined,
      clientP12Password: clientP12Password || undefined,
    };
    switch (authType) {
      case 'token':
        return { ...base, auth: { type: 'token', token: token.trim() } };
      case 'clientCert':
        return { ...base, auth: { type: 'clientCert' } };
      case 'eks':
        return {
          ...base,
          auth: {
            type: 'eks',
            region: eksRegion.trim(),
            clusterName: eksClusterName.trim(),
            accessKeyId: eksAccessKeyId.trim(),
            secretAccessKey: eksSecretAccessKey.trim(),
            sessionToken: eksSessionToken.trim() || undefined,
          },
        };
      case 'gke':
        return {
          ...base,
          auth: {
            type: 'gke',
            clientId: gkeClientId.trim(),
            accessToken: oauthTokens?.accessToken,
            refreshToken: oauthTokens?.refreshToken,
            expiresAt: oauthTokens?.expiresAt,
          },
        };
      case 'aks':
        return {
          ...base,
          auth: {
            type: 'aks',
            tenantId: aksTenantId.trim(),
            clientId: aksClientId.trim(),
            accessToken: oauthTokens?.accessToken,
            refreshToken: oauthTokens?.refreshToken,
            expiresAt: oauthTokens?.expiresAt,
          },
        };
      case 'oidc':
        return {
          ...base,
          auth: {
            type: 'oidc',
            issuer: oidcIssuer.trim(),
            clientId: oidcClientId.trim(),
            clientSecret: oidcClientSecret.trim() || undefined,
            extraScopes: oidcExtraScopes.trim() || undefined,
            idToken: oauthTokens?.idToken,
            accessToken: oauthTokens?.accessToken,
            refreshToken: oauthTokens?.refreshToken,
            expiresAt: oauthTokens?.expiresAt,
          },
        };
    }
  };

  const validate = (): string | undefined => {
    if (!server.trim().startsWith('http')) {
      return 'Please provide a valid API server URL (https://…).';
    }
    if (authType === 'token' && !token.trim()) return 'Please provide a Bearer token.';
    if (authType === 'clientCert') {
      const hasPemPair = clientCertData.trim().length > 0 && clientKeyData.trim().length > 0;
      if (!hasPemPair && !clientP12.trim()) {
        return 'For certificate auth, please provide a client certificate and key (PEM or base64, as in the kubeconfig).';
      }
    }
    if (authType === 'eks' && (!eksRegion.trim() || !eksClusterName.trim() || !eksAccessKeyId.trim() || !eksSecretAccessKey.trim())) {
      return 'EKS requires a region, cluster name, access key, and secret key.';
    }
    if (authType === 'gke' && !oauthTokens) return 'Please sign in with Google first.';
    if (authType === 'aks' && !oauthTokens) return 'Please sign in with Microsoft first.';
    if (authType === 'oidc' && !oauthTokens) return 'Please sign in with the OIDC provider first.';
    return undefined;
  };

  const handleOAuthSignIn = async () => {
    setError('');
    setBusy(true);
    try {
      const tokens =
        authType === 'gke'
          ? await googleSignIn(gkeClientId.trim())
          : authType === 'aks'
            ? await azureSignIn(aksTenantId.trim(), aksClientId.trim())
            : await oidcSignIn(oidcIssuer.trim(), oidcClientId.trim(), {
                clientSecret: oidcClientSecret.trim() || undefined,
                extraScopes: oidcExtraScopes.trim() || undefined,
              });
      setOauthTokens(tokens);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const cluster = buildCluster();
      invalidateToken(cluster.id);
      const version = await getServerVersion(cluster);
      Alert.alert('Connection successful', `Kubernetes ${version}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    const cluster = buildCluster();
    invalidateToken(cluster.id);
    await addOrUpdate(cluster);
    router.back();
  };

  const azureRedirect = useMemo(() => azureRedirectUri(), []);
  const oidcRedirect = useMemo(() => oidcRedirectUri(), []);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {error ? <ErrorBox message={error} /> : null}

        <Field label="Name" value={name} onChangeText={setName} placeholder="My cluster" />
        <Field
          label="API server URL"
          value={server}
          onChangeText={setServer}
          placeholder="https://1.2.3.4:6443"
          keyboardType="url"
        />
        <Field
          label="Cluster CA (PEM or base64, optional)"
          value={caData}
          onChangeText={setCaData}
          placeholder="certificate-authority-data from the kubeconfig"
          multiline
        />
        <TouchableOpacity style={styles.toggleRow} onPress={() => setInsecure(!insecure)}>
          <View style={[styles.checkbox, insecure && styles.checkboxChecked]} />
          <Text style={styles.toggleLabel}>Skip TLS verification (insecure)</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Sign in with</Text>
        <View style={styles.providerGrid}>
          {AUTH_TYPES.map((option) => (
            <ProviderTile
              key={option.type}
              provider={option.type}
              title={option.label}
              subtitle={option.subtitle}
              active={authType === option.type}
              onPress={() => {
                setAuthType(option.type);
                setOauthTokens(undefined);
                setError('');
              }}
            />
          ))}
        </View>

        {authType === 'token' && (
          <Field
            label="Bearer token (e.g. ServiceAccount token)"
            value={token}
            onChangeText={setToken}
            placeholder="eyJhbGciOi…"
            multiline
          />
        )}

        {authType === 'eks' && (
          <>
            <Field label="AWS region" value={eksRegion} onChangeText={setEksRegion} placeholder="eu-central-1" />
            <Field label="EKS cluster name" value={eksClusterName} onChangeText={setEksClusterName} placeholder="my-cluster" />
            <Field label="Access Key ID" value={eksAccessKeyId} onChangeText={setEksAccessKeyId} placeholder="AKIA…" />
            <Field
              label="Secret Access Key"
              value={eksSecretAccessKey}
              onChangeText={setEksSecretAccessKey}
              secureTextEntry
            />
            <Field
              label="Session token (optional, for temporary credentials)"
              value={eksSessionToken}
              onChangeText={setEksSessionToken}
              multiline
            />
          </>
        )}

        {authType === 'gke' && (
          <>
            {!DEFAULT_GKE_CLIENT_ID && (
              <Field
                label="OAuth client ID (iOS client from the Google Cloud Console)"
                value={gkeClientId}
                onChangeText={setGkeClientId}
                placeholder="1234-abc.apps.googleusercontent.com"
              />
            )}
            <SignInButton
              provider="gke"
              title={oauthTokens ? 'Connected with Google ✓' : 'Sign in with Google'}
              onPress={() => void handleOAuthSignIn()}
              disabled={!gkeClientId.trim()}
              busy={busy}
              connected={!!oauthTokens}
            />
          </>
        )}

        {authType === 'aks' && (
          <>
            <Field label="Entra tenant ID" value={aksTenantId} onChangeText={setAksTenantId} placeholder="00000000-0000-…" />
            <Field
              label="App registration client ID"
              value={aksClientId}
              onChangeText={setAksClientId}
              placeholder="00000000-0000-…"
            />
            <Text style={styles.hint}>Redirect URI for the app registration: {azureRedirect}</Text>
            <SignInButton
              provider="aks"
              title={oauthTokens ? 'Connected with Microsoft ✓' : 'Sign in with Microsoft'}
              onPress={() => void handleOAuthSignIn()}
              disabled={!aksTenantId.trim() || !aksClientId.trim()}
              busy={busy}
              connected={!!oauthTokens}
            />
          </>
        )}

        {authType === 'oidc' && (
          <>
            <Field
              label="Issuer URL"
              value={oidcIssuer}
              onChangeText={setOidcIssuer}
              placeholder="https://keycloak.example.com/realms/main"
              keyboardType="url"
            />
            <Field
              label="Client ID"
              value={oidcClientId}
              onChangeText={setOidcClientId}
              placeholder="kubernetes"
            />
            <Field
              label="Client secret (only for confidential clients)"
              value={oidcClientSecret}
              onChangeText={setOidcClientSecret}
              secureTextEntry
            />
            <Field
              label="Additional scopes (optional, e.g. groups)"
              value={oidcExtraScopes}
              onChangeText={setOidcExtraScopes}
              placeholder="groups"
            />
            <Text style={styles.hint}>Redirect URI for the OIDC client: {oidcRedirect}</Text>
            <SignInButton
              provider="oidc"
              title={oauthTokens ? 'Signed in ✓ – sign in again' : 'Sign in with SSO'}
              onPress={() => void handleOAuthSignIn()}
              disabled={!oidcIssuer.trim() || !oidcClientId.trim()}
              busy={busy}
              connected={!!oauthTokens}
            />
            <Text style={styles.hint}>
              The API server must be configured with matching --oidc-issuer-url/--oidc-client-id
              flags; Captain sends the ID token as a Bearer token.
            </Text>
          </>
        )}

        {(authType === 'clientCert' || clientCertData.length > 0 || clientP12.length > 0) && (
          <>
            <Field
              label="Client certificate (PEM or base64)"
              value={clientCertData}
              onChangeText={setClientCertData}
              placeholder="client-certificate-data from the kubeconfig"
              multiline
            />
            <Field
              label="Client key (PEM or base64)"
              value={clientKeyData}
              onChangeText={setClientKeyData}
              placeholder="client-key-data from the kubeconfig"
              multiline
            />
            <Text style={styles.hint}>
              Alternatively, a PKCS#12 bundle can be provided instead of a certificate + key:
            </Text>
            <Field
              label="PKCS#12 (base64, optional)"
              value={clientP12}
              onChangeText={setClientP12}
              placeholder="base64 of: openssl pkcs12 -export -in client.crt -inkey client.key"
              multiline
            />
            <Field
              label="PKCS#12 password"
              value={clientP12Password}
              onChangeText={setClientP12Password}
              secureTextEntry
            />
          </>
        )}

        <View style={styles.actions}>
          <Button title="Test connection" variant="secondary" onPress={() => void handleTest()} busy={busy} />
          <Button title="Save" onPress={() => void handleSave()} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 48 },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  providerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginRight: spacing.sm,
  },
  checkboxChecked: { backgroundColor: colors.warning, borderColor: colors.warning },
  toggleLabel: { color: colors.text, fontSize: 14 },
  hint: { color: colors.textDim, fontSize: 12, marginBottom: spacing.sm },
  actions: { marginTop: spacing.lg },
});
