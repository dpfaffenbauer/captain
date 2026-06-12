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
  googleSignIn,
  OAuthTokens,
  oidcRedirectUri,
  oidcSignIn,
} from '../src/auth/oauth';
import { invalidateToken } from '../src/auth/tokens';
import { getServerVersion } from '../src/kube/client';
import { useClusters } from '../src/state/ClustersContext';
import { AuthType, ClusterConfig } from '../src/types';
import { Button, ErrorBox, Field } from '../src/ui/components';
import { colors, spacing } from '../src/ui/theme';
import { newId } from '../src/util/format';

const AUTH_TYPES: Array<{ type: AuthType; label: string }> = [
  { type: 'token', label: 'Token' },
  { type: 'eks', label: 'AWS EKS' },
  { type: 'gke', label: 'Google GKE' },
  { type: 'aks', label: 'Azure AKS' },
  { type: 'oidc', label: 'OIDC' },
  { type: 'clientCert', label: 'Zertifikat' },
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
  const [gkeClientId, setGkeClientId] = useState(gkeAuth?.clientId ?? '');
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
      return 'Bitte eine gültige API-Server-URL angeben (https://…).';
    }
    if (authType === 'token' && !token.trim()) return 'Bitte ein Bearer-Token angeben.';
    if (authType === 'clientCert') {
      const hasPemPair = clientCertData.trim().length > 0 && clientKeyData.trim().length > 0;
      if (!hasPemPair && !clientP12.trim()) {
        return 'Für Zertifikats-Auth bitte Client-Zertifikat und Key angeben (PEM oder base64, wie in der Kubeconfig).';
      }
    }
    if (authType === 'eks' && (!eksRegion.trim() || !eksClusterName.trim() || !eksAccessKeyId.trim() || !eksSecretAccessKey.trim())) {
      return 'Für EKS werden Region, Cluster-Name, Access Key und Secret Key benötigt.';
    }
    if (authType === 'gke' && !oauthTokens) return 'Bitte zuerst mit Google anmelden.';
    if (authType === 'aks' && !oauthTokens) return 'Bitte zuerst mit Microsoft anmelden.';
    if (authType === 'oidc' && !oauthTokens) return 'Bitte zuerst beim OIDC-Provider anmelden.';
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
      Alert.alert('Verbindung erfolgreich', `Kubernetes ${version}`);
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
      <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
        {error ? <ErrorBox message={error} /> : null}

        <Field label="Name" value={name} onChangeText={setName} placeholder="Mein Cluster" />
        <Field
          label="API-Server-URL"
          value={server}
          onChangeText={setServer}
          placeholder="https://1.2.3.4:6443"
          keyboardType="url"
        />
        <Field
          label="Cluster-CA (PEM oder base64, optional)"
          value={caData}
          onChangeText={setCaData}
          placeholder="certificate-authority-data aus der Kubeconfig"
          multiline
        />
        <TouchableOpacity style={styles.toggleRow} onPress={() => setInsecure(!insecure)}>
          <View style={[styles.checkbox, insecure && styles.checkboxChecked]} />
          <Text style={styles.toggleLabel}>TLS-Verifizierung überspringen (unsicher)</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Authentifizierung</Text>
        <View style={styles.segmented}>
          {AUTH_TYPES.map((option) => (
            <TouchableOpacity
              key={option.type}
              style={[styles.segment, authType === option.type && styles.segmentActive]}
              onPress={() => {
                setAuthType(option.type);
                setOauthTokens(undefined);
                setError('');
              }}
            >
              <Text
                style={[styles.segmentText, authType === option.type && styles.segmentTextActive]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {authType === 'token' && (
          <Field
            label="Bearer-Token (z. B. ServiceAccount-Token)"
            value={token}
            onChangeText={setToken}
            placeholder="eyJhbGciOi…"
            multiline
          />
        )}

        {authType === 'eks' && (
          <>
            <Field label="AWS-Region" value={eksRegion} onChangeText={setEksRegion} placeholder="eu-central-1" />
            <Field label="EKS-Cluster-Name" value={eksClusterName} onChangeText={setEksClusterName} placeholder="my-cluster" />
            <Field label="Access Key ID" value={eksAccessKeyId} onChangeText={setEksAccessKeyId} placeholder="AKIA…" />
            <Field
              label="Secret Access Key"
              value={eksSecretAccessKey}
              onChangeText={setEksSecretAccessKey}
              secureTextEntry
            />
            <Field
              label="Session Token (optional, für temporäre Credentials)"
              value={eksSessionToken}
              onChangeText={setEksSessionToken}
              multiline
            />
          </>
        )}

        {authType === 'gke' && (
          <>
            <Field
              label="OAuth-Client-ID (iOS-Client aus der Google Cloud Console)"
              value={gkeClientId}
              onChangeText={setGkeClientId}
              placeholder="1234-abc.apps.googleusercontent.com"
            />
            <Button
              title={oauthTokens ? 'Mit Google verbunden – erneut anmelden' : 'Mit Google anmelden'}
              variant={oauthTokens ? 'secondary' : 'primary'}
              onPress={() => void handleOAuthSignIn()}
              disabled={!gkeClientId.trim()}
              busy={busy}
            />
          </>
        )}

        {authType === 'aks' && (
          <>
            <Field label="Entra-Tenant-ID" value={aksTenantId} onChangeText={setAksTenantId} placeholder="00000000-0000-…" />
            <Field
              label="App-Registrierung Client-ID"
              value={aksClientId}
              onChangeText={setAksClientId}
              placeholder="00000000-0000-…"
            />
            <Text style={styles.hint}>Redirect-URI für die App-Registrierung: {azureRedirect}</Text>
            <Button
              title={oauthTokens ? 'Mit Microsoft verbunden – erneut anmelden' : 'Mit Microsoft anmelden'}
              variant={oauthTokens ? 'secondary' : 'primary'}
              onPress={() => void handleOAuthSignIn()}
              disabled={!aksTenantId.trim() || !aksClientId.trim()}
              busy={busy}
            />
          </>
        )}

        {authType === 'oidc' && (
          <>
            <Field
              label="Issuer-URL"
              value={oidcIssuer}
              onChangeText={setOidcIssuer}
              placeholder="https://keycloak.example.com/realms/main"
              keyboardType="url"
            />
            <Field
              label="Client-ID"
              value={oidcClientId}
              onChangeText={setOidcClientId}
              placeholder="kubernetes"
            />
            <Field
              label="Client-Secret (nur für confidential clients)"
              value={oidcClientSecret}
              onChangeText={setOidcClientSecret}
              secureTextEntry
            />
            <Field
              label="Zusätzliche Scopes (optional, z. B. groups)"
              value={oidcExtraScopes}
              onChangeText={setOidcExtraScopes}
              placeholder="groups"
            />
            <Text style={styles.hint}>Redirect-URI für den OIDC-Client: {oidcRedirect}</Text>
            <Button
              title={oauthTokens ? 'Angemeldet – erneut anmelden' : 'Beim Provider anmelden'}
              variant={oauthTokens ? 'secondary' : 'primary'}
              onPress={() => void handleOAuthSignIn()}
              disabled={!oidcIssuer.trim() || !oidcClientId.trim()}
              busy={busy}
            />
            <Text style={styles.hint}>
              Der API-Server muss mit passenden --oidc-issuer-url/--oidc-client-id-Flags
              konfiguriert sein; Captain sendet das ID-Token als Bearer.
            </Text>
          </>
        )}

        {(authType === 'clientCert' || clientCertData.length > 0 || clientP12.length > 0) && (
          <>
            <Field
              label="Client-Zertifikat (PEM oder base64)"
              value={clientCertData}
              onChangeText={setClientCertData}
              placeholder="client-certificate-data aus der Kubeconfig"
              multiline
            />
            <Field
              label="Client-Key (PEM oder base64)"
              value={clientKeyData}
              onChangeText={setClientKeyData}
              placeholder="client-key-data aus der Kubeconfig"
              multiline
            />
            <Text style={styles.hint}>
              Alternativ kann statt Zertifikat + Key ein PKCS#12-Bundle hinterlegt werden:
            </Text>
            <Field
              label="PKCS#12 (base64, optional)"
              value={clientP12}
              onChangeText={setClientP12}
              placeholder="base64 von: openssl pkcs12 -export -in client.crt -inkey client.key"
              multiline
            />
            <Field
              label="PKCS#12-Passwort"
              value={clientP12Password}
              onChangeText={setClientP12Password}
              secureTextEntry
            />
          </>
        )}

        <View style={styles.actions}>
          <Button title="Verbindung testen" variant="secondary" onPress={() => void handleTest()} busy={busy} />
          <Button title="Speichern" onPress={() => void handleSave()} />
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
  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  segment: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  segmentActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  segmentText: { color: colors.textDim, fontSize: 13 },
  segmentTextActive: { color: colors.accentText, fontWeight: '600' },
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
