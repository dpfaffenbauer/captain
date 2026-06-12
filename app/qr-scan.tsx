import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { parseKubeconfig } from '../src/kube/kubeconfig';
import { useClusters } from '../src/state/ClustersContext';
import { Button, EmptyState } from '../src/ui/components';
import { colors, spacing } from '../src/ui/theme';

export default function QrScanScreen() {
  const router = useRouter();
  const { addOrUpdate } = useClusters();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState('');
  const handled = useRef(false);

  const handleScan = async (data: string) => {
    if (handled.current) return;
    handled.current = true;
    try {
      const contexts = parseKubeconfig(data);
      for (const entry of contexts) {
        await addOrUpdate(entry.cluster);
      }
      const warnings = contexts.flatMap((entry) => entry.warnings);
      Alert.alert(
        'Kubeconfig importiert',
        `${contexts.length} ${contexts.length === 1 ? 'Kontext' : 'Kontexte'} übernommen.` +
          (warnings.length > 0 ? `\n\n⚠ ${warnings[0]}` : ''),
        [{ text: 'OK', onPress: () => router.back() }]
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `QR-Code enthält keine gültige Kubeconfig: ${caught.message}`
          : String(caught)
      );
      // Allow another attempt after a short pause.
      setTimeout(() => {
        handled.current = false;
      }, 1500);
    }
  };

  if (!permission) return <EmptyState message="Kamera wird vorbereitet…" />;

  if (!permission.granted) {
    return (
      <View style={styles.permissionWrap}>
        <Text style={styles.permissionText}>
          Captain braucht Kamerazugriff, um Kubeconfig-QR-Codes zu scannen.
        </Text>
        <Button title="Kamera erlauben" onPress={() => void requestPermission()} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill as any}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => void handleScan(data)}
      />
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame} />
        <Text style={styles.hint}>
          Kubeconfig als QR-Code scannen{'\n'}
          <Text style={styles.hintSmall}>z. B.: kubectl config view --minify --raw | qrencode -t png</Text>
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: spacing.xl,
  },
  frame: {
    width: 240,
    height: 240,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  hint: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 22 },
  hintSmall: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '400', fontFamily: 'Menlo' },
  error: {
    color: '#fff',
    backgroundColor: 'rgba(251,113,133,0.85)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 12.5,
    textAlign: 'center',
  },
  permissionWrap: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: spacing.xl,
  },
  permissionText: { color: colors.textMid, fontSize: 14, textAlign: 'center', lineHeight: 21 },
});
