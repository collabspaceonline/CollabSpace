"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2 text-center">Collab Space</h1>
        <p className="text-gray-500 text-center mb-8">Video collaboration, room by room</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Room ID</label>
            <input
              type="text"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && joinRoom()}
              placeholder="Enter a room ID..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-800"
            />
          </div>

          <button
            onClick={joinRoom}
            disabled={!roomId.trim()}
            className="w-full px-4 py-2 rounded-lg font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 transition-colors"
          >
            Join Room
          </button>

          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-gray-200" />
            <span className="text-sm text-gray-400">or</span>
            <div className="flex-1 border-t border-gray-200" />
          </div>

          <button
            onClick={createRoom}
            className="w-full px-4 py-2 rounded-lg font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors"
          >
            Create New Room
          </button>
        </div>
      </div>
    </main>
  );
}
