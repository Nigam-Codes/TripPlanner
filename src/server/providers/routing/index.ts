import "server-only";
import { osrmProvider } from "./osrm";
import { orsProvider } from "./ors";
import type { RoutingProvider } from "./types";

export function routingProvider(): RoutingProvider {
  return process.env.ROUTING_PROVIDER === "ors" ? orsProvider : osrmProvider;
}

export type { RoutingProvider };
