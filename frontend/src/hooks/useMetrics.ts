import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { getTimeseries, getMetricsSummary, getTopCreators } from "../api/client";

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

export function useTimeseries(projectId: string, from: string, to: string, granularity = "hour") {
  return useQuery({
    queryKey: ["timeseries", projectId, from, to, granularity],
    queryFn:  () => getTimeseries(projectId, from, to, granularity),
    enabled:  !!projectId,
  });
}

export function useSummary(projectId: string, from: string, to: string) {
  return useQuery({
    queryKey: ["summary", projectId, from, to],
    queryFn:  () => getMetricsSummary(projectId, from, to),
    enabled:  !!projectId,
  });
}

export function useTopCreators(projectId: string) {
  return useQuery({
    queryKey: ["creators", projectId],
    queryFn:  () => getTopCreators(projectId),
    enabled:  !!projectId,
  });
}

export const defaultRange = (days: number) => ({
  from: fmt(subDays(new Date(), days)),
  to:   fmt(new Date()),
});
