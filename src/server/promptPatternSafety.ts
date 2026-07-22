const backreferencePattern = /\\(?:[1-9]|k<)/;
const lookaroundPattern = /\(\?(?:[=!]|<[=!])/;
const maxSafeAmbiguousRepeat = 16;

/** Rejects prompt regex constructs that can monopolise the status-poll event loop. */
export function promptPatternSafetyError(pattern: string): string | undefined {
  if (backreferencePattern.test(pattern)) {
    return "backreferences are not allowed";
  }
  if (lookaroundPattern.test(pattern)) {
    return "lookaround assertions are not allowed";
  }

  const groups: GroupRisk[] = [emptyRisk()];
  let wildcardRepeats = 0;

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      const quantifier = readQuantifier(pattern, index + 2);
      if (quantifier?.highCardinality) {
        currentRisk(groups).hasHighCardinalityRepeat = true;
      }
      index += 1;
      continue;
    }
    if (character === "[") {
      index = skipCharacterClass(pattern, index);
      const quantifier = readQuantifier(pattern, index + 1);
      if (quantifier?.highCardinality) {
        currentRisk(groups).hasHighCardinalityRepeat = true;
      }
      continue;
    }
    if (character === "(") {
      groups.push(emptyRisk());
      continue;
    }
    if (character === "|") {
      currentRisk(groups).hasAlternation = true;
      continue;
    }
    if (character === ".") {
      const quantifier = readQuantifier(pattern, index + 1);
      if (quantifier?.highCardinality) {
        currentRisk(groups).hasHighCardinalityRepeat = true;
        wildcardRepeats += 1;
      }
      continue;
    }
    if (character !== ")" || groups.length === 1) {
      const quantifier = readQuantifier(pattern, index + 1);
      if (quantifier?.highCardinality) {
        currentRisk(groups).hasHighCardinalityRepeat = true;
      }
      continue;
    }

    const group = groups.pop() ?? emptyRisk();
    const parent = currentRisk(groups);
    const outerQuantifier = readQuantifier(pattern, index + 1);
    if (outerQuantifier?.highCardinality && (group.hasHighCardinalityRepeat || group.hasAlternation)) {
      return "nested or ambiguous high-cardinality repetition is not allowed";
    }
    parent.hasHighCardinalityRepeat ||=
      group.hasHighCardinalityRepeat || Boolean(outerQuantifier?.highCardinality);
    parent.hasAlternation ||= group.hasAlternation;
  }

  if (wildcardRepeats > 1) {
    return "multiple high-cardinality wildcard repetitions are not allowed";
  }
  return undefined;
}

interface GroupRisk {
  hasHighCardinalityRepeat: boolean;
  hasAlternation: boolean;
}

interface Quantifier {
  highCardinality: boolean;
}

function emptyRisk(): GroupRisk {
  return { hasHighCardinalityRepeat: false, hasAlternation: false };
}

function currentRisk(groups: GroupRisk[]): GroupRisk {
  return groups[groups.length - 1] ?? groups[0];
}

function skipCharacterClass(pattern: string, start: number): number {
  for (let index = start + 1; index < pattern.length; index += 1) {
    if (pattern[index] === "\\") {
      index += 1;
    } else if (pattern[index] === "]") {
      return index;
    }
  }
  return pattern.length - 1;
}

function readQuantifier(pattern: string, start: number): Quantifier | undefined {
  const character = pattern[start];
  if (character === "*" || character === "+") {
    return { highCardinality: true };
  }
  if (character === "?") {
    return { highCardinality: false };
  }
  if (character !== "{") {
    return undefined;
  }

  const end = pattern.indexOf("}", start + 1);
  if (end < 0) {
    return undefined;
  }
  const body = pattern.slice(start + 1, end);
  const exact = body.match(/^(\d+)$/);
  if (exact) {
    return { highCardinality: Number(exact[1]) > maxSafeAmbiguousRepeat };
  }
  const range = body.match(/^\d+,\s*(\d*)$/);
  if (range) {
    return {
      highCardinality: range[1] === "" || Number(range[1]) > maxSafeAmbiguousRepeat
    };
  }
  return { highCardinality: false };
}
