"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";

export type Reaction = {
  id: string;
  emoji: string;
  label?: string;
  // randomized horizontal anchor (px from left of viewport)
  x: number;
};

type Props = {
  reactions: Reaction[];
  onComplete: (id: string) => void;
};

/**
 * Renders floating reactions in a fixed full-screen layer.
 *
 * Each reaction spawns at its randomized x near the bottom-left, then floats
 * upward while swaying horizontally. Cleanup happens via onAnimationComplete
 * so finished reactions are removed from parent state.
 */
export default function ReactionOverlay({ reactions, onComplete }: Props) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden"
      aria-hidden
    >
      <AnimatePresence>
        {reactions.map((r) => (
          <FloatingReaction key={r.id} reaction={r} onComplete={onComplete} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function FloatingReaction({
  reaction,
  onComplete,
}: {
  reaction: Reaction;
  onComplete: (id: string) => void;
}) {
  // Per-instance randomized sway so spammed reactions fan out instead of stacking.
  const sway = useMemo(() => {
    const drift = Math.random() * 80 - 40; // -40..+40 px
    // Vertical travel as a fraction of viewport height so it feels right at any size.
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const rise = vh * (0.55 + Math.random() * 0.15); // 55%..70% of viewport height
    return { drift, rise };
  }, []);

  return (
    <motion.div
      style={{
        position: "absolute",
        left: reaction.x,
        bottom: 96,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
      initial={{ opacity: 0, scale: 0.5, x: 0, y: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        scale: [0.5, 1.1, 1, 0.9],
        x: [0, sway.drift * 0.4, sway.drift],
        y: [0, -sway.rise * 0.5, -sway.rise],
      }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{
        duration: 2,
        ease: "easeOut",
        times: [0, 0.15, 0.7, 1],
      }}
      onAnimationComplete={() => onComplete(reaction.id)}
    >
      <div
        style={{
          fontSize: 44,
          lineHeight: 1,
          filter: "drop-shadow(0 3px 6px rgba(0, 0, 0, 0.35))",
        }}
      >
        {reaction.emoji}
      </div>
      {reaction.label && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: "#ffffff",
            background: "rgba(0, 0, 0, 0.65)",
            padding: "2px 8px",
            borderRadius: 10,
            whiteSpace: "nowrap",
          }}
        >
          {reaction.label}
        </div>
      )}
    </motion.div>
  );
}
