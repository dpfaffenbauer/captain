import { colors } from './theme';

/** Maps a Helm release/revision status to a tone color. */
export function helmStatusColor(status: string): string {
  if (status === 'deployed') return colors.success;
  if (status === 'failed' || status === 'unknown') return colors.danger;
  return colors.warning;
}
