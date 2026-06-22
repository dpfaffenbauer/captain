# Captain ⎈

A Kubernetes client for iOS, built with React Native (Expo). Captain discovers
**all** of a cluster's resource types dynamically via the discovery API —
including CRDs — and can display, edit as YAML, and delete every resource.
Authentication is supported for the major cloud providers (AWS EKS,
Google GKE, Azure AKS) as well as bearer tokens and client certificates.

The UI follows the **"Captain v2 · Soft Bridge"** screen design (Claude design
handoff): dark indigo theme, cards with subtle gradients, squircle icons in the
iOS Settings style, health-ring dashboard, floating tab bar (Cluster · Browse ·
Events), and bottom sheets for cluster and namespace selection.

## Features

- **Multi-cluster**: any number of clusters, stored securely in the iOS Keychain
  (expo-secure-store).
- **All resource types**: dynamic discovery via `/api/v1` and `/apis/…`
  — Pods, Deployments, CRDs, everything the API server knows about.
- **Curated overview** (à la Lens): collapsible categories — Cluster
  (Nodes, Namespaces, Events), Workloads (Pods, Deployments, StatefulSets,
  DaemonSets, ReplicaSets, Jobs, CronJobs …), Config (Secrets, ConfigMaps,
  Quotas, HPA, PDB, Webhooks …), Network (Services, Ingresses,
  EndpointSlices, NetworkPolicies …), Storage (PVC, PV, StorageClasses),
  Access Control (ServiceAccounts, RBAC), plus **Custom Resources**
  automatically grouped by API group; everything else under "Other".
- **Read, edit, delete**: lists with namespace filter, pagination, and
  search; detail view as YAML; editing in the YAML editor with **diff preview**
  before saving and **server-side apply** (`fieldManager=captain`,
  `force=true`) — no more 409-conflict dance; deletion with confirmation.
- **Live lists (watch API)**: after the initial listing, a
  `?watch=true` stream keeps the list up to date — pods appear/disappear in
  real time, with an automatic re-list when the resourceVersion expires.
- **Live logs**: real `kubectl logs -f` streaming via the native module
  (chunked URLSession), including in-log search, multi-container, previous logs,
  and share/export. In Expo Go, follow falls back to polling.
- **Node actions**: cordon/uncordon as well as drain via the
  `policy/v1` eviction subresource — DaemonSet/mirror pods are left in place,
  PodDisruptionBudgets are respected (rejections show up in the result).
- **Helm releases**: releases are read directly from the
  `sh.helm.release.v1` secrets (no Helm CLI needed): list with status,
  per-release chart info, revision history, values, rendered manifest, and
  notes (the gzip payload is decoded on-device).
- **GitOps (Argo CD / Flux)**: if the CRDs are discovered, Browse shows a
  GitOps view with sync/health status of Applications, Kustomizations, and
  HelmReleases; "Sync"/"Reconcile" works purely through the API server
  (Argo: `.operation.sync`, Flux: `reconcile.fluxcd.io/requestedAt`).
- **Related resources**: the detail view links owners (ownerReferences)
  and children (Deployment → ReplicaSets/Pods, Service → Pods, Ingress →
  Services, PVC ↔ Volume/Pods, Pod → Node/PVCs) for easy navigation.
- **Favorites/pins**: any resource can be pinned in the detail view via the
  star; the home screen shows a "Pinned" section with all
  pinned objects **across all clusters** — one tap jumps straight
  to the resource, a long press removes the pin. Stored in the Keychain
  (expo-secure-store) so the pins survive an app restart.
- **Multi-cluster dashboard**: the home screen checks all clusters in parallel
  (node readiness, problem pods) and shows traffic-light status plus a short
  summary per cluster.
- **Home screen widget** (WidgetKit): small/medium widget with the
  health status of all clusters (traffic light per cluster, "x/y clusters healthy").
  On every health check the app writes a snapshot to the App Group
  (`group.at.pfaffenbauer.captain`) and triggers the widget reload; the
  widget therefore shows the state from the last app launch.
- **Background alerts** (optional): a BGTaskScheduler task checks the
  clusters periodically in the background, updates the widget, and reports
  degradations via local notification (deduplicated; iOS schedules the
  runs opportunistically — best effort, not a monitoring replacement).
- **Interactive terminal**: in addition to one-shot commands there is an
  interactive mode — a persistent `kubectl exec -it` session (PTY,
  stdin over the open WebSocket, ANSI sequences are filtered).
- **Live Activity** (iOS 16.2+): active port forwards appear as a
  Live Activity on the lock screen and in the Dynamic Island.
