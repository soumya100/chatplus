import type { Metadata } from "next"
import AIChat from "@/components/ai/AIChat"

export const metadata: Metadata = {
  title: "AI Assistant",
  description: "Chat with NVIDIA Nemotron models in ChatPlus.",
}

export default function AIPage() {
  return <AIChat />
}
