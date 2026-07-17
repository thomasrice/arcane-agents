const escapeChar = String.fromCharCode(0x1b);
const bellChar = String.fromCharCode(0x07);

export function stripTerminalControlSequences(line: string): string {
  let normalized = "";

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index] ?? "";
    const next = line[index + 1] ?? "";

    if (current === escapeChar && next === "]") {
      index += 2;
      while (index < line.length) {
        const cursor = line[index] ?? "";
        const following = line[index + 1] ?? "";
        if (cursor === bellChar) {
          break;
        }
        if (cursor === escapeChar && following === "\\") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (current === escapeChar && next === "[") {
      index += 2;
      while (index < line.length) {
        const code = line.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) {
          break;
        }
        index += 1;
      }
      continue;
    }

    const code = current.charCodeAt(0);
    if ((code >= 0x00 && code <= 0x08) || (code >= 0x0b && code <= 0x1a) || (code >= 0x1c && code <= 0x1f) || code === 0x7f) {
      continue;
    }

    normalized += current;
  }

  return normalized;
}

export function findLastMatchingIndex(lines: string[], predicate: (line: string) => boolean): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (predicate(lines[index] ?? "")) {
      return index;
    }
  }

  return -1;
}

export function truncateWithEllipsis(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return text.slice(0, Math.max(0, maxLength));
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}
