import type { Metadata } from "next";
import { Connect } from "@/components/connect/Connect";

export const metadata: Metadata = {
  title: "Connect · Fragmós",
  description: "Get an API key and point any agent, SDK, or chat app at Fragmós.",
};

export default function ConnectPage() {
  return <Connect />;
}
