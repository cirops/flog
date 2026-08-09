const BRANCH_CREATE_PREFIXES = ["git checkout -b ", "git switch -c "] as const;

export function prefillFromRaw(raw: string): { id: string; description: string } {
  const normalized = raw.trim().replace(/\s+/g, " ");
  const id = extractTicketId(normalized);
  const branch = extractBranchArgument(normalized);
  if (branch === undefined) {
    return { id, description: normalized };
  }

  let hint = branch.replace(/^feature\//, "");
  if (id && hint.endsWith(`_${id}`)) {
    hint = hint.slice(0, -(id.length + 1));
  }
  hint = hint.replace(/_/g, " ").trim();
  return { id, description: hint || normalized };
}

function extractTicketId(raw: string): string {
  const underscoreTokens = raw.split("_");
  for (let i = underscoreTokens.length - 1; i >= 0; i -= 1) {
    const token = underscoreTokens[i].split(/\s+/)[0];
    if (/^\d+$/.test(token)) {
      return token;
    }
  }
  const whitespaceTokens = raw.split(/\s+/);
  for (let i = whitespaceTokens.length - 1; i >= 0; i -= 1) {
    if (/^\d+$/.test(whitespaceTokens[i])) {
      return whitespaceTokens[i];
    }
  }
  return "";
}

function extractBranchArgument(raw: string): string | undefined {
  for (const prefix of BRANCH_CREATE_PREFIXES) {
    if (raw.startsWith(prefix)) {
      const rest = raw.slice(prefix.length).trim();
      if (!rest) {
        return undefined;
      }
      return rest.split(/\s+/)[0];
    }
  }
  return undefined;
}
