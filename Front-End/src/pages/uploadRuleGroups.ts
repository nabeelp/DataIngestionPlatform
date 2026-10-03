export interface GroupableRule {
  /** Sheet the check applies to; null when it applies to every sheet (or the CSV). */
  sheet: string | null;
  type?: string;
}

export interface GroupableSheet {
  name: string;
  status: string;
}

export interface RuleGroup<R extends GroupableRule> {
  key: string;
  label: string;
  status: string;
  rules: R[];
}

// Sheet names match the way validation matches them: case-insensitive, ignoring surrounding spaces.
const sheetKey = (name: string): string => name.trim().toLowerCase();

/**
 * One group per sheet that has checks, in workbook order; checks that apply to every sheet (or the CSV) come first,
 * and checks for sheets missing from the file come last. Structural checks precede rule checks within each group.
 */
export const groupRulesBySheet = <R extends GroupableRule>(
  rules: R[],
  sheets: GroupableSheet[],
  uploadStatus: string,
): RuleGroup<R>[] => {
  const groups = new Map<string, RuleGroup<R>>();
  for (const rule of rules) {
    const key = rule.sheet === null ? '' : sheetKey(rule.sheet);
    let group = groups.get(key);
    if (!group) {
      const sheet = rule.sheet === null ? undefined : sheets.find(s => sheetKey(s.name) === key);
      group = {
        key,
        label: rule.sheet ?? (sheets.length > 1 ? 'All sheets' : sheets[0]?.name || 'File'),
        status: sheet?.status || uploadStatus,
        rules: [],
      };
      groups.set(key, group);
    }
    group.rules.push(rule);
  }

  const order = (key: string): number => {
    if (key === '') return -1;
    const index = sheets.findIndex(s => sheetKey(s.name) === key);
    return index === -1 ? sheets.length : index;
  };
  return [...groups.values()]
    .sort((a, b) => order(a.key) - order(b.key))
    .map(group => ({
      ...group,
      rules: [
        ...group.rules.filter(rule => rule.type?.toLowerCase() === 'structural'),
        ...group.rules.filter(rule => rule.type?.toLowerCase() !== 'structural'),
      ],
    }));
};
