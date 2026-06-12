export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

/**
 * Line-based diff for the YAML editor's save preview. Common prefix/suffix are
 * trimmed first (edits are usually local), the middle is aligned via LCS. For
 * pathologically large middles the diff degrades to remove-all/add-all rather
 * than blowing up memory on-device.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const result: DiffLine[] = [];
  for (let i = 0; i < start; i++) result.push({ type: 'same', text: a[i] });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (midA.length * midB.length > 250_000) {
    for (const text of midA) result.push({ type: 'del', text });
    for (const text of midB) result.push({ type: 'add', text });
  } else {
    result.push(...lcsDiff(midA, midB));
  }

  for (let i = endA; i < a.length; i++) result.push({ type: 'same', text: a[i] });
  return result;
}

function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      result.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      result.push({ type: 'del', text: a[i] });
      i++;
    } else {
      result.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < a.length) result.push({ type: 'del', text: a[i++] });
  while (j < b.length) result.push({ type: 'add', text: b[j++] });
  return result;
}
