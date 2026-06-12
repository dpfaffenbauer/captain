# Captain ⎈

Ein Kubernetes-Client für iOS, gebaut mit React Native (Expo). Captain entdeckt
**alle** Ressourcen-Typen eines Clusters dynamisch über die Discovery-API —
inklusive CRDs — und kann jede Ressource anzeigen, als YAML bearbeiten und
löschen. Authentifizierung wird für die großen Cloud-Anbieter (AWS EKS,
Google GKE, Azure AKS) sowie für Bearer-Tokens und Client-Zertifikate
unterstützt.

Das UI folgt dem Screendesign **„Captain v2 · Soft Bridge"** (Claude-Design-
Handoff): dunkles Indigo-Theme, Karten mit sanftem Verlauf, Squircle-Icons im
iOS-Settings-Stil, Health-Ring-Dashboard, Floating-Tab-Bar (Cluster · Browse ·
Events) und Bottom-Sheets für Cluster- und Namespace-Wahl.

## Features

- **Multi-Cluster**: beliebig viele Cluster, sicher gespeichert im iOS-Keychain
  (expo-secure-store).
- **Alle Ressourcen-Typen**: dynamische Discovery über `/api/v1` und `/apis/…`
  — Pods, Deployments, CRDs, alles was der API-Server kennt.
- **Kuratierte Übersicht** (à la Lens): auf-/zuklappbare Kategorien — Cluster
  (Nodes, Namespaces, Events), Workloads (Pods, Deployments, StatefulSets,
  DaemonSets, ReplicaSets, Jobs, CronJobs …), Config (Secrets, ConfigMaps,
  Quotas, HPA, PDB, Webhooks …), Netzwerk (Services, Ingresses,
  EndpointSlices, NetworkPolicies …), Storage (PVC, PV, StorageClasses),
  Zugriffskontrolle (ServiceAccounts, RBAC) sowie **Custom Resources**
  automatisch gruppiert nach API-Gruppe; alles Übrige unter „Sonstiges".
- **Lesen, Bearbeiten, Löschen**: Listen mit Namespace-Filter, Pagination und
  Suche; Detailansicht als YAML; Bearbeiten im YAML-Editor mit **Diff-Vorschau**
  vor dem Speichern und **Server-Side Apply** (`fieldManager=captain`,
  `force=true`) — kein 409-Konflikt-Tanz mehr; Löschen mit Bestätigung.
- **Live-Listen (Watch-API)**: Nach dem initialen Listing hält ein
  `?watch=true`-Stream die Liste aktuell — Pods erscheinen/verschwinden in
  Echtzeit, mit automatischem Re-List bei abgelaufener resourceVersion.
- **Live-Logs**: echtes `kubectl logs -f`-Streaming über das native Modul
  (chunked URLSession), inkl. Suche im Log, Multi-Container, Previous-Logs
  und Teilen/Export. In Expo Go fällt Follow auf Polling zurück.
- **Node-Aktionen**: Cordon/Uncordon sowie Drain über die
  `policy/v1`-Eviction-Subresource — DaemonSet-/Mirror-Pods bleiben stehen,
  PodDisruptionBudgets werden respektiert (Ablehnungen erscheinen im Ergebnis).
- **Helm-Releases**: Releases werden direkt aus den
  `sh.helm.release.v1`-Secrets gelesen (kein Helm-CLI nötig): Liste mit Status,
  pro Release Chart-Infos, Revision-History, Values, gerendertes Manifest und
  Notes (gzip-Payload wird on-device dekodiert).
- **GitOps (Argo CD / Flux)**: Werden die CRDs entdeckt, zeigt Browse eine
  GitOps-Ansicht mit Sync-/Health-Status von Applications, Kustomizations und
  HelmReleases; „Sync"/„Reconcile" funktioniert rein über den API-Server
  (Argo: `.operation.sync`, Flux: `reconcile.fluxcd.io/requestedAt`).
