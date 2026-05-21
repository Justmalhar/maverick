import { motion, useReducedMotion } from "framer-motion";
import type { Message } from "@/lib/ipc";

export function UserMessage({ message }: { message: Message }) {
  const reduce = useReducedMotion();
  return (
    <motion.li
      data-testid={`message-user-${message.id}`}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="flex justify-end"
    >
      <div className="max-w-[80%] whitespace-pre-wrap rounded-sm bg-primary/15 px-3 py-2 text-[13px] leading-relaxed text-foreground">
        {message.content}
      </div>
    </motion.li>
  );
}
