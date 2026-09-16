export type ABCGraphRecord = { eventDate: string; antecedentLabel: string; behaviorLabel: string };

export function analyzeABCGraph(records: ABCGraphRecord[]) {
  const pairCounts = new Map<string, { antecedent: string; behavior: string; count: number }>();
  const dailyCounts = new Map<string, number>();
  for (const record of records) {
    const antecedent = record.antecedentLabel.trim() || "Sin especificar";
    const behavior = record.behaviorLabel.trim() || "Sin especificar";
    const key = JSON.stringify([antecedent, behavior]);
    const existing = pairCounts.get(key);
    pairCounts.set(key, { antecedent, behavior, count: (existing?.count || 0) + 1 });
    if (/^\d{4}-\d{2}-\d{2}$/.test(record.eventDate)) dailyCounts.set(record.eventDate, (dailyCounts.get(record.eventDate) || 0) + 1);
  }
  return {
    pairs: [...pairCounts.values()].sort((a, b) => b.count - a.count || a.antecedent.localeCompare(b.antecedent, "es") || a.behavior.localeCompare(b.behavior, "es")),
    days: [...dailyCounts].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, count })),
  };
}