- **Related Resources**: Die Detailansicht verlinkt Owner (ownerReferences)
  und Kinder (Deployment → ReplicaSets/Pods, Service → Pods, Ingress →
  Services, PVC ↔ Volume/Pods, Pod → Node/PVCs) zum Durchnavigieren.
- **Multi-Cluster-Dashboard**: Der Home-Screen prüft alle Cluster parallel
  (Node-Readiness, Problem-Pods) und zeigt Ampel-Status plus Kurzzusammen-
  fassung pro Cluster.
- **Home-Screen-Widget** (WidgetKit): Small/Medium-Widget mit dem
  Health-Status aller Cluster (Ampel pro Cluster, „x/y clusters healthy").
  Die App schreibt bei jedem Health-Check einen Snapshot in die App Group
  (`group.at.pfaffenbauer.captain`) und stößt den Widget-Reload an; das
  Widget zeigt also den Stand des letzten App-Starts.
- **Face-ID-App-Lock** (optional): verbirgt die App-Inhalte bei Kaltstart und
  Rückkehr aus dem Hintergrund, bis Face ID/Touch ID bzw. der Geräte-Code
  bestätigt wurde.
- **Auth für Cloud-Anbieter**:
  - **AWS EKS**: SigV4-presigned STS-Token (`k8s-aws-v1.…`), äquivalent zu
    `aws eks get-token` — komplett on-device, keine CLI nötig.
  - **Google GKE**: OAuth 2.0 (PKCE) mit Refresh-Token.
  - **Azure AKS**: Microsoft Entra ID OAuth 2.0 (PKCE) gegen die
    AKS-AAD-Server-App.
  - **Generisches OIDC** (Keycloak, Dex, Authentik …): Authorization Code +
    PKCE gegen das Discovery-Dokument des Issuers; das ID-Token wird als
    Bearer gesendet und automatisch erneuert.
  - **Bearer-Token**: z. B. ServiceAccount-Tokens.
  - **Client-Zertifikate (mTLS)**: PEM-Zertifikat + Key direkt aus der
    Kubeconfig (RSA und EC), nativ über URLSession; alternativ PKCS#12.
- **Kubeconfig-Import**: YAML einfügen, Kontexte auswählen, fertig. Exec-Plugins
  (`aws`, `gke-gcloud-auth-plugin`, `kubelogin`) werden erkannt und auf die
  passende native Auth-Methode gemappt.
- **Eigene Cluster-CAs**: Das native Modul `KubeHttp` validiert die
  Server-Zertifikate gegen die in der Kubeconfig hinterlegte CA
  (`certificate-authority-data`) — nötig, weil EKS/GKE/AKS-Endpunkte von
  cluster-eigenen CAs signiert sind.
- **Exec-Terminal**: One-Shot-Kommandos via `kubectl exec`-WebSocket
  (`v4.channel.k8s.io`), nativ mit Cluster-CA-Trust — inkl. Quick-Command-
  Chips im Terminal-UI.
- **Port-Forwarding**: lokaler TCP-Listener (Network.framework) bridgt auf
  den `portforward`-WebSocket-Endpunkt; aktive Forwards erscheinen im
  Browse-Tab unter Network und sind einzeln stoppbar.
- **Live-Metriken**: Node- und Pod-Usage über die metrics-server-API
  (`metrics.k8s.io`) — CPU/Memory-Balken in der Node-Liste, CPU-Spalte in
  der Pod-Liste; ohne metrics-server blendet sich das automatisch aus.
- **Prometheus-Integration**: Captain findet Prometheus im Cluster automatisch
  (bekannte Service-Namen/Labels) und fragt es **über den API-Server-Proxy** ab
  — keine zusätzliche Netzwerk- oder Auth-Konfiguration nötig, die bestehende
  Cluster-Verbindung (CA-Trust, Token, mTLS) reicht. Im Dashboard erscheinen
  CPU-/Memory-Verläufe der letzten Stunde als Sparklines sowie die aktuell
  **feuernden Alerts** (nach Schweregrad sortiert, Pod-Alerts öffnen direkt die
  Ressource). Ohne erreichbares Prometheus blendet sich alles automatisch aus.
- **QR-Onboarding**: Kubeconfig als QR-Code scannen
  (`kubectl config view --minify --raw | qrencode -t png`).
- **Settings-Sheet**: Default-Namespace, Haptics-Toggle (echtes Tap-Feedback
  bei destruktiven Aktionen), Cluster bearbeiten, Sign-out aus allen Clustern.

## Projektstruktur

```
app/                          Screens (expo-router)
  index.tsx                   Cluster-Übersicht
  cluster-form.tsx            Cluster anlegen/bearbeiten inkl. Cloud-Auth
  kubeconfig-import.tsx       Kubeconfig-Import
  cluster/[id]/index.tsx      Ressourcen-Typen (Discovery, gruppiert, Suche)
  cluster/[id]/list.tsx       Ressourcen-Liste (Namespace, Pagination, Suche)
  cluster/[id]/item.tsx       YAML-Detail, Editor, Löschen
  cluster/[id]/helm.tsx       Helm-Releases (Liste + Detail in helm-release.tsx)
  cluster/[id]/gitops.tsx     Argo-CD-/Flux-Sync-Status
src/
  auth/                       EKS-SigV4, Google/Azure-OAuth, generisches OIDC,
                              Token-Cache
  kube/                       Transport, Discovery, CRUD, Kubeconfig-Parser,
                              stream.ts (Log-Follow), watch.ts (Live-Listen),
                              helm.ts, gitops.ts, related.ts, health.ts,
                              metrics-server + Prometheus (prometheus.ts)
  state/, storage/, ui/, util/
modules/kube-http/            Natives iOS-Modul (Swift): TLS mit eigener CA,
                              insecure-skip-verify, mTLS via PEM oder PKCS#12
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

> **Widget:** Die Widget-Extension (`targets/widget`) wird beim Prebuild von
> `@bacons/apple-targets` als eigenes Target erzeugt. Fürs Gerät braucht die
> Extension ein Signing-Team — entweder in Xcode setzen oder in `app.json`
> dem Plugin mitgeben: `["@bacons/apple-targets", { "appleTeamId": "ABCDE12345" }]`.
> App und Widget teilen sich die App Group `group.at.pfaffenbauer.captain`.

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
   (Bundle-ID: `at.pfaffenbauer.captain`).
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

### Generisches OIDC (Keycloak, Dex, Authentik …)

Voraussetzung: API-Server mit OIDC-Flags (`--oidc-issuer-url`,
`--oidc-client-id`, ggf. `--oidc-username-claim`/`--oidc-groups-claim`).

1. Beim Provider einen **public client** mit Redirect-URI `captain://oauth`
   anlegen (PKCE; ein Client-Secret ist nur für confidential clients nötig).
2. Im Formular Issuer-URL und Client-ID eintragen, optional zusätzliche
   Scopes (z. B. `groups`), dann „Beim Provider anmelden".
3. Captain sendet das **ID-Token** als Bearer und erneuert es über das
   Refresh-Token.

### Client-Zertifikate (mTLS)

`client-certificate-data` und `client-key-data` aus der Kubeconfig direkt in
die Formularfelder einfügen (base64 oder PEM) — der Kubeconfig-Import
übernimmt beides automatisch. Unterstützt werden RSA- und EC-Keys
(PKCS#1, SEC1, unverschlüsseltes PKCS#8).

Alternativ kann weiterhin ein PKCS#12-Bundle hinterlegt werden:

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
  iOS); der Import mappt sie auf die nativen Auth-Methoden (`aws`,
  `gke-gcloud-auth-plugin`, `kubelogin`, `oidc-login` → OIDC) und markiert
  fehlende Felder.
- Exec führt One-Shot-Kommandos aus (`/bin/sh -c …`), kein interaktives TTY.
- Helm- und GitOps-Ansichten sind lesend (plus Sync-Trigger); Upgrade/
  Rollback/Uninstall von Releases bleibt dem CLI überlassen.
- In Expo Go (ohne natives Modul) gibt es kein Log-Streaming und keine
  Live-Listen; Follow fällt auf Polling zurück.
