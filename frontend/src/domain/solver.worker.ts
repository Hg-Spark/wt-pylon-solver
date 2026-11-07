import {expose} from "comlink";
import {solvePylonLoadout, type SolverInput} from "./solver";
import type {Solution} from "../types";

export interface SolverWorkerApi {
  solve(input: SolverInput): Solution[];
}

expose({
  solve: solvePylonLoadout,
} satisfies SolverWorkerApi);