- **Siri / Shortcuts** (App Intents): "Check cluster health" lets Siri answer
  headlessly from the latest health snapshot; "Open Cluster" (iOS 18+)
  opens a cluster via deep link (`captain://open?cluster=<name>`).
- **iPad split view**: from 768 pt width the resource list shows the list on
  the left and an inspector (summary, events, YAML) for the selected
  object on the right; Browse and Home content is centered and width-limited.
- **Face ID app lock** (optional): hides the app contents on cold start and
  when returning from the background until Face ID/Touch ID or the device
  passcode has been confirmed.
- **Auth for cloud providers**:
  - **AWS EKS**: SigV4-presigned STS token (`k8s-aws-v1.…`), equivalent to
    `aws eks get-token` — entirely on-device, no CLI needed.
  - **Google GKE**: OAuth 2.0 (PKCE) with refresh token.
  - **Azure AKS**: Microsoft Entra ID OAuth 2.0 (PKCE) against the
    AKS AAD server app.
  - **Generic OIDC** (Keycloak, Dex, Authentik …): authorization code +
    PKCE against the issuer's discovery document; the ID token is sent as a
    bearer token and refreshed automatically.
  - **Bearer token**: e.g. ServiceAccount tokens.
  - **Client certificates (mTLS)**: PEM certificate + key straight from the
    kubeconfig (RSA and EC), natively via URLSession; alternatively PKCS#12.
- **Kubeconfig import**: paste YAML, pick contexts, done. Exec plugins
  (`aws`, `gke-gcloud-auth-plugin`, `kubelogin`) are detected and mapped to the
  matching native auth method.
- **Custom cluster CAs**: the native `KubeHttp` module validates the
  server certificates against the CA stored in the kubeconfig
  (`certificate-authority-data`) — necessary because EKS/GKE/AKS endpoints are
  signed by cluster-specific CAs.
- **Exec terminal**: one-shot commands via the `kubectl exec` WebSocket
  (`v4.channel.k8s.io`), natively with cluster-CA trust — including quick-command
  chips in the terminal UI.
- **Port forwarding**: a local TCP listener (Network.framework) bridges to
  the `portforward` WebSocket endpoint; active forwards appear in the
  Browse tab under Network and can be stopped individually.
- **Live metrics**: node and pod usage via the metrics-server API
  (`metrics.k8s.io`) — CPU/memory bars in the node list, CPU column in
  the pod list; without metrics-server this hides itself automatically.
- **Prometheus integration**: Captain finds Prometheus in the cluster
  automatically (well-known service names/labels) and queries it **through the
  API server proxy** — no extra network or auth configuration needed, the
  existing cluster connection (CA trust, token, mTLS) is enough. The dashboard
  shows CPU/memory trends for the last hour as sparklines as well as the
  currently **firing alerts** (sorted by severity, pod alerts open the resource
  directly). "View all" opens a dedicated alerts page with a severity filter;
  tapping an alert shows the description, duration, value, all labels, and
  a runbook link. Without a reachable Prometheus, all of this hides itself.
- **QR onboarding**: scan a kubeconfig as a QR code
  (`kubectl config view --minify --raw | qrencode -t png`).
- **Settings sheet**: default namespace, haptics toggle (real tap feedback
  on destructive actions), edit clusters.

## Project structure

```
app/                          Screens (expo-router)
  index.tsx                   Cluster overview
  cluster-form.tsx            Create/edit clusters incl. cloud auth
  kubeconfig-import.tsx       Kubeconfig import
  cluster/[id]/index.tsx      Resource types (discovery, grouped, search)
  cluster/[id]/list.tsx       Resource list (namespace, pagination, search)
  cluster/[id]/item.tsx       YAML detail, editor, delete
  cluster/[id]/helm.tsx       Helm releases (list + detail in helm-release.tsx)
  cluster/[id]/gitops.tsx     Argo CD / Flux sync status
src/
  auth/                       EKS SigV4, Google/Azure OAuth, generic OIDC,
                              token cache
  kube/                       Transport, discovery, CRUD, kubeconfig parser,
                              stream.ts (log follow), watch.ts (live lists),
                              helm.ts, gitops.ts, related.ts, health.ts,
                              metrics-server + Prometheus (prometheus.ts)
  state/, storage/, ui/, util/
modules/kube-http/            Native iOS module (Swift): TLS with custom CA,
                              insecure-skip-verify, mTLS via PEM or PKCS#12
```

## Setup

Prerequisites: macOS with Xcode 16+, Node 20+, CocoaPods.

```sh
npm install
npx expo run:ios          # creates the iOS build incl. the native KubeHttp module
```

