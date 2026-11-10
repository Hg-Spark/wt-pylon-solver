import type {AircraftIndexItem} from "../types";

const RECENT_KEY = "wt_recent_aircraft";
const MAX_RECENT = 8;
const AIRCRAFT_ID = /^[a-z0-9_-]+$/;
// Datamine uses these glyphs as insignia/event badges within localized names.
const NAME_MARKERS = /[⋠␗␙␠▀▂▃▄▅◔◄◊◘◐◌◢◍◥◗○◆◡☢\uf059\u200b]/g;

export function cleanAircraftName(value: string): string {
  return value.replace(NAME_MARKERS, "").replace(/\s+/g, " ").trim();
}

export const AIRCRAFT_NATIONS = [
  {value: "usa", label: "美系"},
  {value: "germany", label: "德系"},
  {value: "ussr", label: "苏系"},
  {value: "britain", label: "英系"},
  {value: "japan", label: "日系"},
  {value: "china", label: "中系"},
  {value: "italy", label: "意系"},
  {value: "france", label: "法系"},
  {value: "sweden", label: "瑞系"},
  {value: "israel", label: "以系"},
] as const;

export function aircraftNationLabel(nation: string | null | undefined): string {
  return AIRCRAFT_NATIONS.find((item) => item.value === nation)?.label || "未分类";
}

export function normalizeAircraftSearch(value: string): string {
  return cleanAircraftName(value).normalize("NFKC").toLocaleLowerCase().replace(/[\s._\-·()（）]/g, "");
}

export function aircraftLabel(entry: AircraftIndexItem): string {
  return cleanAircraftName(entry.zh || entry.en || entry.id);
}

export function searchAircraft(
  entries: readonly AircraftIndexItem[],
  query: string,
  recentIds: readonly string[] = [],
  limit = 20,
  nation: string | null = null,
): AircraftIndexItem[] {
  const needle = normalizeAircraftSearch(query.trim());
  const recentRank = new Map(recentIds.map((id, index) => [id, index]));
  const scored = entries.filter((entry) => !nation || entry.nation === nation).map((entry) => {
    const fields = [entry.id, entry.zh, entry.en].filter(Boolean)
      .map(normalizeAircraftSearch);
    let rank = 4;
    if (needle) {
      if (fields[0] === needle) rank = 0;
      else if (fields.includes(needle)) rank = 1;
      else if (fields.some((field) => field.startsWith(needle))) rank = 2;
      else if (fields.some((field) => field.includes(needle))) rank = 3;
      else return null;
    }
    return {entry, rank, recent: recentRank.get(entry.id) ?? Infinity};
  }).filter((item): item is {entry: AircraftIndexItem; rank: number; recent: number} => item !== null);

  scored.sort((left, right) =>
    left.rank - right.rank ||
    left.recent - right.recent ||
    aircraftLabel(left.entry).localeCompare(aircraftLabel(right.entry), "zh-CN") ||
    left.entry.id.localeCompare(right.entry.id));
  return scored.slice(0, limit).map((item) => item.entry);
}

export function updatedRecentAircraft(existing: readonly string[], id: string): string[] {
  if (!AIRCRAFT_ID.test(id)) return [...existing].slice(0, MAX_RECENT);
  return [id, ...existing.filter((value) => value !== id && AIRCRAFT_ID.test(value))]
    .slice(0, MAX_RECENT);
}

function parseRecentAircraft(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const id of value) {
    if (typeof id === "string" && AIRCRAFT_ID.test(id) && !result.includes(id)) result.push(id);
    if (result.length === MAX_RECENT) break;
  }
  return result;
}

function clearRecentAircraftCookie(): void {
  document.cookie = `${RECENT_KEY}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function readRecentAircraft(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(RECENT_KEY);
    if (stored !== null) {
      clearRecentAircraftCookie();
      return parseRecentAircraft(JSON.parse(stored));
    }

    const match = document.cookie.split(";").map((part) => part.trim())
      .find((part) => part.startsWith(`${RECENT_KEY}=`));
    if (!match) return [];

    const recent = parseRecentAircraft(JSON.parse(decodeURIComponent(match.slice(RECENT_KEY.length + 1))));
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    clearRecentAircraftCookie();
    return recent;
  } catch {
    return [];
  }
}

export function saveRecentAircraft(id: string, existing: readonly string[]): string[] {
  const next = updatedRecentAircraft(existing, id);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      clearRecentAircraftCookie();
    } catch {
      // Keep the in-memory recent list if browser storage is unavailable.
    }
  }
  return next;
}
