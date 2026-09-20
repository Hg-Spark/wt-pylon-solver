import {solvePylonLoadout, type SolverInput} from "./solver";
import type {Solution} from "../types";

interface SolverWorkerRequest {
  id: number;
  input: SolverInput;
}

interface SolverWorkerResponse {
  id: number;
  solutions?: Solution[];
  error?: string;
}

self.onmessage = (event: MessageEvent<SolverWorkerRequest>) => {
  const {id, input} = event.data;
  try {
    const solutions = solvePylonLoadout(input);
    self.postMessage({id, solutions} satisfies SolverWorkerResponse);
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : "求解失败。",
    } satisfies SolverWorkerResponse);
  }
};