> **Important:** custom cluster CAs and client certificates require a
> development build (`npx expo run:ios`). In **Expo Go**, Captain falls back to
> `fetch()` — that only works with API servers using a publicly trusted
> certificate.

For a device instead of the simulator: set a signing team in Xcode or run
`npx expo run:ios --device`.

> **Widget:** the widget extension (`targets/widget`) is generated as its own
> target during prebuild by `@bacons/apple-targets`. For a device, the
> extension needs a signing team — either set it in Xcode or pass it to the
> plugin in `app.json`: `["@bacons/apple-targets", { "appleTeamId": "ABCDE12345" }]`.
> App and widget share the App Group `group.at.pfaffenbauer.captain`.

## Setting up authentication

### Bearer token (any cluster)

```sh
kubectl create serviceaccount captain -n kube-system
kubectl create clusterrolebinding captain --clusterrole=cluster-admin --serviceaccount=kube-system:captain
kubectl create token captain -n kube-system --duration=8760h
```

Paste the token into the form. Copy the CA from the kubeconfig
(`certificate-authority-data`) into the CA field.

### AWS EKS

1. IAM user/role with access to the cluster (access entries or the
   `aws-auth` ConfigMap).
2. In the form: region, EKS cluster name, access key ID, secret access key
   (optionally a session token for temporary STS credentials).
3. Server URL and CA from `aws eks describe-cluster --name <cluster>`
   (`cluster.endpoint`, `cluster.certificateAuthority.data`).

Captain generates the token on-device via SigV4 (presigned
`sts:GetCallerIdentity` with the `x-k8s-aws-id` header) and refreshes it
automatically.

### Google GKE

1. In the Google Cloud Console, create an **OAuth client of type iOS**
   (bundle ID: `at.pfaffenbauer.captain`).
2. Enter the client ID in the form and tap "Sign in with Google".
3. The Google account needs e.g. `roles/container.developer`.
4. Server URL and CA: `gcloud container clusters describe <cluster>`
   (`endpoint`, `masterAuth.clusterCaCertificate`).

Scope: `cloud-platform`; refresh tokens are stored and renewed
automatically.

### Azure AKS

Prerequisite: AKS cluster with Entra ID integration (managed AAD).

1. Create an app registration in Entra ID (type "Public client/native"),
   redirect URI: `captain://oauth`.
2. Grant the app registration the API permission **Azure Kubernetes Service AAD
   Server** (`6dae42f8-4368-4678-94ff-3960e28e3630/user.read`).
3. Enter the tenant ID and client ID in the form, tap "Sign in with Microsoft".
4. The user needs appropriate Kubernetes RBAC / Azure RBAC roles
   (e.g. "Azure Kubernetes Service RBAC Reader/Writer").

### Generic OIDC (Keycloak, Dex, Authentik …)

Prerequisite: API server with OIDC flags (`--oidc-issuer-url`,
`--oidc-client-id`, optionally `--oidc-username-claim`/`--oidc-groups-claim`).

1. Create a **public client** with redirect URI `captain://oauth` at the
   provider (PKCE; a client secret is only needed for confidential clients).
2. Enter the issuer URL and client ID in the form, optionally additional
   scopes (e.g. `groups`), then tap "Sign in with provider".
3. Captain sends the **ID token** as a bearer token and renews it via the
   refresh token.

### Client certificates (mTLS)

Paste `client-certificate-data` and `client-key-data` from the kubeconfig
directly into the form fields (base64 or PEM) — the kubeconfig import
picks up both automatically. RSA and EC keys are supported
(PKCS#1, SEC1, unencrypted PKCS#8).

Alternatively, a PKCS#12 bundle can still be provided:

```sh
openssl pkcs12 -export -in client.crt -inkey client.key -out client.p12 -password pass:captain
base64 -i client.p12 | pbcopy
```

## Security

- All credentials live exclusively in the device's iOS Keychain.
- TLS validation against the cluster CA via a native URLSession delegate;
  "skip TLS" is possible but marked as insecure.
- There is no backend — the app talks directly to the API server.

## Known limitations

- Kubeconfig `exec` plugins cannot be executed (no subprocess on
  iOS); the import maps them to the native auth methods (`aws`,
  `gke-gcloud-auth-plugin`, `kubelogin`, `oidc-login` → OIDC) and flags
  missing fields.
- The interactive terminal is a simple PTY without full
  ANSI emulation (no vim/top); escape sequences are stripped.
- Helm and GitOps views are read-only (plus sync triggers); upgrading/
  rolling back/uninstalling releases is left to the CLI.
- In Expo Go (without the native module) there is no log streaming and no
  live lists; follow falls back to polling.
