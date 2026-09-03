import type { LatLon, Leg, Mode } from "@/lib/types";

export interface RoutingProvider {
  name: string;
  /** A single leg between two points, with geometry for drawing. */
  leg(from: LatLon, to: LatLon, mode: Mode): Promise<Leg>;
  /** Full duration matrix in seconds, used to optimize stop order. */
  matrix(points: LatLon[], mode: Mode): Promise<number[][]>;
}
