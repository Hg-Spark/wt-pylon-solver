export function formatNumber(value: number | null | undefined, maximumFractionDigits = 0): string {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return Number(value).toLocaleString("zh-CN", {maximumFractionDigits});
}

