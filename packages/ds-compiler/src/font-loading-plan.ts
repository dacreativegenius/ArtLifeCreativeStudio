export const GOOGLE_CSS2_REQUEST_MAX_BYTES = 1_800;
const GOOGLE_CSS2_BASE_URL = 'https://fonts.googleapis.com/css2';

type LoadingStyle = 'normal' | 'italic';
type LoadingFace = { weight: number; style: LoadingStyle };

export interface FontLoadingPlan {
  href: string;
  families: Array<{ cssFamilyName: string; faces: LoadingFace[] }>;
}

function encodeFamilyName(value: string): string {
  return encodeURIComponent(value.normalize('NFC'))
    .replace(/%20/g, '+')
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}

function serializeFamily(cssFamilyName: string, faces: LoadingFace[]): string {
  const family = encodeFamilyName(cssFamilyName);
  if (faces.length === 0) return family;
  const normalWeights = faces.filter((face) => face.style === 'normal').map((face) => face.weight);
  const italicWeights = faces.filter((face) => face.style === 'italic').map((face) => face.weight);
  if (italicWeights.length === 0) {
    return `${family}:wght@${normalWeights.join(';')}`;
  }
  const tuples = [
    ...normalWeights.map((weight) => `0,${weight}`),
    ...italicWeights.map((weight) => `1,${weight}`),
  ];
  return `${family}:ital,wght@${tuples.join(';')}`;
}

/** Serialize already canonical family rows into one Google CSS2 request. */
export function serializeGoogleCss2Request(
  families: ReadonlyArray<{ cssFamilyName: string; faces: LoadingFace[] }>,
): string {
  const query = families
    .map((family) => `family=${serializeFamily(family.cssFamilyName, family.faces)}`)
    .join('&');
  return `${GOOGLE_CSS2_BASE_URL}?${query}${query ? '&' : ''}display=swap`;
}
