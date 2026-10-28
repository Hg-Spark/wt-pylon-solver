import type {AircraftIndexItem, OptionsResponse} from "../types";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function fetchOptions(
  payload: {aircraft: string},
  signal?: AbortSignal,
): Promise<OptionsResponse> {
  const aircraft = payload.aircraft.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(aircraft)) {
    throw new ApiError("飞机 ID 格式无效，请使用 Datamine ID，例如 su_34 或 f_15e。", 400);
  }

  const url = `${import.meta.env.BASE_URL}data/${aircraft}.json`;
  let response: Response;
  try {
    response = await fetch(url, {cache: "no-cache", signal});
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("无法读取静态挂载数据。", 0);
  }

  if (response.status === 404) {
    throw new ApiError(`未找到飞机数据：${aircraft}。请确认使用精确 Datamine ID。`, 404);
  }
  if (!response.ok) {
    throw new ApiError(`读取挂载数据失败（${response.status}）`, response.status);
  }

  try {
    return await response.json() as OptionsResponse;
  } catch {
    throw new ApiError(`飞机数据损坏：${aircraft}`, 500);
  }
}

export async function fetchAircraftIndex(): Promise<AircraftIndexItem[]> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.BASE_URL}data/aircraft-index.json`, {cache: "no-cache"});
  } catch {
    throw new ApiError("无法加载飞机搜索目录。仍可输入完整 Datamine ID。");
  }
  if (!response.ok) throw new ApiError("飞机搜索目录不可用。仍可输入完整 Datamine ID。", response.status);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("飞机搜索目录数据损坏。");
  }
  if (!Array.isArray(data)) throw new ApiError("飞机搜索目录格式错误。");
  return data.filter((item): item is AircraftIndexItem =>
    item != null && typeof item === "object"
      && typeof item.id === "string" && /^[a-z0-9_-]+$/.test(item.id)
      && typeof item.zh === "string" && typeof item.en === "string");
}
