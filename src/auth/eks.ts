import CryptoJS from 'crypto-js';
import { base64UrlEncode } from '../util/base64';

export interface EksTokenOptions {
  region: string;
  clusterName: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * AWS SigV4 query-string escaping: encodeURIComponent plus the characters
 * RFC 3986 reserves but JavaScript leaves alone.
 */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function hmac(message: string, key: CryptoJS.lib.WordArray | string): CryptoJS.lib.WordArray {
  return CryptoJS.HmacSHA256(message, key);
}

function sha256Hex(message: string): string {
  return CryptoJS.SHA256(message).toString(CryptoJS.enc.Hex);
}

/**
 * Generates an EKS bearer token: a presigned STS GetCallerIdentity URL with
 * the x-k8s-aws-id header bound to the cluster name, encoded as
 * "k8s-aws-v1." + base64url(url). Equivalent to `aws eks get-token`.
 */
export function generateEksToken(options: EksTokenOptions): string {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 'sts';
  const host = `sts.${options.region}.amazonaws.com`;
  const signedHeaders = 'host;x-k8s-aws-id';
  const credentialScope = `${dateStamp}/${options.region}/${service}/aws4_request`;

  const params: Array<[string, string]> = [
    ['Action', 'GetCallerIdentity'],
    ['Version', '2011-06-15'],
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${options.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', '60'],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  if (options.sessionToken) {
    params.push(['X-Amz-Security-Token', options.sessionToken]);
  }
  params.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const canonicalQuery = params.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&');

  const canonicalRequest = [
    'GET',
    '/',
    canonicalQuery,
    `host:${host}\nx-k8s-aws-id:${options.clusterName}\n`,
    signedHeaders,
    sha256Hex(''),
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(dateStamp, `AWS4${options.secretAccessKey}`);
  const kRegion = hmac(options.region, kDate);
  const kService = hmac(service, kRegion);
  const kSigning = hmac('aws4_request', kService);
  const signature = hmac(stringToSign, kSigning).toString(CryptoJS.enc.Hex);

  const url = `https://${host}/?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return `k8s-aws-v1.${base64UrlEncode(url)}`;
}
