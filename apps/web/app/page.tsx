"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const router = useRouter();

  const joinRoom = () => {
    const id = roomId.trim();
    if (!id) return;
    router.push(`/room/${encodeURIComponent(id)}`);
  };

  const createRoom = () => {
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    router.push(`/room/${id}`);
  };

  return (
    <main
      className="relative min-h-screen w-full overflow-hidden bg-[#0b1c3d] bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/background.jpg')" }}
    >
      {/* Soft blue tint + readability overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(11,28,61,0.55) 0%, rgba(26,115,232,0.25) 50%, rgba(11,28,61,0.55) 100%)",
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6">
        {/* Brand mark */}
        <div className="mb-4 flex items-center gap-0">
          <Image
            src="/logo.png"
            alt="Collab Space logo"
            width={100}
            height={100}
            priority
            className="h-12 w-12 rounded-2xl object-contain drop-shadow-xl"
          />
          <span className="font-[family-name:var(--font-playfair-display)] text-5xl font-semibold tracking-tight text-white drop-shadow-md ml-4 mr-4">
            Collab Space
          </span>
        </div>

        {/* Card */}
        <div className="relative w-full max-w-md mt-4">
          {/* Outer glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-px rounded-[28px] opacity-70 blur-2xl"
            style={{
              background:
                "linear-gradient(135deg, rgba(138,180,248,0.35), rgba(26,115,232,0.25) 40%, rgba(168,85,247,0.25) 100%)",
            }}
          />

          {/* Gradient border wrapper */}
          <div
            className="relative rounded-[28px] p-[1px]"
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0.08) 40%, rgba(138,180,248,0.35) 100%)",
            }}
          >
            <div
              className="relative overflow-hidden rounded-[27px] p-8 backdrop-blur-2xl"
              style={{
                background:
                  "linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)",
                boxShadow:
                  "0 1px 0 0 rgba(255,255,255,0.15) inset, 0 30px 80px -20px rgba(0,0,0,0.55)",
              }}
            >
              {/* Decorative blobs */}
              <div
                aria-hidden
                className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-40 blur-3xl"
                style={{ background: "#4285f4" }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute -bottom-20 -left-16 h-44 w-44 rounded-full opacity-30 blur-3xl"
                style={{ background: "#a855f7" }}
              />

              <div className="relative">
                {/* Live pill */}
                <div className="mb-5 flex justify-center">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-white/80 backdrop-blur">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                    Live now
                  </span>
                </div>

                <h1 className="text-center text-4xl font-semibold tracking-tight text-white">
                  Join a meet
                </h1>
                <p className="mt-2 mb-7 text-center text-sm text-white/60">
                  Real-time video and a collaborative whiteboard.
                </p>

                {/* Room ID input */}
                <label
                  htmlFor="roomId"
                  className="mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-white/50"
                >
                  Room ID
                </label>
                <div className="group relative mb-4">
                  <div
                    aria-hidden
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="11" rx="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <input
                    id="roomId"
                    type="text"
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && joinRoom()}
                    placeholder="4XJ7K2"
                    autoComplete="off"
                    className="w-full rounded-2xl border border-white/10 bg-white/5 py-3.5 pl-11 pr-4 font-mono text-base tracking-[0.25em] text-white placeholder-white/30 outline-none transition-all focus:border-white/30 focus:bg-white/10 focus:ring-4 focus:ring-white/10"
                  />
                </div>

                {/* Join button */}
                <button
                  onClick={joinRoom}
                  disabled={!roomId.trim()}
                  className="group relative mt-3 w-full overflow-hidden rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:shadow-[0_18px_40px_-12px_rgba(66,133,244,0.6)]"
                  style={{
                    background:
                      "linear-gradient(135deg, #1a73e8 0%, #4285f4 50%, #8ab4f8 100%)",
                  }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-enabled:group-hover:translate-x-full"
                  />
                  <span className="relative inline-flex items-center justify-center gap-2">
                    Join room
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="transition-transform group-enabled:group-hover:translate-x-0.5"
                    >
                      <path d="M5 12h14M13 5l7 7-7 7" />
                    </svg>
                  </span>
                </button>

                {/* Divider */}
                <div className="my-6 flex items-center gap-3">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
                  <span className="text-[10px] uppercase tracking-[0.25em] text-white/40">
                    or
                  </span>
                  <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
                </div>

                {/* Create new room */}
                <button
                  onClick={createRoom}
                  className="group relative w-full overflow-hidden rounded-2xl px-4 py-3.5 text-sm font-semibold text-white transition-all duration-200 hover:shadow-[0_18px_40px_-12px_rgba(66,133,244,0.6)]"
                  style={{
                    background:
                      "linear-gradient(135deg, #1a73e8 0%, #4285f4 50%, #8ab4f8 100%)",
                  }}
                >
                  <span
                    aria-hidden
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  />
                  <span className="relative inline-flex items-center justify-center gap-2">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="transition-transform group-hover:rotate-90"
                    >
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Create new room
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Footnote */}
          <p className="mt-6 text-center text-xs text-white/60 drop-shadow-sm">
            No sign-up. Share the room ID with anyone to collaborate.
          </p>
        </div>
      </div>
    </main>
  );
}
