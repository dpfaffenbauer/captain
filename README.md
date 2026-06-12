# Captain ⎈

Ein Kubernetes-Client für iOS, gebaut mit React Native (Expo). Captain entdeckt
**alle** Ressourcen-Typen eines Clusters dynamisch über die Discovery-API —
inklusive CRDs — und kann jede Ressource anzeigen, als YAML bearbeiten und
löschen. Authentifizierung wird für die großen Cloud-Anbieter (AWS EKS,
Google GKE, Azure AKS) sowie für Bearer-Tokens und Client-Zertifikate
unterstützt.

## Features

- **Multi-Cluster**: beliebig viele Cluster, sicher gespeichert im iOS-Keychain
  (expo-secure-store).
- **Alle Ressourcen-Typen**: dynamische Discovery über `/api/v1` und `/apis/…`
  — Pods, Deployments, CRDs, alles was der API-Server kennt.
- **Lesen, Bearbeiten, Löschen**: Listen mit Namespace-Filter, Pagination und
  Suche; Detailansicht als YAML; Bearbeiten im YAML-Editor (PUT/replace);
  Löschen mit Bestätigung.
- **Auth für Cloud-Anbieter**:
  - **AWS EKS**: SigV4-presigned STS-Token (`k8s-aws-v1.…`), äquivalent zu
    `aws eks get-token` — komplett on-device, keine CLI nötig.
  - **Google GKE**: OAuth 2.0 (PKCE) mit Refresh-Token.
  - **Azure AKS**: Microsoft Entra ID OAuth 2.0 (PKCE) gegen die
    AKS-AAD-Server-App.
  - **Bearer-Token**: z. B. ServiceAccount-Tokens.
  - **Client-Zertifikate (mTLS)**: PKCS#12, nativ über URLSession.
- **Kubeconfig-Import**: YAML einfügen, Kontexte auswählen, fertig. Exec-Plugins
  (`aws`, `gke-gcloud-auth-plugin`, `kubelogin`) werden erkannt und auf die
  passende native Auth-Methode gemappt.
- **Eigene Cluster-CAs**: Das native Modul `KubeHttp` validiert die
  Server-Zertifikate gegen die in der Kubeconfig hinterlegte CA
  (`certificate-authority-data`) — nötig, weil EKS/GKE/AKS-Endpunkte von
  cluster-eigenen CAs signiert sind.

## Projektstruktur

```
app/                          Screens (expo-router)
  index.tsx                   Cluster-Übersicht
  cluster-form.tsx            Cluster anlegen/bearbeiten inkl. Cloud-Auth
  kubeconfig-import.tsx       Kubeconfig-Import
  cluster/[id]/index.tsx      Ressourcen-Typen (Discovery, gruppiert, Suche)
  cluster/[id]/list.tsx       Ressourcen-Liste (Namespace, Pagination, Suche)
  cluster/[id]/item.tsx       YAML-Detail, Editor, Löschen
src/
  auth/                       EKS-SigV4, Google/Azure-OAuth, Token-Cache
  kube/                       Transport, Discovery, CRUD, Kubeconfig-Parser
  state/, storage/, ui/, util/
modules/kube-http/            Natives iOS-Modul (Swift): TLS mit eigener CA,
                              insecure-skip-verify, mTLS via PKCS#12
```

## Setup

Voraussetzungen: macOS mit Xcode 16+, Node 20+, CocoaPods.

```sh
npm install
npx expo run:ios          # erstellt den iOS-Build inkl. nativem KubeHttp-Modul
```

> **Wichtig:** Für eigene Cluster-CAs und Client-Zertifikate ist ein
> Development-Build nötig (`npx expo run:ios`). In **Expo Go** fällt Captain auf
> `fetch()` zurück — das funktioniert nur bei API-Servern mit öffentlich
> vertrauenswürdigem Zertifikat.

Für ein Gerät statt Simulator: in Xcode Signing-Team setzen oder
`npx expo run:ios --device`.

## Authentifizierung einrichten

### Bearer-Token (jeder Cluster)

```sh
kubectl create serviceaccount captain -n kube-system
kubectl create clusterrolebinding captain --clusterrole=cluster-admin --serviceaccount=kube-system:captain
kubectl create token captain -n kube-system --duration=8760h
```

Token im Formular einfügen. CA aus der Kubeconfig
(`certificate-authority-data`) ins CA-Feld kopieren.

### AWS EKS

1. IAM-User/Role mit Zugriff auf den Cluster (Access Entries oder
   `aws-auth`-ConfigMap).
2. Im Formular: Region, EKS-Cluster-Name, Access Key ID, Secret Access Key
   (optional Session Token für temporäre STS-Credentials).
3. Server-URL und CA aus `aws eks describe-cluster --name <cluster>`
   (`cluster.endpoint`, `cluster.certificateAuthority.data`).

Captain erzeugt das Token on-device per SigV4 (presigned
`sts:GetCallerIdentity` mit `x-k8s-aws-id`-Header) und erneuert es automatisch.

### Google GKE

1. In der Google Cloud Console einen **OAuth-Client vom Typ iOS** anlegen
   (Bundle-ID: `gmbh.cors.captain`).
2. Client-ID im Formular eintragen und „Mit Google anmelden".
3. Der Google-Account braucht z. B. `roles/container.developer`.
4. Server-URL und CA: `gcloud container clusters describe <cluster>`
   (`endpoint`, `masterAuth.clusterCaCertificate`).

Scope: `cloud-platform`; Refresh-Tokens werden gespeichert und automatisch
erneuert.

### Azure AKS

Voraussetzung: AKS-Cluster mit Entra-ID-Integration (managed AAD).

1. App-Registrierung in Entra ID anlegen (Typ „Public client/native"),
   Redirect-URI: `captain://oauth`.
2. Der App-Registrierung die API-Berechtigung **Azure Kubernetes Service AAD
   Server** (`6dae42f8-4368-4678-94ff-3960e28e3630/user.read`) gewähren.
3. Im Formular Tenant-ID und Client-ID eintragen, „Mit Microsoft anmelden".
4. Der Benutzer braucht passende Kubernetes-RBAC-/Azure-RBAC-Rollen
   (z. B. „Azure Kubernetes Service RBAC Reader/Writer").

### Client-Zertifikate (mTLS)

Kubeconfig-PEMs in PKCS#12 konvertieren und base64-kodiert einfügen:

```sh
openssl pkcs12 -export -in client.crt -inkey client.key -out client.p12 -password pass:captain
base64 -i client.p12 | pbcopy
```

## Sicherheit

- Alle Zugangsdaten liegen ausschließlich im iOS-Keychain des Geräts.
- TLS-Validierung gegen die Cluster-CA per nativem URLSession-Delegate;
  „TLS überspringen" ist möglich, aber als unsicher markiert.
- Es gibt kein Backend — die App spricht direkt mit dem API-Server.

## Bekannte Grenzen

- Kubeconfig-`exec`-Plugins können nicht ausgeführt werden (kein Subprozess auf
  iOS); der Import mappt sie auf die nativen Auth-Methoden und markiert
  fehlende Felder.
- Pod-Logs, `exec` und Watch-Streams sind noch nicht implementiert.
- Bearbeiten nutzt PUT (replace); bei Konflikten (HTTP 409) neu laden und
  erneut speichern.
