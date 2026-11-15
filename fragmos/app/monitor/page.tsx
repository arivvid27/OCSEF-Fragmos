import type { Metadata } from "next";
import { Monitor } from "@/components/monitor/Monitor";

export const metadata: Metadata = {
  title: "Monitor · Fragmós",
  description: "Watch what the Sentinel engine lets an AI agent send, and approve the calls it holds.",
};

export default function MonitorPage() {
  return <Monitor />;
}
