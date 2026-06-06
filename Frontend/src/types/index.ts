// types/index.ts
export interface Message {
  id: number
  sender: "user" | "agent"
  content: string
  timestamp: string
  avatar?: string
}

export interface ChatAreaProps {
  activeChat: string
}